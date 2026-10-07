import { createHash, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { chmod, mkdir, readFile, readdir, realpath, rename, rm, stat, statfs, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn, type ChildProcess } from "node:child_process";
import { Readable, Transform } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { pipeline } from "node:stream/promises";
import { LOCAL_RUNNER_SOURCE } from "./runner-source.js";
import { LOCAL_AI_MODELS, chooseProfile, runtimeSpec, type LocalAiProfile, type LocalAiRuntimeSpec } from "./catalog.js";

export type LocalAiState = "unconfigured" | "downloading" | "verifying" | "starting" | "ready" | "degraded" | "error" | "stopping";
interface InstalledModel { id: string; label: string; path: string; sizeBytes: number }
interface InstalledRuntime { version: string; path: string }
export interface LocalAiStatus {
  state: LocalAiState;
  profile: LocalAiProfile;
  model: InstalledModel | null;
  runtime: InstalledRuntime | null;
  progress: { phase: string; downloadedBytes: number; totalBytes: number; percent: number } | null;
  capability: { ramBytes: number; cpuCores: number; recommendedProfile: LocalAiProfile };
  error: { code: string; message: string; retryable: boolean } | null;
}
interface RuntimeReceipt { version: string; archiveSha256: string; executable: string; files: Record<string, string> }
interface Manifest { version: 1; profile: LocalAiProfile; modelId: string; modelSha256: string }

// Resolve lazily: standalone .env is loaded by index.ts after ESM imports.
function directories() {
  const data = process.env.AI_PULSE_DATA_DIR || path.join(os.homedir(), ".ai-pulse");
  const root = process.env.AI_PULSE_LOCAL_AI_DIR || path.join(data, "local-ai");
  return {
    root,
    models: process.env.AI_PULSE_LOCAL_AI_MODEL_DIR || path.join(root, "models"),
    runtime: process.env.AI_PULSE_LOCAL_AI_RUNTIME_DIR || path.join(root, "runtime"),
    manifest: path.join(root, "manifest.json"),
  };
}
const capability = {
  ramBytes: os.totalmem(), cpuCores: os.availableParallelism(), recommendedProfile: chooseProfile(os.totalmem()),
};
let status: LocalAiStatus = {
  state: "unconfigured", profile: capability.recommendedProfile, model: null, runtime: null,
  progress: null, capability, error: null,
};
let child: ChildProcess | null = null;
let childClosed: Promise<void> | null = null;
let startPromise: Promise<LocalAiStatus> | null = null;
let startAbort: AbortController | null = null;
let setupPromise: Promise<LocalAiStatus> | null = null;
let setupAbort: AbortController | null = null;
let initializing: Promise<LocalAiStatus> | null = null;
let initAbort: AbortController | null = null;
let endpoint: string | null = null;
let apiKey = "";
let stderrTail = "";
let stopping = false;

export function getLocalAIStatus(): LocalAiStatus { return structuredClone(status); }
export function localAiBaseUrl(): string {
  if (!endpoint || status.state !== "ready") throw new Error("Local AI is not ready. Complete setup in Settings → Local AI.");
  return `${endpoint}/v1`;
}
export function localAiAuthHeader(): string { return `Bearer ${apiKey}`; }
function errorStatus(code: string, error: unknown): LocalAiStatus {
  status = { ...status, state: "error", progress: null, error: { code, message: error instanceof Error ? error.message : String(error), retryable: true } };
  return getLocalAIStatus();
}
function checkAbort(signal?: AbortSignal): void { signal?.throwIfAborted(); }
function safeRelative(file: string): boolean {
  return Boolean(file) && !path.isAbsolute(file) && !file.split(/[\\/]/).includes("..");
}
async function atomicJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
  await rename(temp, file);
}
async function fileHash(file: string, signal?: AbortSignal): Promise<string> {
  const hash = createHash("sha256");
  const source = createReadStream(file, { signal });
  for await (const chunk of source) { checkAbort(signal); hash.update(chunk); }
  return hash.digest("hex");
}
async function validFile(file: string, size: number | undefined, sha: string, signal?: AbortSignal): Promise<boolean> {
  try {
    if (size !== undefined && (await stat(file)).size !== size) return false;
    return await fileHash(file, signal) === sha;
  } catch (error) { checkAbort(signal); return false; }
}
async function fileSize(file: string): Promise<number> {
  try { return (await stat(file)).size; } catch { return 0; }
}
async function checkDisk(dir: string, needed: number): Promise<void> {
  await mkdir(dir, { recursive: true });
  const disk = await statfs(dir);
  if (disk.bavail * disk.bsize < needed + 512 * 1024 ** 2) {
    throw new Error(`Not enough free disk space. Free at least ${Math.ceil((needed + 512 * 1024 ** 2) / 1024 ** 3)} GB and retry.`);
  }
}
function setProgress(phase: string, downloadedBytes: number, totalBytes: number): void {
  status = { ...status, progress: { phase, downloadedBytes, totalBytes, percent: totalBytes ? Math.min(100, downloadedBytes / totalBytes * 100) : 0 } };
}

