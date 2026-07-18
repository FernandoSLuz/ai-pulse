const API = "";

let state = {
  rankings: null,
  news: [],
  newsUpdatedAt: null,
  newsPeriod: "all",
  aiPicks: [],
  aiPickPeriod: "today",
  videos: [],
  videosUpdatedAt: null,
  briefing: null,
  stack: null,
  newsCategory: "all",
  sortKey: "intelligence",
  sortDir: "desc",
};

const SORTABLE = {
  name: { key: "name", type: "string", defaultDir: "asc", label: "Model" },
  creator: { key: "creator", type: "string", defaultDir: "asc", label: "Creator" },
  intelligence: { key: "intelligence", type: "number", defaultDir: "desc", label: "Intel" },
  coding: { key: "coding", type: "number", defaultDir: "desc", label: "Code" },
  math: { key: "math", type: "number", defaultDir: "desc", label: "Math" },
  priceBlended: { key: "priceBlended", type: "number", defaultDir: "asc", label: "Price" },
  speed: { key: "speed", type: "number", defaultDir: "desc", label: "Speed" },
  accessibilityScore: { key: "accessibilityScore", type: "number", defaultDir: "desc", label: "Access" },
};

function sortModels(models) {
  const col = SORTABLE[state.sortKey];
  if (!col) return models;
  return [...models].sort((a, b) => {
    if (col.type === "string") {
      const va = String(a[col.key] ?? "").toLowerCase();
      const vb = String(b[col.key] ?? "").toLowerCase();
      return state.sortDir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
    }
    const va = Number(a[col.key]) || 0;
    const vb = Number(b[col.key]) || 0;
    return state.sortDir === "asc" ? va - vb : vb - va;
  });
}

function updateSortHeaders() {
  document.querySelectorAll("#rankings-table th.sortable").forEach((th) => {
    const key = th.dataset.sort;
    const col = SORTABLE[key];
    const arrow = state.sortKey === key ? (state.sortDir === "asc" ? " ▲" : " ▼") : "";
    th.textContent = (col?.label ?? key) + arrow;
    th.classList.toggle("sort-active", state.sortKey === key);
    th.classList.toggle("sort-asc", state.sortKey === key && state.sortDir === "asc");
    th.classList.toggle("sort-desc", state.sortKey === key && state.sortDir === "desc");
  });
}

function onSortHeaderClick(key) {
  if (!SORTABLE[key]) return;
  if (state.sortKey === key) {
    state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
  } else {
    state.sortKey = key;
    state.sortDir = SORTABLE[key].defaultDir;
  }
  updateSortHeaders();
  renderRankings();
}

function connectWs() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/ws`);

  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === "rankings") {
      state.rankings = msg.payload;
      renderRankings();
    }
    if (msg.type === "news") {
      const payload = msg.payload;
      state.newsUpdatedAt = payload?.updatedAt ?? state.newsUpdatedAt;
      if (
        Array.isArray(payload?.items) &&
        state.newsPeriod === "all" &&
        state.newsCategory === "all"
      ) {
        state.news = payload.items;
        renderNews();
      } else {
        loadNews().catch((err) => console.error(err));
      }
    }
    if (msg.type === "ai_picks") {
      const period = state.aiPickPeriod;
      state.aiPicks = msg.payload?.[period] ?? [];
      renderAiPicks();
    }
    if (msg.type === "videos") {
      const payload = msg.payload;
      state.videos = payload?.items ?? [];
      state.videosUpdatedAt = payload?.updatedAt ?? null;
      renderCreators();
    }
    if (msg.type === "briefing") {
      state.briefing = msg.payload;
      renderBriefing();
    }
    if (msg.type === "stack") {
      state.stack = msg.payload;
      renderStackChip();
      renderRankings();
      updateSuggestionUI();
      renderRoleGapBanner();
    }
  };

  ws.onclose = () => setTimeout(connectWs, 3000);
}

async function fetchJson(path, opts = {}) {
  const { timeoutMs = 30_000, ...fetchOpts } = opts;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${API}${path}`, { ...fetchOpts, signal: controller.signal });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function cleanHeadline(text) {
  return String(text).replace(/\((\d+\.\d{2,})\)/g, (_, n) => `(${Number(n).toFixed(1)})`);
}

function renderStackSummary() {
  const entries = (state.stack?.entries ?? []).filter((e) => e.modelSlug);
  if (!entries.length) {
    return `<div class="stack-summary empty">
      <p class="muted">No models in My Stack yet.</p>
      <button type="button" class="btn btn-ghost btn-sm" id="open-stack-from-briefing">Set up My Stack</button>
    </div>`;
  }
  return `<div class="stack-summary">
    ${entries.map((e) => {
      const areas = normalizeAreas(e).map((a) => AREA_LABELS[a] || a).join(", ");
      const providers = normalizeProviders(e).join(", ");
      const model = state.rankings?.models?.find((m) => m.slug === e.modelSlug);
      const intel = model ? fmtMetric(model.intelligence, 1) : "—";
      const price = model ? `$${model.priceBlended.toFixed(2)}` : "—";
      return `<div class="stack-row">
        <div class="stack-row-role">${escapeHtml(ROLE_LABELS[e.role] || e.role)}</div>
        <div class="stack-row-body">
          <strong>${escapeHtml(e.modelName)}</strong>
          <span class="stack-row-meta">${escapeHtml(areas)} · ${escapeHtml(providers)}</span>
        </div>
        <div class="stack-row-stats">
          <span title="Intelligence">${intel}</span>
          <span title="Price / 1M">${price}</span>
        </div>
      </div>`;
    }).join("")}
  </div>`;
}

