export type LocalAiProfile = "light" | "balanced";

export interface LocalAiModelSpec {
  id: string;
  label: string;
  repo: string;
  revision: string;
  file: string;
  sha256: string;
  sizeBytes: number;
  minRamBytes: number;
}

export interface LocalAiRuntimeSpec {
  version: string;
  url: string;
  sha256: string;
  archive: "tar.gz" | "zip";
  executable: string;
}

// Pinned to published upstream artifacts. The LFS oid is SHA-256 and the
// release asset digest is supplied by GitHub's release API.
export const LOCAL_AI_MODELS: Record<LocalAiProfile, LocalAiModelSpec> = {
  light: {
    id: "qwen3.5-0.8b-q4",
    label: "Qwen3.5 0.8B · Light",
    repo: "ggml-org/Qwen3.5-0.8B-GGUF",
    revision: "8fea620810c4afa23dd6443f999a48574c1611a3",
    file: "Qwen3.5-0.8B-Q4_0.gguf",
    sha256: "57d1997790d1744fba5b40a7317df71ea5e2acee28c47e78f0cce39c0703f8cf",
    sizeBytes: 563036064,
    minRamBytes: 4 * 1024 ** 3,
  },
  balanced: {
    id: "qwen3-1.7b-q8",
    label: "Qwen3 1.7B (Q8_0)",
    repo: "Qwen/Qwen3-1.7B-GGUF",
    revision: "90862c4b9d2787eaed51d12237eafdfe7c5f6077",
    file: "Qwen3-1.7B-Q8_0.gguf",
    sha256: "061b54daade076b5d3362dac252678d17da8c68f07560be70818cace6590cb1a",
    sizeBytes: 1834426016,
    minRamBytes: 8 * 1024 ** 3,
  },
};

const RELEASE = "b11474";
const GH = "https://github.com/ggml-org/llama.cpp/releases/download";
export function runtimeSpec(platform: NodeJS.Platform, arch: string): LocalAiRuntimeSpec | null {
  if (platform === "win32" && arch === "x64") return { version: RELEASE, url: `${GH}/${RELEASE}/llama-${RELEASE}-bin-win-cpu-x64.zip`, sha256: "5a39102a1b27d75ab8a9d777c6cf2ce373c468265dc1797a2566dec085501a95", archive: "zip", executable: "llama-server.exe" };
  if (platform === "win32" && arch === "arm64") return { version: RELEASE, url: `${GH}/${RELEASE}/llama-${RELEASE}-bin-win-cpu-arm64.zip`, sha256: "2874f37ef48f12edfab2346f3857d7c866f4d423b2e9da045baf14312201db71", archive: "zip", executable: "llama-server.exe" };
  if (platform === "darwin" && arch === "arm64") return { version: RELEASE, url: `${GH}/${RELEASE}/llama-${RELEASE}-bin-macos-arm64.tar.gz`, sha256: "ae7f002f2b477d14fea8ac4d93438684344cd18ec10d2b0ee9d5518b2a74def5", archive: "tar.gz", executable: "llama-server" };
  if (platform === "darwin" && arch === "x64") return { version: RELEASE, url: `${GH}/${RELEASE}/llama-${RELEASE}-bin-macos-x64.tar.gz`, sha256: "46381da99834f84ead41c78d091c9137755bac27d9423e56ea1fd0bc51104d60", archive: "tar.gz", executable: "llama-server" };
  if (platform === "linux" && arch === "x64") return { version: RELEASE, url: `${GH}/${RELEASE}/llama-${RELEASE}-bin-ubuntu-x64.tar.gz`, sha256: "98abe0fac169db55712ce96b0e30adf99fa47fa5386fddef8fef84fe21f4a690", archive: "tar.gz", executable: "llama-server" };
  if (platform === "linux" && arch === "arm64") return { version: RELEASE, url: `${GH}/${RELEASE}/llama-${RELEASE}-bin-ubuntu-arm64.tar.gz`, sha256: "9631a59cd041905c3a4eec61a2c8ef3cc60ada44f16c32952e1db121614911f4", archive: "tar.gz", executable: "llama-server" };
  return null;
}

export function chooseProfile(ramBytes: number): LocalAiProfile {
  // Leave headroom for the OS and other applications on 8 GB machines.
  return ramBytes >= 16 * 1024 ** 3 ? "balanced" : "light";
}