/** Resume interrupted downloads; only promote a complete, verified artifact. */
async function download(url: string, destination: string, sha: string, expectedSize: number | undefined, signal: AbortSignal, phase: string): Promise<void> {
  await mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.part`;
  let offset = await fileSize(temporary);
  if (offset && (!expectedSize || offset === expectedSize) && await validFile(temporary, expectedSize, sha, signal)) {
    await rename(temporary, destination);
    return;
  }
  if (expectedSize && offset >= expectedSize) { await rm(temporary, { force: true }); offset = 0; }
  const timed = AbortSignal.any([signal, AbortSignal.timeout(30 * 60_000)]);
  const response = await fetch(url, { signal: timed, headers: offset ? { Range: `bytes=${offset}-` } : {} });
  if (!response.ok || !response.body) throw new Error(`Download failed (HTTP ${response.status}). Check your connection and retry.`);
  if (response.status === 206) {
    const start = Number(response.headers.get("content-range")?.match(/^bytes (\d+)-/)?.[1]);
    if (start !== offset) throw new Error("The download server returned an invalid resume range. Retry setup.");
  } else offset = 0;
  let done = offset;
  const total = expectedSize ?? (Number(response.headers.get("content-length")) + offset);
  status = { ...status, state: "downloading" };
  setProgress(phase, done, total);
  const progress = new Transform({ transform(chunk: Buffer, _encoding, callback) {
    done += chunk.length;
    setProgress(phase, done, total);
    callback(null, chunk);
  } });
  await pipeline(
    Readable.fromWeb(response.body as unknown as NodeReadableStream<Uint8Array>), progress,
    createWriteStream(temporary, { flags: offset ? "a" : "w" }), { signal: timed },
  );
  status = { ...status, state: "verifying" };
  if (!await validFile(temporary, expectedSize, sha, signal)) {
    await rm(temporary, { force: true });
    throw new Error("Download verification failed. The file was discarded; retry setup.");
  }
  checkAbort(signal);
  await rename(temporary, destination);
}

async function runtimeFiles(root: string, signal?: AbortSignal): Promise<string[]> {
  const files: string[] = [];
  // macOS /var is itself a symlink to /private/var. Compare canonical paths
  // on both sides so legitimate internal dylib links are accepted.
  const canonicalRoot = await realpath(root);
  async function visit(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      checkAbort(signal);
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await visit(full);
      else if (entry.isSymbolicLink()) {
        const resolved = await realpath(full);
        if (!resolved.startsWith(`${canonicalRoot}${path.sep}`)) throw new Error("Unsafe path in runtime archive.");
        if ((await stat(resolved)).isFile()) files.push(path.relative(root, full));
      } else if (entry.isFile() && entry.name !== "receipt.json") files.push(path.relative(root, full));
    }
  }
  await visit(root);
  return files;
}
async function installedRuntime(spec: LocalAiRuntimeSpec, signal?: AbortSignal): Promise<InstalledRuntime | null> {
  const dir = path.join(directories().runtime, spec.version);
  try {
    const receipt = JSON.parse(await readFile(path.join(dir, "receipt.json"), "utf8")) as RuntimeReceipt;
    if (receipt.version !== spec.version || receipt.archiveSha256 !== spec.sha256 || !safeRelative(receipt.executable)) return null;
    const entries = Object.entries(receipt.files);
    if (!entries.length || !receipt.files[receipt.executable]) return null;
    for (const [relative, hash] of entries) {
      checkAbort(signal);
      if (!safeRelative(relative) || !await validFile(path.join(dir, relative), undefined, hash, signal)) return null;
    }
    return { version: spec.version, path: path.join(dir, receipt.executable) };
  } catch { checkAbort(signal); return null; }
}
async function installRuntime(spec: LocalAiRuntimeSpec, signal: AbortSignal): Promise<InstalledRuntime> {
  const existing = await installedRuntime(spec, signal);
  if (existing) return existing;
  const { runtime } = directories();
  await checkDisk(runtime, 512 * 1024 ** 2);
  const archive = path.join(runtime, `${spec.version}.${spec.archive}`);
  if (!await validFile(archive, undefined, spec.sha256, signal)) await download(spec.url, archive, spec.sha256, undefined, signal, "runtime");
  const stage = path.join(runtime, `.staging-${process.pid}`);
  await rm(stage, { recursive: true, force: true });
  await mkdir(stage, { recursive: true });
  try {
    checkAbort(signal);
    status = { ...status, state: "verifying", progress: null };
    await new Promise<void>((resolve, reject) => {
      const extractor = spawn("tar", ["-xf", archive, "-C", stage], { signal, windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
      let detail = "";
      extractor.stderr.on("data", (data: Buffer) => { detail = (detail + data.toString()).slice(-1000); });
      extractor.once("error", reject);
      extractor.once("close", (code) => code === 0 ? resolve() : reject(new Error(`Runtime extraction failed (${code}): ${detail}`)));
    });
    const files = await runtimeFiles(stage, signal);
    const executable = files.find((file) => path.basename(file) === spec.executable);
    if (!executable) throw new Error("The downloaded runtime does not contain llama-server.");
    if (process.platform !== "win32") await chmod(path.join(stage, executable), 0o755);
    const hashes: Record<string, string> = {};
    for (const file of files) hashes[file] = await fileHash(path.join(stage, file), signal);
    const receipt: RuntimeReceipt = { version: spec.version, archiveSha256: spec.sha256, executable, files: hashes };
    await atomicJson(path.join(stage, "receipt.json"), receipt);
    checkAbort(signal);
    const target = path.join(runtime, spec.version);
    await rm(target, { recursive: true, force: true });
    await rename(stage, target);
    await rm(archive, { force: true });
    return { version: spec.version, path: path.join(target, executable) };
  } finally { await rm(stage, { recursive: true, force: true }); }
}
async function availablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close((error) => error ? reject(error) : resolve(port));
    });
  });
}
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return; }
    const abort = () => { clearTimeout(timer); reject(signal?.reason); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
}
async function terminateChild(): Promise<void> {
  const current = child;
  if (!current) return;
  stopping = true;
  current.stdin?.end(); // The watchdog shuts down its runtime before exiting.
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([childClosed, new Promise<void>((resolve) => { timer = setTimeout(resolve, 4000); })]);
  if (timer) clearTimeout(timer);
  if (child === current) {
    current.kill("SIGKILL");
    await childClosed;
  }
  endpoint = null;
  apiKey = "";
  stopping = false;
}

export function startLocalAI(): Promise<LocalAiStatus> {
  if (startPromise) return startPromise;
  if (child && status.state === "ready") return Promise.resolve(getLocalAIStatus());
  const controller = new AbortController();
  startAbort = controller;
  const signal = AbortSignal.any([controller.signal, ...(setupAbort ? [setupAbort.signal] : []), ...(initAbort ? [initAbort.signal] : [])]);
  startPromise = (async () => {
    try {
      await terminateChild();
      checkAbort(signal);
      const { model, runtime } = status;
      if (!model || !runtime) throw new Error("Local AI is not installed. Run setup first.");
      const port = await availablePort();
      checkAbort(signal);
      apiKey = randomBytes(32).toString("hex");
      endpoint = `http://127.0.0.1:${port}`;
      stderrTail = "";
      status = { ...status, state: "starting", error: null, progress: null };
      const args = [
        "--model", model.path, "--host", "127.0.0.1", "--port", String(port), "--api-key", apiKey,
        "--alias", model.id, "--ctx-size", "4096", "--parallel", "1", "--n-gpu-layers", "0",
        "--threads", String(Math.max(1, Math.min(6, capability.cpuCores - 1))),
        "--jinja", "--reasoning-budget", "0",
      ];
      const current = spawn(process.execPath, ["-e", LOCAL_RUNNER_SOURCE], {
        windowsHide: true, stdio: ["pipe", "ignore", "pipe"],
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      });
      child = current;
      current.stdin.on("error", () => undefined);
      current.stdin.write(JSON.stringify({ executable: runtime.path, args, cwd: path.dirname(runtime.path) }) + "\n");
      current.stderr?.on("data", (data: Buffer) => { stderrTail = (stderrTail + data.toString()).slice(-2500); });
      current.once("error", (error) => { stderrTail = error.message; });
      childClosed = new Promise((resolve) => current.once("close", (code) => {
        if (child === current) {
          child = null;
          endpoint = null;
          if (!stopping) errorStatus("runtime_exited", new Error(`The local model stopped (${code ?? "spawn failed"}). Retry setup. ${stderrTail.slice(-500)}`));
        }
        resolve();
      }));
      const deadline = Date.now() + 90_000;
      while (Date.now() < deadline) {
        checkAbort(signal);
        if (child !== current) throw new Error(`The local model could not start. ${stderrTail.slice(-500)}`);
        try {
          const response = await fetch(`http://127.0.0.1:${port}/v1/models`, {
            headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.any([signal, AbortSignal.timeout(1500)]),
          });
          const payload = response.ok ? await response.json() as { data?: { id: string }[] } : null;
          if (payload?.data?.some((item) => item.id === model.id) && child === current) {
            status = { ...status, state: "ready", error: null };
            return getLocalAIStatus();
          }
        } catch { checkAbort(signal); }
        await delay(300, signal);
      }
      throw new Error(`The model did not start within 90 seconds. Try the light profile. ${stderrTail.slice(-350)}`);
    } catch (error) {
      await terminateChild();
      if (signal.aborted) throw signal.reason;
      errorStatus("startup_failed", error);
      throw error;
    } finally { startAbort = null; startPromise = null; }
  })();
  return startPromise;
}