function renderRoleGapBanner() {
  const banner = document.getElementById("role-gap-banner");
  if (!banner) return;
  const gaps = state.stack?.roleGaps ?? [];
  if (!gaps.length) {
    banner.classList.add("hidden");
    banner.innerHTML = "";
    return;
  }
  banner.classList.remove("hidden");
  banner.innerHTML = gaps.map((g) => {
    const setup =
      g.role === "free"
        ? `<p class="gap-setup">In Cursor: Settings → Models → Override OpenAI Base URL (e.g. <code>http://localhost:11434/v1</code> for Ollama) → Add Model → pick this name.</p>`
        : "";
    return `<div class="gap-card" data-role="${escapeHtml(g.role)}">
      <div class="gap-card-main">
        <div class="gap-label">Missing ${escapeHtml(ROLE_LABELS[g.role] || g.role)}</div>
        <div class="gap-pick">Try <strong>${escapeHtml(g.modelName)}</strong></div>
        ${setup}
      </div>
      <div class="gap-actions">
        <button type="button" class="btn btn-accent" data-gap-add="${escapeHtml(g.role)}">Add to stack</button>
        <button type="button" class="btn btn-ghost" data-gap-dismiss="${escapeHtml(g.role)}">Dismiss</button>
      </div>
    </div>`;
  }).join("");

  banner.querySelectorAll("[data-gap-add]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      state.stack = await fetchJson(`/api/stack/role-gaps/${btn.getAttribute("data-gap-add")}/add`, { method: "POST" });
      renderStackChip();
      updateSuggestionUI();
      renderRoleGapBanner();
      renderBriefing();
      renderRankings();
    });
  });
  banner.querySelectorAll("[data-gap-dismiss]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      state.stack = await fetchJson(`/api/stack/role-gaps/${btn.getAttribute("data-gap-dismiss")}/dismiss`, { method: "POST" });
      updateSuggestionUI();
      renderRoleGapBanner();
      renderStackChip();
    });
  });
}

function renderBriefing() {
  const el = document.getElementById("briefing");
  const b = state.briefing;
  if (!b) {
    el.innerHTML = `<p class="muted">Loading analyst briefing… Configure GEMINI_API_KEY in .env for AI-powered summaries (Groq/Ollama optional).</p>`;
    renderRoleGapBanner();
    return;
  }

  const sourceLabel =
    b.analystSource === "gemini"
      ? "Gemini"
      : b.analystSource === "groq"
        ? "Groq AI"
        : b.analystSource === "ollama"
          ? "Ollama"
          : "Rule-based";
  const gaps = state.stack?.roleGaps ?? [];
  // Live role-gap banner owns missing-role suggestions; hide stale briefing upgrade if it's a gap.
  const showUpgrade =
    b.upgradeSuggestion &&
    !gaps.some((g) => b.upgradeSlug === g.modelSlug || /missing a/i.test(b.upgradeSuggestion));
  const upgradeHtml = showUpgrade
    ? `<div class="upgrade-callout">
        <span>${escapeHtml(b.upgradeSuggestion)}</span>
        <div>
          <button class="btn btn-accent" id="briefing-apply">Switch to this model</button>
          <button class="btn btn-ghost" id="briefing-dismiss">Dismiss</button>
        </div>
      </div>`
    : "";

  el.innerHTML = `
    <div class="briefing-headline">${escapeHtml(cleanHeadline(b.headline))}</div>
    <div class="briefing-meta">
      <span>${timeAgo(b.createdAt)}</span>
      <span class="briefing-source">${sourceLabel}</span>
    </div>
    <div class="briefing-sections">
      ${section("Breaking", b.breaking)}
      ${section("Watch list", b.watchList)}
      ${section("New models", b.newModels)}
      <details open>
        <summary>Your stack</summary>
        ${renderStackSummary()}
      </details>
    </div>
    ${upgradeHtml}
  `;

  document.getElementById("open-stack-from-briefing")?.addEventListener("click", openDrawer);
  document.getElementById("briefing-apply")?.addEventListener("click", async () => {
    await fetchJson("/api/stack/apply-suggestion", { method: "POST" });
    if (state.briefing) {
      state.briefing = { ...state.briefing, upgradeSuggestion: null, upgradeSlug: null };
    }
    await loadStack();
    renderBriefing();
    renderRankings();
  });
  document.getElementById("briefing-dismiss")?.addEventListener("click", async () => {
    await fetchJson("/api/briefing/dismiss-upgrade", { method: "POST" });
    if (state.briefing) {
      state.briefing = { ...state.briefing, upgradeSuggestion: null, upgradeSlug: null };
    }
    await loadStack();
    renderBriefing();
  });

  renderRoleGapBanner();
}

