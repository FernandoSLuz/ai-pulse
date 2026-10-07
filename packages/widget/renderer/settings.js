"use strict";
const api = window.aiPulse;

// Optional content/search integrations. Model inference never uses these keys.
const KEY_META = {
  AA_API_KEY: { label: "Artificial Analysis", role: "Benchmark enrichment", hint: "Public rankings already work without a key", url: "https://artificialanalysis.ai/insights" },
  TAVILY_API_KEY: { label: "Tavily", role: "Optional web search", hint: "Search queries go to Tavily when requested", url: "https://app.tavily.com" },
};

let state = null;
const el = (id) => document.getElementById(id);

// --- Connections ------------------------------------------------------------

function renderKeyRow(name) {
  const meta = KEY_META[name] || { label: name, hint: "", curator: false };
  const configured = Boolean(state.config.keys[name]);
  const row = document.createElement("div");
  row.className = "key-row";

  const info = document.createElement("div");
  const title = document.createElement("div");
  title.className = "key-name";
  const dot = document.createElement("span");
  dot.className = "dot " + (configured ? "on" : "off");
  title.appendChild(dot);
  title.appendChild(document.createTextNode(meta.label));
  if (meta.role) {
    const role = document.createElement("span");
    role.className = "key-role";
    role.textContent = meta.role;
    title.appendChild(role);
  }
  const hint = document.createElement("div");
  hint.className = "key-hint";
  hint.textContent = meta.hint || "";
  if (meta.url) {
    hint.appendChild(document.createTextNode(" · "));
    const link = document.createElement("a");
    link.href = "#";
    link.className = "key-getlink";
    link.textContent = "Get key ↗";
    link.addEventListener("click", (e) => {
      e.preventDefault();
      api.openExternal(meta.url);
    });
    hint.appendChild(link);
  }
  info.appendChild(title);
  info.appendChild(hint);

  const input = document.createElement("input");
  input.type = "password";
  input.setAttribute("aria-label", meta.label + " API credential");
  input.placeholder = configured ? "•••••••• saved — paste to replace" : "Paste API key";

  const btnWrap = document.createElement("div");
  btnWrap.className = "btn-group";
  const save = document.createElement("button");
  save.className = "btn btn-small";
  save.textContent = configured ? "Update" : "Save";
  save.addEventListener("click", async () => {
    const val = input.value.trim();
    if (!val) return;
    save.disabled = true;
    save.textContent = "Saving…";
    state = await api.setKey(name, val);
    applyState();
  });
  btnWrap.appendChild(save);
  if (configured) {
    const clear = document.createElement("button");
    clear.className = "btn btn-small btn-ghost";
    clear.textContent = "Clear";
    clear.addEventListener("click", async () => {
      clear.disabled = true;
      state = await api.setKey(name, "");
      applyState();
    });
    btnWrap.appendChild(clear);
  }

  row.appendChild(info);
  row.appendChild(input);
  row.appendChild(btnWrap);
  return row;
}

function renderKeys() {
  const container = el("keys");
  container.innerHTML = "";
  for (const name of state.keyNames) container.appendChild(renderKeyRow(name));
}

// --- Leaderboard ------------------------------------------------------------

function renderLeaderboard() {
  const lb = state.config.leaderboard;
  const barPanel = state.barPanelAvailable === true;
  const windowMode = !barPanel || lb.mode === "window";
  el("lb-mode-row").classList.toggle("hidden", !barPanel);
  document.querySelectorAll("#lb-mode button").forEach((b) => {
    b.classList.toggle("active", b.getAttribute("data-mode") === (windowMode ? "window" : "bar"));
  });
  el("lb-blurb").textContent = barPanel && !windowMode
    ? "Click the AI Pulse entry in your bar to open the leaderboard as a panel. Nothing else on screen moves."
    : "The ranking widget docked to your screen edge.";
  ["lb-show-row", "lb-reserve-row", "lb-dock-row", "lb-monitor-row"].forEach((id) =>
    el(id).classList.toggle("hidden", !windowMode),
  );
  const monitors = Array.isArray(state.monitors) ? state.monitors : [];
  el("lb-monitor-row").classList.toggle("hidden", !windowMode || monitors.length === 0);
  const select = el("lb-monitor");
  const wanted = lb.monitor || "";
  const options = ["", ...monitors];
  if (wanted && !monitors.includes(wanted)) options.push(wanted); // keep a disconnected choice visible
  if (select.dataset.options !== options.join("|")) {
    select.dataset.options = options.join("|");
    select.innerHTML = options
      .map((m) => `<option value="${m}">${m === "" ? "Follow the focused monitor" : m}</option>`)
      .join("");
  }
  select.value = wanted;
  el("lb-reserve-row").classList.toggle("hidden", !windowMode || state.platform !== "linux");
  el("lb-reserve").checked = Boolean(lb.reserveSpace);
  el("lb-show").checked = lb.show;
  el("lb-pin").checked = lb.pinOnTop;
  const pinSupported = state.alwaysOnTopSupported !== false;
  el("lb-pin").disabled = !pinSupported;
  el("lb-pin-hint").classList.toggle("hidden", pinSupported);
  el("lb-rows").value = lb.rows;
  el("lb-rows-val").textContent = lb.rows;
  document.querySelectorAll("#lb-dock button").forEach((b) => {
    b.classList.toggle("active", b.getAttribute("data-side") === lb.dockSide);
  });
}