/** Startup never downloads anything; reuse a verified, explicitly installed model. */
export function initializeLocalAI(): Promise<LocalAiStatus> {
  if (initializing) return initializing;
  const controller = new AbortController();
  initAbort = controller;
  const signal = controller.signal;
  initializing = (async () => {
    try {
      let manifest: Manifest;
      try { manifest = JSON.parse(await readFile(directories().manifest, "utf8")) as Manifest; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return getLocalAIStatus();
        throw new Error("The local AI configuration is unreadable. Run setup to repair it.");
      }
      const model = LOCAL_AI_MODELS[manifest.profile];
      const spec = runtimeSpec(process.platform, process.arch);
      if (manifest.version !== 1 || !model || !spec || manifest.modelId !== model.id || manifest.modelSha256 !== model.sha256) {
        throw new Error("The installed model needs an update. Run setup to verify the current version.");
      }
      status = { ...status, state: "verifying", profile: manifest.profile };
      const modelPath = path.join(directories().models, model.file);
      if (!await validFile(modelPath, model.sizeBytes, model.sha256, signal)) throw new Error("The installed model is missing or damaged. Run setup to repair it.");
      const runtime = await installedRuntime(spec, signal);
      checkAbort(signal);
      if (!runtime) throw new Error("The local runtime is missing or damaged. Run setup to repair it.");
      status = { ...status, model: { id: model.id, label: model.label, path: modelPath, sizeBytes: model.sizeBytes }, runtime };
      return await startLocalAI();
    } catch (error) { return errorStatus("initialization_failed", error); }
    finally { initializing = null; initAbort = null; }
  })();
  return initializing;
}