function section(title, items) {
  if (!items?.length) return "";
  return `<details open><summary>${title}</summary><ul>${items.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul></details>`;
}

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function stripHtml(text) {
  return String(text)
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function fmtMetric(value, decimals = 0) {
  if (value == null || value === 0) return "—";
  return decimals ? Number(value).toFixed(decimals) : Math.round(value);
}

function renderNews() {
  const feed = document.getElementById("news-feed");
  const updated = document.getElementById("news-updated");
  if (updated) {
    updated.textContent = state.newsUpdatedAt ? `Updated ${timeAgo(state.newsUpdatedAt)}` : "";
  }
  const items = state.news ?? [];

  if (!items.length) {
    feed.innerHTML = `<p class="muted">No news for this filter. Try Refresh news or a wider time range.</p>`;
    return;
  }

  feed.innerHTML = items.slice(0, 40).map((n) => `
    <article class="news-card">
      <div class="news-meta">
        <span class="source-tier tier-${n.tier ?? 3}">${escapeHtml(n.source)}</span>
        <span>${timeAgo(n.publishedAt)}</span>
        <span class="news-score"><svg class="icon-star" width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3 7h7l-5.5 4.5L18 22l-6-4-6 4 1.5-8.5L2 9h7z"/></svg> ${n.relevanceScore}</span>
      </div>
      <h3><a href="${escapeHtml(n.link)}" target="_blank" rel="noopener">${escapeHtml(stripHtml(n.title))}</a></h3>
      ${n.summary ? `<p class="muted news-summary">${escapeHtml(stripHtml(n.summary).slice(0, 120))}…</p>` : ""}
    </article>
  `).join("");
}

function renderAiPicks() {
  const feed = document.getElementById("aipick-feed");
  if (!feed) return;
  const items = state.aiPicks ?? [];
  if (!items.length) {
    feed.innerHTML = `<p class="muted">No groundbreaking picks for this period yet.</p>`;
    return;
  }
  feed.innerHTML = items.map((n) => `
    <article class="news-card aipick-card">
      <div class="news-meta">
        <span class="aipick-badge">AI Pick</span>
        <span>${escapeHtml(n.source)}</span>
        <span>${timeAgo(n.publishedAt)}</span>
      </div>
      <h3><a href="${escapeHtml(n.link)}" target="_blank" rel="noopener">${escapeHtml(stripHtml(n.title))}</a></h3>
      ${n.aiPickReason ? `<p class="aipick-reason">${escapeHtml(n.aiPickReason)}</p>` : ""}
    </article>
  `).join("");
}

function renderCreators() {
  const feed = document.getElementById("creators-feed");
  const updated = document.getElementById("videos-updated");
  if (!feed) return;
  if (updated) {
    updated.textContent = state.videosUpdatedAt ? `Updated ${timeAgo(state.videosUpdatedAt)}` : "";
  }
  const items = state.videos ?? [];
  if (!items.length) {
    feed.innerHTML = `<p class="muted">No creator uploads yet. YouTube channels poll every 30 minutes.</p>`;
    return;
  }
  feed.innerHTML = items.slice(0, 30).map((v) => `
    <a class="creator-card" href="${escapeHtml(v.link)}" target="_blank" rel="noopener">
      <img class="creator-thumb" src="${escapeHtml(v.thumbnail)}" alt="" loading="lazy" width="120" height="68" />
      <div class="creator-body">
        <div class="creator-channel">${escapeHtml(v.channel)}</div>
        <div class="creator-title">${escapeHtml(v.title)}</div>
        <div class="muted">${timeAgo(v.publishedAt)}</div>
      </div>
    </a>
  `).join("");
}

async function loadNews(period = state.newsPeriod, category = state.newsCategory) {
  const params = new URLSearchParams({
    limit: "50",
    period: period || "all",
    category: category || "all",
  });
  const data = await fetchJson(`/api/news?${params}`);
  state.news = data.items ?? [];
  state.newsUpdatedAt = data.updatedAt ?? state.newsUpdatedAt;
  state.newsPeriod = period || "all";
  state.newsCategory = category || "all";
  renderNews();
}

async function loadAiPicks(period = state.aiPickPeriod) {
  const data = await fetchJson(`/api/news?view=ai_pick&period=${period}&limit=20`);
  state.aiPicks = data.items ?? [];
  state.aiPickPeriod = period;
  renderAiPicks();
}

async function loadVideos() {
  const data = await fetchJson("/api/videos?limit=40");
  state.videos = data.items ?? [];
  state.videosUpdatedAt = data.updatedAt ?? null;
  renderCreators();
}

function winnerBadges(slug, winners) {
  if (!winners) return "";
  const badges = [];
  if (winners.overall === slug) badges.push('<span class="badge">#1 Intel</span>');
  if (winners.coding === slug) badges.push('<span class="badge">Code</span>');
  if (winners.math === slug) badges.push('<span class="badge">Math</span>');
  if (winners.price === slug) badges.push('<span class="badge">Price</span>');
  if (winners.speed === slug) badges.push('<span class="badge">Speed</span>');
  if (winners.accessibility === slug) badges.push('<span class="badge">Open</span>');
  return badges.join("");
}

function renderRankings() {
  const r = state.rankings;
  const tbody = document.querySelector("#rankings-table tbody");
  const updated = document.getElementById("rankings-updated");
  if (!r?.models?.length) {
    tbody.innerHTML = `<tr><td colspan="10" class="muted">Loading benchmarks…</td></tr>`;
    return;
  }

  updated.textContent = r.health?.stale && r.health.warning
    ? `⚠ ${r.health.warning}`
    : `Updated ${timeAgo(r.updatedAt)}`;
  updated.classList.toggle("stale-warning", Boolean(r.health?.stale));
  const mine = state.stack?.primaryModelSlug;
  const sorted = sortModels(r.models);

  tbody.innerHTML = sorted.slice(0, 30).map((m, i) => {
    const cls = [
      i === 0 ? "row-gold" : "",
      m.slug === mine ? "row-mine" : "",
    ].filter(Boolean).join(" ");
    return `<tr class="${cls}">
      <td>${i + 1}</td>
      <td class="${state.sortKey === "name" ? "col-sort-active" : ""}">${escapeHtml(m.name)}</td>
      <td class="${state.sortKey === "creator" ? "col-sort-active" : ""}">${escapeHtml(m.creator)}</td>
      <td class="${state.sortKey === "intelligence" ? "col-sort-active" : ""}">${fmtMetric(m.intelligence, 1)}</td>
      <td class="${state.sortKey === "coding" ? "col-sort-active" : ""}">${fmtMetric(m.coding, 1)}</td>
      <td class="${state.sortKey === "math" ? "col-sort-active" : ""}">${fmtMetric(m.math, 1)}</td>
      <td class="${state.sortKey === "priceBlended" ? "col-sort-active" : ""}">$${m.priceBlended.toFixed(2)}</td>
      <td class="${state.sortKey === "speed" ? "col-sort-active" : ""}">${fmtMetric(m.speed)}</td>
      <td class="${state.sortKey === "accessibilityScore" ? "col-sort-active" : ""}">${escapeHtml(m.accessibility)}</td>
      <td>${winnerBadges(m.slug, r.winners)}</td>
    </tr>`;
  }).join("");
}

function renderStackChip() {
  const chip = document.getElementById("stack-chip");
  const badge = document.getElementById("upgrade-badge");
  const s = state.stack;
  const entries = s?.entries?.filter((e) => e.modelSlug) ?? [];
  if (!entries.length) {
    chip.textContent = "Set your models in My Stack →";
    chip.style.cursor = "pointer";
    chip.onclick = openDrawer;
    badge.classList.add("hidden");
    return;
  }
  const primary = entries.find((e) => e.role === "primary") ?? entries[0];
  const extra = entries.length > 1 ? ` +${entries.length - 1}` : "";
  chip.textContent = `${primary.modelName} · ${(normalizeProviders(primary)).join(", ")}${extra}`;
  chip.title = entries.map((e) => {
    const areas = normalizeAreas(e).join("+");
    const providers = normalizeProviders(e).join(", ");
    return `${ROLE_LABELS[e.role] || e.role} (${areas}) @ ${providers}: ${e.modelName}`;
  }).join("\n");
  chip.onclick = openDrawer;
  chip.style.cursor = "pointer";

  const hasSuggestion =
    entries.some((e) => e.suggestedUpgradeSlug && !e.suggestedUpgradeDismissed) ||
    (s?.roleGaps?.length ?? 0) > 0;
  badge.classList.toggle("hidden", !hasSuggestion);
  badge.textContent = (s?.roleGaps?.length ?? 0) > 0 ? "Missing role" : "Better match available";
  badge.onclick = openDrawer;
}

const ROLE_LABELS = {
  primary: "Primary hard tasks",
  secondary: "Secondary budget hard tasks",
  free: "Free option",
};

const AREA_LABELS = {
  coding: "Coding",
  writing: "Writing",
  reasoning: "Reasoning",
  general: "General",
};

const PROVIDERS = [
  "Cursor",
  "Claude Code",
  "Web",
  "Anthropic API",
  "OpenAI API",
  "OpenRouter",
  "Ollama",
  "Other",
];

let modelOptions = [];

function newLocalEntryId() {
  return `e_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function emptyEntry() {
  return {
    id: newLocalEntryId(),
    modelSlug: "",
    modelName: "",
    role: "primary",
    areas: ["coding"],
    providers: ["Cursor"],
    suggestedUpgradeSlug: null,
    suggestedUpgradeDismissed: false,
  };
}

function modelSelectHtml(selectedSlug) {
  return `<option value="">— Select model —</option>` +
    modelOptions.map((m) =>
      `<option value="${escapeHtml(m.slug)}" ${m.slug === selectedSlug ? "selected" : ""}>${escapeHtml(m.name)} (${escapeHtml(m.creator)})</option>`
    ).join("");
}

function roleSelectHtml(selected) {
  return Object.entries(ROLE_LABELS).map(([value, label]) =>
    `<option value="${value}" ${value === selected ? "selected" : ""}>${label}</option>`
  ).join("");
}

function checkboxGroupHtml(name, options, selected) {
  const selectedSet = new Set(selected || []);
  return Object.entries(options).map(([value, label]) =>
    `<label class="chip-check"><input type="checkbox" data-group="${name}" value="${escapeHtml(value)}" ${selectedSet.has(value) ? "checked" : ""} /> ${escapeHtml(label)}</label>`
  ).join("");
}

function providerCheckboxHtml(selected) {
  const selectedSet = new Set(selected || []);
  return PROVIDERS.map((p) =>
    `<label class="chip-check"><input type="checkbox" data-group="providers" value="${escapeHtml(p)}" ${selectedSet.has(p) ? "checked" : ""} /> ${escapeHtml(p)}</label>`
  ).join("");
}

function normalizeAreas(entry) {
  if (Array.isArray(entry.areas) && entry.areas.length) return entry.areas;
  if (entry.area) return [entry.area];
  return ["coding"];
}

function normalizeProviders(entry) {
  if (Array.isArray(entry.providers) && entry.providers.length) return entry.providers;
  if (entry.provider) return [entry.provider];
  return ["Cursor"];
}

function renderStackEntries() {
  const container = document.getElementById("stack-entries");
  const entries = state.stack?.entries?.length ? state.stack.entries : [emptyEntry()];
  if (!state.stack) state.stack = { entries };
  if (!state.stack.entries?.length) state.stack.entries = entries;

  container.innerHTML = state.stack.entries.map((e) => {
    const areas = normalizeAreas(e);
    const providers = normalizeProviders(e);
    const suggested = e.suggestedUpgradeSlug && !e.suggestedUpgradeDismissed
      ? state.rankings?.models?.find((m) => m.slug === e.suggestedUpgradeSlug)
      : null;
    const suggestHtml = suggested
      ? `<div class="entry-suggestion">
          Better: <strong>${escapeHtml(suggested.name)}</strong>
          <button type="button" class="btn btn-accent btn-sm" data-apply="${escapeHtml(e.id)}">Switch</button>
          <button type="button" class="btn btn-ghost btn-sm" data-dismiss="${escapeHtml(e.id)}">Dismiss</button>
        </div>`
      : "";

    return `<div class="stack-entry" data-id="${escapeHtml(e.id)}">
      <div class="stack-entry-grid">
        <label>Model
          <select class="entry-model">${modelSelectHtml(e.modelSlug)}</select>
        </label>
        <label>Role
          <select class="entry-role">${roleSelectHtml(e.role)}</select>
        </label>
        <div class="chip-field">
          <span class="chip-label">Areas</span>
          <div class="chip-row">${checkboxGroupHtml("areas", AREA_LABELS, areas)}</div>
        </div>
        <div class="chip-field">
          <span class="chip-label">Providers</span>
          <div class="chip-row">${providerCheckboxHtml(providers)}</div>
        </div>
      </div>
      ${suggestHtml}
      <button type="button" class="btn btn-ghost btn-sm entry-remove" data-remove="${escapeHtml(e.id)}">Remove</button>
    </div>`;
  }).join("");

  container.querySelectorAll("[data-remove]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-remove");
      state.stack.entries = state.stack.entries.filter((e) => e.id !== id);
      if (!state.stack.entries.length) state.stack.entries = [emptyEntry()];
      renderStackEntries();
    });
  });

  container.querySelectorAll("[data-apply]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-apply");
      state.stack = await fetchJson(`/api/stack/entries/${id}/apply-suggestion`, { method: "POST" });
      if (state.briefing) {
        state.briefing = { ...state.briefing, upgradeSuggestion: null, upgradeSlug: null };
        renderBriefing();
      }
      renderStackEntries();
      renderStackChip();
      renderRankings();
    });
  });

  container.querySelectorAll("[data-dismiss]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-dismiss");
      state.stack = await fetchJson(`/api/stack/entries/${id}/dismiss-suggestion`, { method: "POST" });
      if (state.briefing) {
        state.briefing = { ...state.briefing, upgradeSuggestion: null, upgradeSlug: null };
        renderBriefing();
      }
      renderStackEntries();
      renderStackChip();
    });
  });
}

function collectEntriesFromDom() {
  const rows = [...document.querySelectorAll("#stack-entries .stack-entry")];
  return rows.map((row) => {
    const id = row.dataset.id;
    const prev = state.stack?.entries?.find((e) => e.id === id);
    const modelSel = row.querySelector(".entry-model");
    const slug = modelSel.value;
    const name = modelSel.selectedOptions[0]?.text?.split(" (")[0] ?? "";
    const areas = [...row.querySelectorAll('input[data-group="areas"]:checked')].map((el) => el.value);
    const providers = [...row.querySelectorAll('input[data-group="providers"]:checked')].map((el) => el.value);
    return {
      id,
      modelSlug: slug,
      modelName: name,
      role: row.querySelector(".entry-role").value,
      areas: areas.length ? areas : ["coding"],
      providers: providers.length ? providers : ["Cursor"],
      suggestedUpgradeSlug: prev?.suggestedUpgradeSlug ?? null,
      suggestedUpgradeDismissed: prev?.suggestedUpgradeDismissed ?? false,
    };
  });
}

function updateSuggestionUI() {
  const box = document.getElementById("suggestion-box");
  const gapsBox = document.getElementById("role-gaps-box");
  if (!box) return;

  const preferEl = document.getElementById("prefer-cursor-ready");
  if (preferEl) preferEl.checked = state.stack?.preferCursorReady !== false;

  const gaps = state.stack?.roleGaps ?? [];
  if (gapsBox) {
    if (!gaps.length) {
      gapsBox.classList.add("hidden");
      gapsBox.innerHTML = "";
    } else {
      gapsBox.classList.remove("hidden");
      gapsBox.innerHTML = `<div class="gaps-title">Missing roles — SOTA picks</div>` + gaps.map((g) => `
        <div class="suggestion-line">
          <span>${escapeHtml(g.reason)}</span>
          <button type="button" class="btn btn-accent btn-sm" data-gap-add="${escapeHtml(g.role)}">Add to stack</button>
          <button type="button" class="btn btn-ghost btn-sm" data-gap-dismiss="${escapeHtml(g.role)}">Dismiss</button>
        </div>`).join("");
      gapsBox.querySelectorAll("[data-gap-add]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          state.stack = await fetchJson(`/api/stack/role-gaps/${btn.getAttribute("data-gap-add")}/add`, { method: "POST" });
          renderStackEntries();
          renderStackChip();
          updateSuggestionUI();
          renderRoleGapBanner();
          renderBriefing();
          renderRankings();
        });
      });
      gapsBox.querySelectorAll("[data-gap-dismiss]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          state.stack = await fetchJson(`/api/stack/role-gaps/${btn.getAttribute("data-gap-dismiss")}/dismiss`, { method: "POST" });
          updateSuggestionUI();
          renderRoleGapBanner();
          renderStackChip();
        });
      });
    }
  }

  const pending = (state.stack?.entries ?? []).filter(
    (e) => e.suggestedUpgradeSlug && !e.suggestedUpgradeDismissed,
  );
  if (!pending.length) {
    box.classList.add("hidden");
    box.innerHTML = "";
    return;
  }
  box.classList.remove("hidden");
  box.innerHTML = pending.map((e) => {
    const model = state.rankings?.models?.find((m) => m.slug === e.suggestedUpgradeSlug);
    const areas = normalizeAreas(e).map((a) => AREA_LABELS[a] || a).join(", ");
    const providers = normalizeProviders(e).join(", ");
    return `<div class="suggestion-line">
      <span>${escapeHtml(ROLE_LABELS[e.role] || e.role)} (${escapeHtml(areas)}) @ ${escapeHtml(providers)}:
        consider <strong>${escapeHtml(model?.name ?? e.suggestedUpgradeSlug)}</strong></span>
      <button type="button" class="btn btn-accent btn-sm" data-box-apply="${escapeHtml(e.id)}">Switch</button>
      <button type="button" class="btn btn-ghost btn-sm" data-box-dismiss="${escapeHtml(e.id)}">Dismiss</button>
    </div>`;
  }).join("");

  box.querySelectorAll("[data-box-apply]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      state.stack = await fetchJson(`/api/stack/entries/${btn.getAttribute("data-box-apply")}/apply-suggestion`, { method: "POST" });
      renderStackEntries();
      renderStackChip();
      updateSuggestionUI();
      renderRankings();
    });
  });
  box.querySelectorAll("[data-box-dismiss]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      state.stack = await fetchJson(`/api/stack/entries/${btn.getAttribute("data-box-dismiss")}/dismiss-suggestion`, { method: "POST" });
      renderStackEntries();
      renderStackChip();
      updateSuggestionUI();
    });
  });
}

async function loadModels() {
  modelOptions = await fetchJson("/api/models");
}

async function loadStack() {
  state.stack = await fetchJson("/api/stack");
  if (!state.stack.entries) state.stack.entries = [];
  renderStackEntries();
  renderStackChip();
  updateSuggestionUI();
  renderRoleGapBanner();
}

function openDrawer() {
  document.getElementById("stack-drawer").classList.remove("hidden");
  renderStackEntries();
  updateSuggestionUI();
}

function closeDrawer() {
  document.getElementById("stack-drawer").classList.add("hidden");
}

document.getElementById("open-stack").addEventListener("click", openDrawer);
document.getElementById("close-stack").addEventListener("click", closeDrawer);
document.querySelector(".drawer-backdrop").addEventListener("click", closeDrawer);

document.getElementById("add-stack-entry").addEventListener("click", () => {
  if (!state.stack) state.stack = { entries: [] };
  if (!state.stack.entries) state.stack.entries = [];
  // Sync current DOM values before adding
  state.stack.entries = collectEntriesFromDom();
  state.stack.entries.push(emptyEntry());
  renderStackEntries();
});

document.getElementById("news-period-filters")?.addEventListener("click", async (e) => {
  const btn = e.target.closest(".filter");
  if (!btn) return;
  document.querySelectorAll("#news-period-filters .filter").forEach((f) => f.classList.remove("active"));
  btn.classList.add("active");
  try {
    await loadNews(btn.dataset.period, state.newsCategory);
  } catch (err) {
    console.error(err);
  }
});

document.getElementById("news-filters").addEventListener("click", async (e) => {
  const btn = e.target.closest(".filter");
  if (!btn) return;
  document.querySelectorAll("#news-filters .filter").forEach((f) => f.classList.remove("active"));
  btn.classList.add("active");
  try {
    await loadNews(state.newsPeriod, btn.dataset.cat);
  } catch (err) {
    console.error(err);
  }
});

document.getElementById("aipick-filters")?.addEventListener("click", async (e) => {
  const btn = e.target.closest(".filter");
  if (!btn) return;
  document.querySelectorAll("#aipick-filters .filter").forEach((f) => f.classList.remove("active"));
  btn.classList.add("active");
  try {
    await loadAiPicks(btn.dataset.period);
  } catch (err) {
    console.error(err);
  }
});

document.getElementById("refresh-news")?.addEventListener("click", async () => {
  const btn = document.getElementById("refresh-news");
  const prev = btn.textContent;
  btn.textContent = "Refreshing…";
  btn.disabled = true;
  try {
    await fetchJson("/api/news/refresh", { method: "POST", timeoutMs: 90_000 });
    await Promise.allSettled([
      loadNews(state.newsPeriod, state.newsCategory),
      loadAiPicks(state.aiPickPeriod),
    ]);
  } catch (err) {
    console.error(err);
    btn.textContent = "Refresh failed";
    // Still try to show whatever is cached on the server.
    await Promise.allSettled([
      loadNews(state.newsPeriod, state.newsCategory),
      loadAiPicks(state.aiPickPeriod),
    ]);
    await new Promise((r) => setTimeout(r, 1200));
  } finally {
    btn.textContent = prev;
    btn.disabled = false;
  }
});

document.getElementById("stack-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const entries = collectEntriesFromDom().filter((row) => row.modelSlug);
  const preferCursorReady = document.getElementById("prefer-cursor-ready")?.checked !== false;
  state.stack = await fetchJson("/api/stack", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entries, preferCursorReady }),
  });
  renderStackEntries();
  renderStackChip();
  updateSuggestionUI();
  renderRoleGapBanner();
  renderBriefing();
  renderRankings();
  closeDrawer();
});

document.getElementById("refresh-briefing").addEventListener("click", async () => {
  const btn = document.getElementById("refresh-briefing");
  btn.textContent = "Refreshing…";
  btn.disabled = true;
  try {
    state.briefing = await fetchJson("/api/briefing/refresh", { method: "POST" });
    renderBriefing();
    updateSuggestionUI();
  } finally {
    btn.textContent = "Refresh briefing";
    btn.disabled = false;
  }
});

/* —— Embedded chat —— */
const CHAT_MODEL_KEY = "ai-pulse-chat-model";
const chatState = {
  open: false,
  models: [],
  searchBackend: "none",
  searchEnabled: false,
  messages: [],
  sending: false,
};

const CHAT_SUGGESTIONS = [
  "Who leads coding right now?",
  "What’s new in AI news today?",
  "Should I upgrade my free stack model?",
  "What changed on the leaderboard this week?",
];

function escapeChatHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function searchStatusLabel() {
  if (chatState.searchBackend === "tavily") return "Web search: on (Tavily)";
  if (chatState.searchBackend === "gemini") return "Web search: on (Gemini)";
  return "Web search: off — add TAVILY_API_KEY or GEMINI_API_KEY";
}

function renderChatSearchStatus() {
  const el = document.getElementById("chat-search-status");
  if (el) el.textContent = searchStatusLabel();
}

function populateChatModels() {
  const select = document.getElementById("chat-model");
  if (!select) return;
  select.innerHTML = "";
  if (!chatState.models.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "No models — set API keys in .env";
    select.appendChild(opt);
    select.disabled = true;
    return;
  }
  select.disabled = false;
  const saved = localStorage.getItem(CHAT_MODEL_KEY);
  for (const m of chatState.models) {
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = `${m.label} — ${m.description}`;
    select.appendChild(opt);
  }
  if (saved && chatState.models.some((m) => m.id === saved)) {
    select.value = saved;
  }
}

function renderChatMessages() {
  const root = document.getElementById("chat-messages");
  if (!root) return;

  if (!chatState.messages.length) {
    root.innerHTML = `
      <div class="chat-empty">
        <p>Ask about news, benchmarks, or your stack. Broader questions can use the search agent when configured.</p>
        <div class="chat-suggestions">
          ${CHAT_SUGGESTIONS.map(
            (s) => `<button type="button" class="chat-suggestion" data-prompt="${escapeChatHtml(s)}">${escapeChatHtml(s)}</button>`,
          ).join("")}
        </div>
      </div>`;
    root.querySelectorAll(".chat-suggestion").forEach((btn) => {
      btn.addEventListener("click", () => {
        const input = document.getElementById("chat-input");
        input.value = btn.dataset.prompt;
        input.focus();
        document.getElementById("chat-form").requestSubmit();
      });
    });
    return;
  }

  root.innerHTML = chatState.messages
    .map((m) => {
      if (m.role === "error") {
        return `<div class="chat-bubble error">${escapeChatHtml(m.content)}</div>`;
      }
      const meta =
        m.role === "assistant" && (m.searched || (m.citations && m.citations.length))
          ? `<div class="chat-meta">
              ${m.searched ? `<span class="chat-chip">Searched the web</span>` : ""}
            </div>
            ${
              m.citations?.length
                ? `<div class="chat-citations">${m.citations
                    .map(
                      (c) =>
                        `<a href="${escapeChatHtml(c.url)}" target="_blank" rel="noopener">${escapeChatHtml(c.title || c.url)}</a>`,
                    )
                    .join("")}</div>`
                : ""
            }`
          : "";
      return `<div class="chat-bubble ${m.role}">${escapeChatHtml(m.content)}${meta}</div>`;
    })
    .join("");

  root.scrollTop = root.scrollHeight;
}

function setChatOpen(open) {
  chatState.open = open;
  document.getElementById("chat-panel")?.classList.toggle("hidden", !open);
  if (open) {
    document.getElementById("chat-input")?.focus();
    renderChatMessages();
  }
}

async function loadChatModels() {
  try {
    const data = await fetchJson("/api/chat/models");
    chatState.models = data.models ?? [];
    chatState.searchBackend = data.searchBackend ?? "none";
    chatState.searchEnabled = Boolean(data.searchEnabled);
    populateChatModels();
    renderChatSearchStatus();
  } catch (err) {
    console.warn("Chat models unavailable", err);
    chatState.models = [];
    populateChatModels();
    renderChatSearchStatus();
  }
}

async function sendChatMessage(text) {
  const content = text.trim();
  if (!content || chatState.sending) return;

  const modelId = document.getElementById("chat-model")?.value;
  if (!modelId) {
    chatState.messages.push({
      role: "error",
      content: "Configure GROQ_API_KEY and/or GEMINI_API_KEY in .env, then restart the server.",
    });
    renderChatMessages();
    return;
  }

  localStorage.setItem(CHAT_MODEL_KEY, modelId);
  chatState.messages.push({ role: "user", content });
  renderChatMessages();

  const input = document.getElementById("chat-input");
  const sendBtn = document.getElementById("chat-send");
  input.value = "";
  chatState.sending = true;
  sendBtn.disabled = true;
  sendBtn.textContent = "…";

  const history = chatState.messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role, content: m.content }));

  try {
    const result = await fetchJson("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modelId, messages: history }),
    });
    chatState.messages.push({
      role: "assistant",
      content: result.reply ?? "",
      searched: Array.isArray(result.toolsUsed) && result.toolsUsed.includes("web_search"),
      citations: result.citations ?? [],
    });
  } catch (err) {
    let msg = err.message || "Chat request failed";
    try {
      const parsed = JSON.parse(msg);
      if (parsed?.error) msg = parsed.error;
    } catch {
      /* keep raw */
    }
    chatState.messages.push({
      role: "error",
      content: msg,
    });
  } finally {
    chatState.sending = false;
    sendBtn.disabled = false;
    sendBtn.textContent = "Send";
    renderChatMessages();
  }
}

document.getElementById("chat-fab")?.addEventListener("click", () => setChatOpen(!chatState.open));
document.getElementById("chat-close")?.addEventListener("click", () => setChatOpen(false));
document.getElementById("chat-clear")?.addEventListener("click", () => {
  chatState.messages = [];
  renderChatMessages();
});
document.getElementById("chat-model")?.addEventListener("change", (e) => {
  localStorage.setItem(CHAT_MODEL_KEY, e.target.value);
});
document.getElementById("chat-form")?.addEventListener("submit", (e) => {
  e.preventDefault();
  sendChatMessage(document.getElementById("chat-input").value);
});
document.getElementById("chat-input")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    document.getElementById("chat-form").requestSubmit();
  }
});

async function init() {
  connectWs();

  const [rankingsR, newsR, briefingR] = await Promise.allSettled([
    fetchJson("/api/rankings"),
    fetchJson(`/api/news?limit=50&period=${state.newsPeriod}&category=${state.newsCategory}`),
    fetchJson("/api/briefing"),
  ]);

  let anyOk = false;

  if (rankingsR.status === "fulfilled") {
    state.rankings = rankingsR.value;
    anyOk = true;
  } else {
    console.error(rankingsR.reason);
  }

  if (newsR.status === "fulfilled") {
    const newsPayload = newsR.value;
    state.news = newsPayload.items ?? (Array.isArray(newsPayload) ? newsPayload : []);
    state.newsUpdatedAt = newsPayload.updatedAt ?? null;
    anyOk = true;
  } else {
    console.error(newsR.reason);
  }

  if (briefingR.status === "fulfilled") {
    state.briefing = briefingR.value;
    anyOk = true;
  } else {
    console.error(briefingR.reason);
  }

  await Promise.allSettled([
    loadModels().catch((err) => console.error(err)),
    loadStack().catch((err) => console.error(err)),
    loadAiPicks("today").catch((err) => console.error(err)),
    loadVideos().catch((err) => console.error(err)),
    loadChatModels().catch((err) => console.error(err)),
  ]);

  renderBriefing();
  renderNews();
  renderAiPicks();
  renderCreators();
  renderRankings();

  document.querySelectorAll("#rankings-table th.sortable").forEach((th) => {
    th.addEventListener("click", () => onSortHeaderClick(th.dataset.sort));
  });
  updateSortHeaders();

  if (!anyOk) {
    document.getElementById("briefing").innerHTML =
      `<p class="muted">Cannot reach AI Pulse server. Run <code>npm run dev</code> in the ai-pulse folder.</p>`;
  }
}

init();