// --- Startup / service ------------------------------------------------------

function renderStartup() {
  el("auto-launch").checked = state.config.autoLaunch;
  el("start-hidden").checked = state.config.startHidden;
  el("port").value = state.config.port;
  el("startup-blurb").textContent =
    state.platform === "win32"
      ? "AI Pulse runs quietly in your system tray. Disable start-on-login here or in Task Manager → Startup at any time."
      : state.platform === "linux"
        ? "AI Pulse runs quietly in your bar's tray. Start-on-login is an XDG autostart entry" +
          (state.autostartPath ? " (" + state.autostartPath + ")" : "") + " — toggle it here or delete that file."
        : "AI Pulse runs quietly in your system tray. Disable start-on-login here at any time.";
  if (state.logPath) {
    el("update-log-path").textContent = "Logs: " + state.logPath.replace(/server\.log$/, "{server,updater}.log");
  }

  const s = state.service;
  const detail = s.userStopped
    ? "Stopped by you."
    : s.failed
      ? "Failed to start after repeated attempts — click Start to retry."
      : `PID ${s.pid ?? "—"} · restarts ${s.restarts} · ` +
        (s.lastHealthyAt ? `healthy at ${new Date(s.lastHealthyAt).toLocaleTimeString()}` : "starting…");
  el("service-detail").textContent = detail;
  const showStart = s.userStopped || s.failed;
  el("svc-stop").classList.toggle("hidden", showStart);
  el("svc-start").classList.toggle("hidden", !showStart);
}

function renderPills() {
  const s = state.service;
  const pill = el("service-pill");
  if (s.userStopped) {
    pill.textContent = "Service: stopped";
    pill.className = "pill pill-warn";
  } else if (s.failed) {
    pill.textContent = "Service: failed";
    pill.className = "pill pill-err";
  } else if (s.healthy) {
    pill.textContent = s.adopted ? "Service: running (adopted)" : "Service: running";
    pill.className = "pill pill-ok";
  } else {
    pill.textContent = s.running ? "Service: starting" : "Service: restarting";
    pill.className = "pill pill-muted";
  }
}

// --- Updates ----------------------------------------------------------------

function renderUpdate() {
  const u = state.update;
  if (!u) return;
  el("update-version").textContent = "v" + u.currentVersion;
  const statusText = {
    idle: "",
    checking: "Checking…",
    "not-available": "You're up to date ✓",
    available: "Update available: v" + u.availableVersion,
    downloading: "Downloading… " + u.percent + "%",
    downloaded: "Update v" + u.availableVersion + " ready to install",
    error: "Update check failed" + (u.error ? ": " + u.error : ""),
    unsupported: "Updates apply to the installed app only",
  }[u.status] || "";
  el("update-status").textContent = statusText;
  el("update-check").classList.toggle("hidden", u.status === "downloaded" || u.status === "downloading");
  el("update-check").disabled = u.status === "checking" || u.status === "unsupported";
  el("update-download").classList.toggle("hidden", u.status !== "available");
  el("update-install").classList.toggle("hidden", u.status !== "downloaded");
}

// --- AI provider health -----------------------------------------------------

let localAI = null;
let localActionPending = false;
let refreshingHealth = false;

