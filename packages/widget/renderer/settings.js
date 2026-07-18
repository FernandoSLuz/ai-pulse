"use strict";
const api = window.aiPulse;

// curator: true => powers AI curation (the rotation). You need at least one.
const KEY_META = {
  GEMINI_API_KEY: { label: "Gemini", role: "AI curator · 3.5 & 2.5 Flash", hint: "Best free quality", url: "https://aistudio.google.com/apikey", curator: true },
  CEREBRAS_API_KEY: { label: "Cerebras", role: "AI curator · Llama 3.3 70B", hint: "Fast, generous free tier", url: "https://cloud.cerebras.ai", curator: true },
  GROQ_API_KEY: { label: "Groq", role: "AI curator · Llama 3.1 8B", hint: "Fast; small daily budget", url: "https://console.groq.com/keys", curator: true },
  OPENROUTER_API_KEY: { label: "OpenRouter", role: "AI curator · free pool", hint: "Llama 3.3 70B / DeepSeek V3 (free)", url: "https://openrouter.ai/keys", curator: true },
  AA_API_KEY: { label: "Artificial Analysis", role: "Benchmarks", hint: "Live model rankings", url: "https://artificialanalysis.ai/insights", curator: false },
  TAVILY_API_KEY: { label: "Tavily", role: "Chat web search", hint: "1,000 free credits/month", url: "https://app.tavily.com", curator: false },
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
  const curators = state.keyNames.filter((n) => KEY_META[n]?.curator);
  const others = state.keyNames.filter((n) => !KEY_META[n]?.curator);
  const anyCurator = curators.some((n) => state.config.keys[n]);

  const group = (heading, names) => {
    const h = document.createElement("div");
    h.className = "keys-group-head";
    h.textContent = heading;
    container.appendChild(h);
    for (const n of names) container.appendChild(renderKeyRow(n));
  };

  group(
    anyCurator ? "AI curators" : "AI curators — add at least one",
    curators,
  );
  group("Data & search (optional)", others);
}

// --- Leaderboard ------------------------------------------------------------

function renderLeaderboard() {
  const lb = state.config.leaderboard;
  el("lb-show").checked = lb.show;
  el("lb-pin").checked = lb.pinOnTop;
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

  const s = state.service;
  const detail = s.userStopped
    ? "Stopped by you."
    : `PID ${s.pid ?? "—"} · restarts ${s.restarts} · ` +
      (s.lastHealthyAt ? `healthy at ${new Date(s.lastHealthyAt).toLocaleTimeString()}` : "starting…");
  el("service-detail").textContent = detail;
  el("svc-stop").classList.toggle("hidden", s.userStopped);
  el("svc-start").classList.toggle("hidden", !s.userStopped);
}

function renderPills() {
  const s = state.service;
  const pill = el("service-pill");
  if (s.userStopped) {
    pill.textContent = "Service: stopped";
    pill.className = "pill pill-warn";
  } else if (s.healthy) {
    pill.textContent = "Service: running";
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

async function refreshProviders() {
  let health;
  try {
    health = await api.serverHealth();
  } catch {
    return;
  }
  const box = el("providers");
  const aiPill = el("ai-pill");

  if (!health || !health.ok || !health.analyst) {
    box.innerHTML = '<div class="muted small">Waiting for the service…</div>';
    aiPill.textContent = "AI: …";
    aiPill.className = "pill pill-muted";
    return;
  }

  // Server is up — load preferences if the initial attempt raced the boot.
  if (!stackProfile) loadPreferences();

  const a = health.analyst;
  const outcome = a.lastOutcome;
  if (a.configuredCount === 0) {
    aiPill.textContent = "AI: no key";
    aiPill.className = "pill pill-err";
  } else if (outcome && outcome.degraded) {
    aiPill.textContent = "AI: degraded (rules)";
    aiPill.className = "pill pill-warn";
  } else if (outcome && outcome.source && outcome.source !== "rules") {
    aiPill.textContent = "AI: " + outcome.source + " ✓";
    aiPill.className = "pill pill-ok";
  } else {
    aiPill.textContent = "AI: " + a.availableCount + "/" + a.configuredCount + " ready";
    aiPill.className = a.availableCount > 0 ? "pill pill-ok" : "pill pill-warn";
  }

  box.innerHTML = "";
  for (const c of a.candidates.filter((x) => x.configured)) {
    const row = document.createElement("div");
    row.className = "prov";
    const dot = document.createElement("span");
    dot.className = "dot " + (c.available ? "on" : c.cooldownMs > 0 ? "cool" : "off");
    const label = document.createElement("span");
    label.className = "label";
    label.textContent = c.label;
    const st = document.createElement("span");
    st.className = "state";
    st.textContent = c.available
      ? "ready"
      : c.cooldownMs > 0
        ? "cooldown " + Math.ceil(c.cooldownMs / 60000) + "m (" + c.reason + ")"
        : c.reason;
    row.appendChild(dot);
    row.appendChild(label);
    row.appendChild(st);
    box.appendChild(row);
  }
  if (box.childElementCount === 0) {
    box.innerHTML = '<div class="muted small">No AI provider configured — add a key above.</div>';
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
  el("lb-show").addEventListener("change", async (e) => {
    state = await api.toggleLeaderboard(e.target.checked);
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
  setInterval(refreshProviders, 5000);
}

init();
