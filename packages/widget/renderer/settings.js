"use strict";
const api = window.aiPulse;

const KEY_META = {
  GEMINI_API_KEY: { label: "Gemini", hint: "aistudio.google.com/apikey — best free quality" },
  CEREBRAS_API_KEY: { label: "Cerebras", hint: "cloud.cerebras.ai — fast, generous free tier" },
  GROQ_API_KEY: { label: "Groq", hint: "console.groq.com/keys — small daily budget" },
  OPENROUTER_API_KEY: { label: "OpenRouter", hint: "openrouter.ai/keys — free model pool" },
  AA_API_KEY: { label: "Artificial Analysis", hint: "artificialanalysis.ai/insights — benchmark data" },
  TAVILY_API_KEY: { label: "Tavily", hint: "app.tavily.com — web search for chat" },
};

let state = null;
const el = (id) => document.getElementById(id);

// --- Connections ------------------------------------------------------------

function renderKeys() {
  const container = el("keys");
  container.innerHTML = "";
  for (const name of state.keyNames) {
    const meta = KEY_META[name] || { label: name, hint: "" };
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
    const hint = document.createElement("div");
    hint.className = "key-hint";
    hint.textContent = meta.hint;
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
    container.appendChild(row);
  }
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

// --- Wiring -----------------------------------------------------------------

function applyState() {
  if (!state) return;
  renderKeys();
  renderLeaderboard();
  renderStartup();
  renderPills();
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
}

async function init() {
  state = await api.getState();
  wireControls();
  applyState();
  api.onState((s) => {
    state = s;
    renderPills();
    renderStartup();
  });
  refreshProviders();
  setInterval(refreshProviders, 5000);
}

init();