export function setupLocalAI(opts: { profile?: LocalAiProfile; onProgress?: (value: LocalAiStatus) => void } = {}): Promise<LocalAiStatus> {
  if (setupPromise) return setupPromise;
  const controller = new AbortController();
  setupAbort = controller;
  const signal = controller.signal;
  const profile = opts.profile ?? capability.recommendedProfile;
  status = { ...status, state: "verifying", error: null, progress: null };
  setupPromise = (async () => {
    try {
      if (initializing) await initializing;
      await stopLocalAI();
      checkAbort(signal);
      const model = LOCAL_AI_MODELS[profile];
      const spec = runtimeSpec(process.platform, process.arch);
      if (!model || !spec) throw new Error(`Local AI is not supported on ${process.platform}/${process.arch}. Basic curation is available.`);
      if (capability.ramBytes < model.minRamBytes) throw new Error(`This model needs at least ${Math.ceil(model.minRamBytes / 1024 ** 3)} GB of RAM. Choose a smaller model or use basic curation.`);
      status = { ...status, state: "verifying", profile, progress: null };
      const { models, manifest } = directories();
      await mkdir(models, { recursive: true });
      const modelPath = path.join(models, model.file);
      if (!await validFile(modelPath, model.sizeBytes, model.sha256, signal)) {
        const partial = Math.min(model.sizeBytes, await fileSize(`${modelPath}.part`));
        await checkDisk(models, model.sizeBytes - partial);
        await download(`https://huggingface.co/${model.repo}/resolve/${model.revision}/${model.file}?download=true`, modelPath, model.sha256, model.sizeBytes, signal, "model");
      }
      const runtime = await installRuntime(spec, signal);
      checkAbort(signal);
      status = { ...status, model: { id: model.id, label: model.label, path: modelPath, sizeBytes: model.sizeBytes }, runtime };
      await atomicJson(manifest, { version: 1, profile, modelId: model.id, modelSha256: model.sha256 } satisfies Manifest);
      checkAbort(signal);
      return await startLocalAI();
    } catch (error) {
      await terminateChild();
      if (signal.aborted) {
        status = { ...status, state: "unconfigured", progress: null, error: { code: "cancelled", message: "Setup cancelled. Retry to resume the download.", retryable: true } };
        return getLocalAIStatus();
      }
      return errorStatus("setup_failed", error);
    } finally { setupAbort = null; setupPromise = null; opts.onProgress?.(getLocalAIStatus()); }
  })();
  return setupPromise;
}
export function cancelLocalAISetup(): LocalAiStatus {
  setupAbort?.abort();
  initAbort?.abort();
  startAbort?.abort();
  return getLocalAIStatus();
}
export async function stopLocalAI(): Promise<LocalAiStatus> {
  initAbort?.abort();
  startAbort?.abort();
  if (startPromise) await startPromise.catch(() => undefined);
  if (initializing) await initializing;
  status = { ...status, state: "stopping" };
  await terminateChild();
  status = { ...status, state: "unconfigured", progress: null };
  return getLocalAIStatus();
}