function showPane(name) {
  document.querySelectorAll("[data-settings-pane]").forEach((pane) => { pane.hidden = pane.dataset.settingsPane !== name; });
  document.querySelectorAll("[data-pane]").forEach((button) => {
    button.classList.toggle("active", button.dataset.pane === name);
    if (button.dataset.pane === name) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  document.querySelector(".content").scrollTop = 0;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  return bytes >= 1024 ** 3 ? (bytes / 1024 ** 3).toFixed(1) + " GB" : Math.round(bytes / 1024 ** 2) + " MB";
}

function renderLocalAI(status) {
  if (!status || status.error && !status.state) return;
  localAI = status;
  const busy = ["downloading", "starting", "verifying", "stopping"].includes(status.state);
  const ready = status.state === "ready";
  const profile = el("local-profile");
  if (Array.isArray(status.profiles)) {
    const signature = JSON.stringify(status.profiles);
    if (profile.dataset.signature !== signature) {
      const selected = profile.value;
      profile.replaceChildren(new Option("Recommended for this computer", "auto"));
      for (const p of status.profiles) profile.add(new Option(`${p.name} · ${formatBytes(p.bytes)}`, p.id));
      if ([...profile.options].some((p) => p.value === selected)) profile.value = selected;
      profile.dataset.signature = signature;
    }
  }
  profile.disabled = busy || localActionPending;
  const hw = status.hardware || {};
  el("local-hardware").textContent = hw.memoryGB ? `${hw.memoryGB} GB RAM · ${hw.cpus || ""} CPU cores · ${status.recommendedProfile === "balanced" ? "Balanced model recommended" : "Light model recommended"}` : "Runs on your CPU. A dedicated graphics card is not required.";
  const labels = { unconfigured: "Ready to set up", downloading: "Downloading local AI…", verifying: "Verifying the download…", starting: "Starting your model…", ready: "Your local AI is ready", degraded: "Basic curation is active", error: "Setup needs attention", stopping: "Stopping local AI…" };
  el("local-status-title").textContent = labels[status.state] || status.state;
  el("local-status-detail").textContent = status.error?.message || status.error || (ready ? `${status.model?.name || "Your model"} processes summaries and chat on this computer.` : busy ? "You can keep using the radar. The download is verified before it runs." : "Set up once, then use AI without an account or a cloud model.");
  const progress = status.progress || {};
  const percent = Math.min(100, Math.max(0, Number(progress.percent) || 0));
  el("local-progress").hidden = !busy;
  if (progress.totalBytes) el("local-progress").value = percent;
  else el("local-progress").removeAttribute("value");
  el("local-progress-label").textContent = progress.totalBytes && busy ? `${formatBytes(progress.downloadedBytes)} of ${formatBytes(progress.totalBytes)} · ${Math.round(percent)}%` : "";
  el("local-install").disabled = busy || localActionPending || hw.supported === false;
  el("local-install").textContent = ready ? "Change / repair model" : status.state === "error" ? "Retry setup" : "Set up local AI";
  el("local-cancel").classList.toggle("hidden", !busy);
  el("local-continue").textContent = ready ? "Open your radar →" : "Explore without AI";
  const pill = el("ai-pill");
  pill.textContent = ready ? "AI: local & ready" : busy ? "AI: setting up" : "AI: basic curation";
  pill.className = "pill " + (ready ? "pill-ok" : "pill-warn");
}

async function refreshProviders() {
  if (refreshingHealth) return;
  refreshingHealth = true;
  try {
    const [health, local] = await Promise.all([api.serverHealth(), api.apiGet("/api/local-ai")]);
    if (health?.ok && !stackProfile) await loadPreferences();
    renderLocalAI(local);
    const box = el("providers");
    box.replaceChildren();
    const summary = document.createElement("p");
    summary.className = "muted";
    const outcome = health?.analyst?.lastOutcome;
    summary.textContent = !health?.ok ? "Waiting for the background service…" : outcome?.source === "local" ? "The last briefing was processed by the local model." : "Rankings and basic curation are available. The local model adds summaries and chat.";
    box.append(summary);
  } catch {
    el("local-status-title").textContent = "Waiting for the background service…";
  } finally { refreshingHealth = false; }
}

async function setupLocalAI() {
  localActionPending = true;
  el("local-install").disabled = true;
  try {
    const result = await api.apiPost("/api/local-ai/setup", { profile: el("local-profile").value });
    if (result.error && !result.state) throw new Error(result.error);
    renderLocalAI(result);
  } catch (error) {
    // Keep the failure visible until the next health poll. Rendering the old
    // status in finally used to hide setup errors immediately after they were
    // shown, leaving the user with no actionable feedback.
    localAI = { ...(localAI || {}), state: "error", error: error.message || "Setup failed" };
    el("local-status-title").textContent = "Could not start setup";
    el("local-status-detail").textContent = error.message || "Setup failed";
    renderLocalAI(localAI);
  } finally {
    localActionPending = false;
    if (localAI) renderLocalAI(localAI);
    else el("local-install").disabled = false;
  }
}

// --- Preferences (My Stack + notifications) ---------------------------------

let stackProfile = null;
let modelList = [];

async function loadPreferences() {
  const [stack, models, prefs] = await Promise.all([
    api.apiGet("/api/stack"),
    api.apiGet("/api/models"),
    api.apiGet("/api/notifications/prefs"),
  ]);
  if (stack && !stack.error) stackProfile = stack;
  if (Array.isArray(models)) modelList = models;
  if (prefs && !prefs.error) {
    el("notif-news").checked = Boolean(prefs.news);
    el("notif-rankings").checked = Boolean(prefs.rankings);
    el("notif-upgrades").checked = Boolean(prefs.upgrades);
  }
  renderPreferences();
}

function setPrio(name, val) {
  const v = Number(val) || 0;
  el("prio-" + name).value = v;
  el("prio-" + name + "-v").textContent = v;
}

function renderPreferences() {
  if (!stackProfile) return;
  const dl = el("pref-model-list");
  dl.innerHTML = "";
  for (const m of modelList) {
    const opt = document.createElement("option");
    opt.value = m.name;
    dl.appendChild(opt);
  }
  el("pref-model").value = stackProfile.primaryModelName || "";
  el("pref-provider").value = stackProfile.provider || "";
  el("pref-budget").value = stackProfile.budgetTier || "mid";
  el("pref-notes").value = stackProfile.notes || "";
  setPrio("coding", stackProfile.priorityCoding);
  setPrio("reasoning", stackProfile.priorityReasoning);
  setPrio("speed", stackProfile.prioritySpeed);
  setPrio("cost", stackProfile.priorityCost);
}

async function savePreferences() {
  const btn = el("pref-save");
  const status = el("pref-status");
  btn.disabled = true;
  status.textContent = "Saving…";

  const name = el("pref-model").value.trim();
  const match = modelList.find((m) => m.name.toLowerCase() === name.toLowerCase());
  const slug = match ? match.slug : stackProfile?.primaryModelSlug || "";
  const provider = el("pref-provider").value.trim() || "Cursor";

  // Non-destructively update (or create) the primary entry, keeping any others.
  const entries = Array.isArray(stackProfile?.entries) ? stackProfile.entries.map((e) => ({ ...e })) : [];
  let primary = entries.find((e) => e.role === "primary");
  if (!primary) {
    primary = { id: "e_primary", role: "primary", areas: ["coding"], providers: [provider], modelSlug: slug, modelName: match ? match.name : name };
    entries.unshift(primary);
  } else {
    primary.modelSlug = slug;
    primary.modelName = match ? match.name : name;
    primary.providers = [provider];
  }

  const body = {
    entries,
    priorityCoding: Number(el("prio-coding").value),
    priorityReasoning: Number(el("prio-reasoning").value),
    prioritySpeed: Number(el("prio-speed").value),
    priorityCost: Number(el("prio-cost").value),
    budgetTier: el("pref-budget").value,
    notes: el("pref-notes").value.trim(),
  };
  const res = await api.apiPut("/api/stack", body);
  if (res && !res.error) {
    stackProfile = res;
    renderPreferences();
    status.textContent = "Saved ✓";
  } else {
    status.textContent = "Save failed — is the service running?";
  }
  btn.disabled = false;
  setTimeout(() => (status.textContent = ""), 2500);
}

async function saveNotifs() {
  await api.apiPut("/api/notifications/prefs", {
    news: el("notif-news").checked,
    rankings: el("notif-rankings").checked,
    upgrades: el("notif-upgrades").checked,
  });
}

function wirePreferences() {
  for (const name of ["coding", "reasoning", "speed", "cost"]) {
    el("prio-" + name).addEventListener("input", (e) => {
      el("prio-" + name + "-v").textContent = e.target.value;
    });
  }
  el("pref-save").addEventListener("click", savePreferences);
  el("notif-news").addEventListener("change", saveNotifs);
  el("notif-rankings").addEventListener("change", saveNotifs);
  el("notif-upgrades").addEventListener("change", saveNotifs);
}

// --- Wiring -----------------------------------------------------------------

function applyState() {
  if (!state) return;
  renderKeys();
  renderLeaderboard();
  renderStartup();
  renderPills();
  renderUpdate();
}

let rowsTimer = null;

function wireControls() {
  document.querySelectorAll("[data-pane]").forEach((button) => button.addEventListener("click", () => showPane(button.dataset.pane)));
  el("local-install").addEventListener("click", setupLocalAI);
  el("local-cancel").addEventListener("click", async () => {
    const result = await api.apiPost("/api/local-ai/cancel", {});
    renderLocalAI(result);
  });
  el("local-continue").addEventListener("click", async () => {
    state = await api.setPrefs({ setupComplete: true });
    await api.openDashboard();
  });
  el("lb-show").addEventListener("change", async (e) => {
    state = await api.toggleLeaderboard(e.target.checked);
    applyState();
  });
  document.querySelectorAll("#lb-mode button").forEach((b) => {
    b.addEventListener("click", async () => {
      const mode = b.getAttribute("data-mode");
      state = await api.setPrefs({ leaderboard: { ...state.config.leaderboard, mode } });
      applyState();
    });
  });
  el("lb-monitor").addEventListener("change", async (e) => {
    state = await api.setPrefs({ leaderboard: { ...state.config.leaderboard, monitor: e.target.value } });
    applyState();
  });
  el("lb-reserve").addEventListener("change", async (e) => {
    state = await api.setPrefs({ leaderboard: { ...state.config.leaderboard, reserveSpace: e.target.checked } });
    applyState();
  });
  el("lb-pin").addEventListener("change", async (e) => {
    state = await api.setPrefs({ leaderboard: { ...state.config.leaderboard, pinOnTop: e.target.checked } });
    applyState();
  });
  document.querySelectorAll("#lb-dock button").forEach((b) => {
    b.addEventListener("click", async () => {
      const side = b.getAttribute("data-side");
      state = await api.setPrefs({ leaderboard: { ...state.config.leaderboard, dockSide: side } });
      applyState();
    });
  });
  el("lb-rows").addEventListener("input", (e) => {
    el("lb-rows-val").textContent = e.target.value;
    if (rowsTimer) clearTimeout(rowsTimer);
    const rows = Number(e.target.value);
    rowsTimer = setTimeout(async () => {
      state = await api.setPrefs({ leaderboard: { ...state.config.leaderboard, rows } });
    }, 300);
  });

  el("auto-launch").addEventListener("change", async (e) => {
    state = await api.setPrefs({ autoLaunch: e.target.checked });
    applyState();
  });
  el("start-hidden").addEventListener("change", async (e) => {
    state = await api.setPrefs({ startHidden: e.target.checked });
    applyState();
  });
  el("port-save").addEventListener("click", async () => {
    const port = Number(el("port").value);
    if (port >= 1 && port <= 65535) {
      state = await api.setPrefs({ port });
      applyState();
    }
  });

  el("svc-restart").addEventListener("click", () => api.serviceRestart());
  el("svc-stop").addEventListener("click", () => api.serviceStop());
  el("svc-start").addEventListener("click", () => api.serviceStart());
  el("open-dashboard").addEventListener("click", () => api.openDashboard());
  el("open-logs").addEventListener("click", () => api.openLogs());

  el("update-check").addEventListener("click", async () => {
    state.update = await api.updateCheck();
    renderUpdate();
  });
  el("update-download").addEventListener("click", async () => {
    state.update = await api.updateDownload();
    renderUpdate();
  });
  el("update-install").addEventListener("click", () => api.updateInstall());
  el("open-releases").addEventListener("click", (e) => {
    e.preventDefault();
    api.openExternal("https://github.com/FernandoSLuz/ai-pulse/releases");
  });
}

async function init() {
  state = await api.getState();
  wireControls();
  wirePreferences();
  applyState();
  api.onState((s) => {
    state = s;
    renderPills();
    renderStartup();
    renderUpdate();
  });
  loadPreferences();
  refreshProviders();
  setInterval(refreshProviders, 1500);
}

init().catch((error) => { el("local-status-title").textContent = "Could not load settings"; el("local-status-detail").textContent = error.message; });
