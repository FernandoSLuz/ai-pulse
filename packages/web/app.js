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
  companyVideos: [],
  companyVideosUpdatedAt: null,
  briefing: null,
  stack: null,
  newsCategory: "all",
  sortKey: "intelligence",
  sortDir: "desc",
  view: "overview",
  pages: { news: 1, aipicks: 1, creators: 1, companies: 1, rankings: 1 },
  benchmarkQuery: "",
  benchmarkView: "tested",
  benchmarkAccess: "all",
  benchmarkSource: "aa",
  publicBoards: [],
  videoKind: "creator",
  videoChannels: [],
  videoChannelPage: 1,
};

const PAGE_SIZE = { news: 5, aipicks: 5, creators: 4, companies: 4, rankings: 10 };

function renderPager(id, key, total, size = PAGE_SIZE[key]) {
  const el = document.getElementById(id);
  if (!el) return;
  const pages = Math.max(1, Math.ceil(total / size));
  state.pages[key] = Math.min(state.pages[key], pages);
  if (pages <= 1) { el.innerHTML = ""; return; }
  el.innerHTML = `<button type="button" class="btn btn-ghost btn-sm" data-page="prev" ${state.pages[key] === 1 ? "disabled" : ""}>Previous</button><span>Page ${state.pages[key]} of ${pages}</span><button type="button" class="btn btn-ghost btn-sm" data-page="next" ${state.pages[key] === pages ? "disabled" : ""}>Next</button>`;
  el.querySelectorAll("[data-page]").forEach((button) => button.addEventListener("click", () => { state.pages[key] += button.dataset.page === "next" ? 1 : -1; ({ news: renderNews, aipicks: renderAiPicks, creators: renderCreators, companies: renderCompanyVideos, rankings: renderRankings }[key])(); }));
}

function pageItems(items, key) {
  const size = PAGE_SIZE[key];
  const start = (state.pages[key] - 1) * size;
  return items.slice(start, start + size);
}

const VIEW_COPY = {
  overview: ["Overview", "A calm read of what changed and what deserves your attention."],
  news: ["News", "Signals and picks, with room to read what matters."],
  videos: ["Videos", "Creators and official labs, separated for quick scanning."],
  benchmarks: ["Benchmarks", "Compare the models that matter by intelligence, coding, speed, and access."],
};

function setView(view) {
  if (!VIEW_COPY[view]) view = "overview";
  state.view = view;
  document.body.dataset.view = view;
  document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === view));
  const [title, description] = VIEW_COPY[view];
  document.getElementById("view-title").textContent = title;
  document.getElementById("view-description").textContent = description;
  if (view === "overview" || view === "news") { renderNews(); renderAiPicks(); }
  if (view === "videos") { setVideoKind(state.videoKind); renderCreators(); renderCompanyVideos(); loadVideoChannels().catch(showVideoChannelError); }
}

const SORTABLE = {
  name: { key: "name", type: "string", defaultDir: "asc", label: "Model" },
  creator: { key: "creator", type: "string", defaultDir: "asc", label: "Creator" },
  intelligence: { key: "intelligence", type: "number", defaultDir: "desc", label: "AA Intelligence Index" },
  coding: { key: "coding", type: "number", defaultDir: "desc", label: "Code" },
  math: { key: "math", type: "number", defaultDir: "desc", label: "Math" },
  priceBlended: { key: "priceBlended", type: "number", defaultDir: "asc", label: "$/1M in/out" },
  speed: { key: "speed", type: "number", defaultDir: "desc", label: "Speed" },
  accessibilityScore: { key: "accessibilityScore", type: "number", defaultDir: "desc", label: "Access" },
};


// Omarchy theme bridge: the server pushes {type:"theme"} when the palette
// changes; re-fetch /theme.css without a page reload.
function reloadThemeCss(version) {
  const link = document.getElementById("theme-css");
  if (link) link.href = "/theme.css?v=" + (version || Date.now());
}

function sortModels(models) {
  const col = SORTABLE[state.sortKey];
  if (!col) return models;
  return [...models].sort((a, b) => {
    if (col.type === "string") {
      const va = String(a[col.key] ?? "").toLowerCase();
      const vb = String(b[col.key] ?? "").toLowerCase();
      return state.sortDir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
    }
    const ar = a[col.key];
    const br = b[col.key];
    const av = Number(ar);
    const bv = Number(br);
    const aMissing = ar == null || ar === "" || !Number.isFinite(av);
    const bMissing = br == null || br === "" || !Number.isFinite(bv);
    if (aMissing || bMissing) {
      if (aMissing && bMissing) return 0;
      return aMissing ? 1 : -1;
    }
    const va = av;
    const vb = bv;
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
  ws.onopen = () => { const el = document.getElementById("connection-status"); if (el) el.innerHTML = "<i></i> Local service connected"; };
  ws.addEventListener("message", (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.type === "theme") reloadThemeCss(msg.payload && msg.payload.version);
    } catch {
      /* not our message */
    }
  });

  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === "rankings") {
      state.rankings = msg.payload;
      renderRankings();
    }
    if (msg.type === "public_benchmarks") {
      setPublicBoards(msg.payload?.boards);
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
      state.companyVideos = payload?.companyItems ?? [];
      state.companyVideosUpdatedAt = payload?.updatedAt ?? null;
      renderCreators();
      renderCompanyVideos();
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

  ws.onclose = () => { const el = document.getElementById("connection-status"); if (el) el.innerHTML = "<i></i> Cached data"; setTimeout(connectWs, 3000); };
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

function resolveSlug(slug) {
  return state.rankings?.variantAliases?.[slug] ?? slug;
}

function variantHoverTitle(model) {
  const variants = model?.variants ?? [];
  const exact = model?.name ? `Exact benchmark configuration: ${model.name}` : "Exact benchmark configuration";
  return variants.length ? `${exact} · ${variants.length} related variant${variants.length === 1 ? "" : "s"}: ${variants.map((v) => v.name).join(", ")}` : exact;
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
      const model = state.rankings?.models?.find((m) => m.slug === resolveSlug(e.modelSlug));
      const intel = model ? fmtMetric(model.intelligence, 1) : "—";
      const price = model ? fmtPrice(model.priceBlended) : "—";
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
  const labels = gaps.map((g) => ROLE_LABELS[g.role] || g.role).join(", ");
  banner.innerHTML = `<div class="gap-card gap-summary">
    <div class="gap-card-main">
      <div class="gap-label">My Stack needs attention</div>
      <div class="gap-pick">${gaps.length} role${gaps.length === 1 ? "" : "s"} to review: <strong>${escapeHtml(labels)}</strong></div>
      <p class="gap-setup">Open My Stack to review the local model suggestions and choose what to add.</p>
    </div>
    <div class="gap-actions"><button type="button" class="btn btn-accent" id="open-stack-gaps">Open My Stack</button></div>
  </div>`;
  banner.querySelector("#open-stack-gaps")?.addEventListener("click", openDrawer);

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
    el.innerHTML = `<p class="muted">Loading your local analyst briefing…</p>`;
    renderRoleGapBanner();
    return;
  }

  const sourceLabel =
    b.analystSource === "deepseek"
      ? "DeepSeek V4"
      : b.analystSource === "gemini"
        ? "Gemini"
        : b.analystSource === "groq"
          ? "Groq AI"
          : b.analystSource === "cerebras"
            ? "Cerebras"
            : b.analystSource === "openrouter"
              ? "OpenRouter"
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

  document.getElementById("open-stack-from-briefing")?.addEventListener("click", promptOpenApp);
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
  return `<details><summary>${title}</summary><ul>${items.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul></details>`;
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
  if (value == null || !Number.isFinite(Number(value)) || Number(value) <= 0) return "—";
  return decimals ? Number(value).toFixed(decimals) : Math.round(value);
}

function fmtPrice(value) {
  if (value == null || !Number.isFinite(Number(value)) || Number(value) < 0) return "—";
  const amount = Number(value);
  if (amount > 0 && amount < 0.000001) return "<$0.000001";
  if (amount === 0) return "$0.00";
  let text = amount.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  if (!text.includes(".")) text += ".00";
  else while (text.split(".")[1].length < 2) text += "0";
  return `$${text}`;
}

function safeLink(value) {
  try { const u = new URL(String(value || "")); return /^https?:$/.test(u.protocol) ? u.href : ""; } catch { return ""; }
}

function priceCell(model) {
  const input = fmtPrice(model.priceInput);
  const output = fmtPrice(model.priceOutput);
  const blended = fmtPrice(model.priceBlended);
  if (input === "—" && output === "—" && blended === "—") return `<span title="Pricing not published">—</span>`;
  return `<span title="Blended price uses the Artificial Analysis 3:1 input/output mix. Source: ${escapeHtml(model.fetchedAt || "leaderboard")}">${input} / ${output}<small class="price-blended"> · ${blended} blend</small></span>`;
}

function renderNews() {
  const feed = document.getElementById("news-feed");
  const updated = document.getElementById("news-updated");
  if (updated) {
    updated.textContent = state.newsUpdatedAt ? `Updated ${timeAgo(state.newsUpdatedAt)}` : "";
  }
  const items = state.news ?? [];

  if (!items.length) {
    document.getElementById("news-pager").innerHTML = "";
    feed.innerHTML = `<p class="muted">No news for this filter. Try Refresh news or a wider time range.</p>`;
    return;
  }
  const visible = state.view === "overview" ? items.slice(0, 3) : pageItems(items, "news");
  feed.innerHTML = visible.map((n) => `
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
  const pager = document.getElementById("news-pager");
  if (state.view === "overview") pager.innerHTML = `<button type="button" class="btn btn-ghost btn-sm" data-open-view="news">View all news →</button>`;
  else renderPager("news-pager", "news", items.length);
  pager.querySelector("[data-open-view]")?.addEventListener("click", () => setView("news"));
}

function renderAiPicks() {
  const feed = document.getElementById("aipick-feed");
  if (!feed) return;
  const items = state.aiPicks ?? [];
  if (!items.length) {
    document.getElementById("aipick-pager").innerHTML = "";
    feed.innerHTML = `<p class="muted">No groundbreaking picks for this period yet.</p>`;
    return;
  }
  const visible = state.view === "overview" ? items.slice(0, 3) : pageItems(items, "aipicks");
  feed.innerHTML = visible.map((n) => `
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
  const pager = document.getElementById("aipick-pager");
  if (state.view === "overview") pager.innerHTML = `<button type="button" class="btn btn-ghost btn-sm" data-open-view="news">View all picks →</button>`;
  else renderPager("aipick-pager", "aipicks", items.length);
  pager.querySelector("[data-open-view]")?.addEventListener("click", () => setView("news"));
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
    document.getElementById("creators-pager").innerHTML = "";
    feed.innerHTML = `<p class="muted">No creator uploads yet. YouTube channels poll every 30 minutes.</p>`;
    return;
  }
  feed.innerHTML = pageItems(items, "creators").map((v) => `
    <a class="creator-card" href="${escapeHtml(v.link)}" target="_blank" rel="noopener">
      <img class="creator-thumb" src="${escapeHtml(v.thumbnail)}" alt="" loading="lazy" width="120" height="68" />
      <div class="creator-body">
        <div class="creator-channel">${escapeHtml(v.channel)}</div>
        <div class="creator-title">${escapeHtml(v.title)}</div>
        <div class="muted">${timeAgo(v.publishedAt)}</div>
      </div>
    </a>
  `).join("");
  renderPager("creators-pager", "creators", items.length);
}

function renderCompanyVideos() {
  const feed = document.getElementById("companies-feed");
  const updated = document.getElementById("companies-videos-updated");
  if (!feed) return;
  if (updated) {
    updated.textContent = state.companyVideosUpdatedAt ? `Updated ${timeAgo(state.companyVideosUpdatedAt)}` : "";
  }
  const items = state.companyVideos ?? [];
  if (!items.length) {
    document.getElementById("companies-pager").innerHTML = "";
    feed.innerHTML = `<p class="muted">No company uploads yet. YouTube channels poll every 30 minutes.</p>`;
    return;
  }
  feed.innerHTML = pageItems(items, "companies").map((v) => `
    <a class="creator-card" href="${escapeHtml(v.link)}" target="_blank" rel="noopener">
      <img class="creator-thumb" src="${escapeHtml(v.thumbnail)}" alt="" loading="lazy" width="120" height="68" />
      <div class="creator-body">
        <div class="creator-channel">${escapeHtml(v.channel)}</div>
        <div class="creator-title">${escapeHtml(v.title)}</div>
        <div class="muted">${timeAgo(v.publishedAt)}</div>
      </div>
    </a>
  `).join("");
  renderPager("companies-pager", "companies", items.length);
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

async function loadCompanyVideos() {
  const data = await fetchJson("/api/videos?kind=company&limit=40");
  state.companyVideos = data.items ?? [];
  state.companyVideosUpdatedAt = data.updatedAt ?? null;
  renderCompanyVideos();
}

function setVideoKind(kind) {
  state.videoKind = kind === "company" ? "company" : "creator";
  document.querySelectorAll("[data-video-kind]").forEach((button) => {
    const selected = button.dataset.videoKind === state.videoKind;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  document.querySelector(".creators-panel")?.classList.toggle("hidden", state.videoKind !== "creator");
  document.querySelector(".companies-panel")?.classList.toggle("hidden", state.videoKind !== "company");
  document.querySelector(".companies-panel")?.classList.toggle("show-company", state.videoKind === "company");
  state.videoChannelPage = 1;
  renderVideoChannels();
}

function renderVideoChannels() {
  const channels = state.videoChannels.filter((channel) => channel.kind === state.videoKind);
  const totalPages = Math.max(1, Math.ceil(channels.length / 6));
  state.videoChannelPage = Math.min(state.videoChannelPage, totalPages);
  const start = (state.videoChannelPage - 1) * 6;
  const list = document.getElementById("video-channel-list");
  list.innerHTML = channels.slice(start, start + 6).map((channel) => `<div class="video-channel-row"><a href="https://www.youtube.com/channel/${encodeURIComponent(channel.channelId)}" target="_blank" rel="noopener noreferrer"><strong>${escapeHtml(channel.name)}</strong><span class="muted">${escapeHtml(channel.handle || channel.channelId)}</span></a>${channel.source === "user" ? `<button class="btn btn-ghost btn-sm" type="button" data-remove-channel="${escapeHtml(channel.channelId)}" aria-label="Remove ${escapeHtml(channel.name)}">Remove</button>` : '<span class="muted">Included</span>'}</div>`).join("") || '<p class="muted">No channels in this category yet.</p>';
  list.querySelectorAll("[data-remove-channel]").forEach((button) => button.addEventListener("click", async () => {
    button.disabled = true;
    const kind = state.videoKind;
    try {
      const result = await fetchJson(`/api/videos/channels/${encodeURIComponent(button.dataset.removeChannel)}?kind=${kind}`, { method: "DELETE" });
      state.videoChannels = result.channels || [];
      renderVideoChannels();
      document.getElementById("video-channel-status").textContent = "Channel removed.";
      await Promise.allSettled([loadVideos(), loadCompanyVideos()]);
    } catch (error) { showVideoChannelError(error); button.disabled = false; }
  }));
  const pager = document.getElementById("video-channel-pager");
  pager.innerHTML = totalPages > 1 ? `<button class="btn btn-ghost btn-sm" type="button" data-channel-page="prev" ${state.videoChannelPage === 1 ? "disabled" : ""}>Previous</button><span>Page ${state.videoChannelPage} of ${totalPages}</span><button class="btn btn-ghost btn-sm" type="button" data-channel-page="next" ${state.videoChannelPage === totalPages ? "disabled" : ""}>Next</button>` : "";
  pager.querySelectorAll("[data-channel-page]").forEach((button) => button.addEventListener("click", () => { state.videoChannelPage += button.dataset.channelPage === "next" ? 1 : -1; renderVideoChannels(); }));
}

async function loadVideoChannels() {
  const data = await fetchJson("/api/videos/channels");
  state.videoChannels = data.channels || [];
  renderVideoChannels();
}

function friendlyRequestError(error) {
  try { return JSON.parse(error.message).error || "The request could not be completed."; }
  catch { return error.name === "AbortError" ? "The service took too long. Please try again." : error.message || "The service could not be reached."; }
}

function showVideoChannelError(error) {
  document.getElementById("video-channel-status").textContent = friendlyRequestError(error);
}

function winnerBadges(slug, winners) {
  if (!winners) return "";
  const badges = [];
  if (winners.overall === slug) badges.push('<span class="badge">#1 Intel</span>');
  if (winners.coding === slug) badges.push('<span class="badge">Code</span>');
  if (winners.math === slug) badges.push('<span class="badge">Math</span>');
  if (winners.price === slug) badges.push('<span class="badge">Price</span>');
  if (winners.speed === slug) badges.push('<span class="badge">Speed</span>');
  if (winners.accessibility === slug) badges.push('<span class="badge">Access</span>');
  return badges.join("");
}

function benchmarkRows(snapshot) {
  if (state.benchmarkView === "best") return Array.isArray(snapshot.models) ? snapshot.models : [];
  return Array.isArray(snapshot.testedModels) ? snapshot.testedModels : (Array.isArray(snapshot.models) ? snapshot.models : []);
}

function renderRankings() {
  const r = state.rankings;
  const tbody = document.querySelector("#rankings-table tbody");
  const updated = document.getElementById("rankings-updated");
  const publicView = document.getElementById("public-benchmark-view");
  const table = document.getElementById("rankings-table");
  if (state.benchmarkSource !== "aa") {
    table.classList.add("hidden");
    document.getElementById("aa-attribution")?.classList.add("hidden");
    document.querySelectorAll(".benchmark-tools .segmented").forEach((el) => el.classList.add("hidden"));
    renderPublicBenchmark();
    return;
  }
  table.classList.remove("hidden");
  document.getElementById("aa-attribution")?.classList.remove("hidden");
  document.querySelectorAll(".benchmark-tools .segmented").forEach((el) => el.classList.remove("hidden"));
  if (publicView) { publicView.classList.add("hidden"); publicView.innerHTML = ""; }
  const rows = r ? benchmarkRows(r) : [];
  if (!rows.length) {
    document.getElementById("rankings-pager").innerHTML = "";
    tbody.innerHTML = `<tr><td colspan="10" class="muted">Loading benchmarks…</td></tr>`;
    return;
  }

  updated.textContent = r.health?.stale && r.health.warning
    ? `⚠ ${r.health.warning}`
    : `Updated ${timeAgo(r.updatedAt)}`;
  updated.classList.toggle("stale-warning", Boolean(r.health?.stale));
  const mine = resolveSlug(state.stack?.primaryModelSlug);
  const query = state.benchmarkQuery.trim().toLowerCase();
  const filtered = rows.filter((m) => {
    const matchesQuery = !query || `${m.name} ${m.displayName || ""} ${m.creator}`.toLowerCase().includes(query);
    const matchesAccess = state.benchmarkAccess !== "open" || /open weights|open source/i.test(String(m.accessibility || ""));
    return matchesQuery && matchesAccess;
  });
  const sorted = sortModels(filtered);

  const pageStart = (state.pages.rankings - 1) * PAGE_SIZE.rankings;
  tbody.innerHTML = sorted.slice(pageStart, pageStart + PAGE_SIZE.rankings).map((m, i) => {
    const cls = [
      i === 0 ? "row-gold" : "",
      m.slug === mine ? "row-mine" : "",
    ].filter(Boolean).join(" ");
    const shownName = m.name ?? m.displayName;
    const hover = variantHoverTitle(m);
    const winners = state.benchmarkView === "best" ? r.winners : (r.testedWinners ?? r.winners);
    const badges = winnerBadges(m.slug, winners);
    const bestBadge = state.benchmarkView === "best" && badges ? '<span class="badge">Best reported</span>' : "";
    return `<tr class="${cls}">
      <td>${pageStart + i + 1}</td>
      <td class="${state.sortKey === "name" ? "col-sort-active" : ""}" ${hover ? `title="${escapeHtml(hover)}"` : ""}>${safeLink(m.url) ? `<a href="${escapeHtml(safeLink(m.url))}" target="_blank" rel="noopener">${escapeHtml(shownName)}</a>` : escapeHtml(shownName)}</td>
      <td class="${state.sortKey === "creator" ? "col-sort-active" : ""}">${escapeHtml(m.creator)}</td>
      <td class="${state.sortKey === "intelligence" ? "col-sort-active" : ""}">${fmtMetric(m.intelligence, 1)}</td>
      <td class="${state.sortKey === "coding" ? "col-sort-active" : ""}">${fmtMetric(m.coding, 1)}</td>
      <td class="${state.sortKey === "math" ? "col-sort-active" : ""}">${fmtMetric(m.math, 1)}</td>
      <td class="${state.sortKey === "priceBlended" ? "col-sort-active" : ""}">${priceCell(m)}</td>
      <td class="${state.sortKey === "speed" ? "col-sort-active" : ""}">${fmtMetric(m.speed)}</td>
      <td class="${state.sortKey === "accessibilityScore" ? "col-sort-active" : ""}"><span>${escapeHtml(m.accessibility || "Unknown")}</span>${m.licenseUrl && safeLink(m.licenseUrl) ? ` · <a href="${escapeHtml(safeLink(m.licenseUrl))}" target="_blank" rel="noopener">license</a>` : ""}${m.weightsUrl && safeLink(m.weightsUrl) ? ` · <a href="${escapeHtml(safeLink(m.weightsUrl))}" target="_blank" rel="noopener">weights</a>` : ""}</td>
      <td>${badges}${bestBadge}</td>
    </tr>`;
  }).join("");
  renderPager("rankings-pager", "rankings", sorted.length);
}

function publicValue(value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  const number = Number(value);
  return Number.isInteger(number) ? String(number) : number.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function publicDate(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function publicCalendarDate(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function setPublicBoards(boards) {
  state.publicBoards = Array.isArray(boards) ? boards : [];
  const select = document.getElementById("benchmark-source");
  if (!select) return;
  const selected = state.benchmarkSource;
  select.innerHTML = '<option value="aa">Artificial Analysis</option>' + state.publicBoards.map((board) => `<option value="${escapeHtml(board.id)}">${escapeHtml(board.name || board.id)}</option>`).join("");
  select.value = [...select.options].some((option) => option.value === selected) ? selected : "aa";
  state.benchmarkSource = select.value;
}

function renderPublicBenchmark() {
  const view = document.getElementById("public-benchmark-view");
  const pager = document.getElementById("rankings-pager");
  if (!view) return;
  const board = state.publicBoards.find((candidate) => candidate.id === state.benchmarkSource);
  if (!board) {
    const updated = document.getElementById("rankings-updated");
    if (updated) { updated.textContent = ""; updated.classList.remove("stale-warning"); }
    view.classList.remove("hidden");
    view.innerHTML = '<p class="muted">Loading public benchmark sources…</p>';
    pager.innerHTML = "";
    return;
  }
  const columns = Array.isArray(board.columns) ? board.columns : [];
  const query = state.benchmarkQuery.trim().toLowerCase();
  const rows = (Array.isArray(board.rows) ? board.rows : []).filter((row) => !query || [row.name, row.detail, row.status, row.warning].filter(Boolean).join(" ").toLowerCase().includes(query));
  const publicPageSize = 5;
  state.pages.rankings = Math.min(state.pages.rankings, Math.max(1, Math.ceil(rows.length / publicPageSize)));
  const pageStart = (state.pages.rankings - 1) * publicPageSize;
  const visible = rows.slice(pageStart, pageStart + publicPageSize);
  const sourceCalendarDate = publicCalendarDate(board.sourceUpdatedAt);
  const sourceDate = sourceCalendarDate ? `${board.sourceUpdatedLabel || "Source updated"} · ${sourceCalendarDate}` : (board.sourceVersion ? "" : "Source update date unavailable");
  const fetchedDate = board.fetchedAt && publicDate(board.fetchedAt) ? `Fetched ${publicDate(board.fetchedAt)}` : "Fetch date unavailable";
  const sourceVersion = board.sourceVersion ? `Suite release ${board.sourceVersion}` : "";
  const links = [
    board.sourceUrl ? `<a href="${escapeHtml(safeLink(board.sourceUrl))}" target="_blank" rel="noopener">Source</a>` : "",
    board.methodologyUrl ? `<a href="${escapeHtml(safeLink(board.methodologyUrl))}" target="_blank" rel="noopener">Methodology</a>` : "",
  ].filter(Boolean).join(" · ");
  const notice = board.error || board.stale ? `<p class="benchmark-source-error" role="status">${escapeHtml(board.error || "This source may be stale.")}${rows.length ? " Showing the last cached dataset." : ""}</p>` : "";
  const updated = document.getElementById("rankings-updated");
  if (updated) { updated.textContent = board.stale ? "⚠ Cached source data" : ""; updated.classList.toggle("stale-warning", board.stale === true); }
  view.classList.remove("hidden");
  view.innerHTML = `${notice}<div class="public-benchmark-head"><div><h3>${escapeHtml(board.name || state.benchmarkSource)}</h3><p class="muted">${escapeHtml(board.description || "Public benchmark results")}</p></div><div class="public-benchmark-meta">${sourceVersion ? `<span>${escapeHtml(sourceVersion)}</span>` : ""}<span>${escapeHtml(sourceDate)}</span><span>${escapeHtml(fetchedDate)}</span></div></div><div class="table-wrap"><table><thead><tr><th>#</th><th>${escapeHtml(board.entityLabel || "Model")}</th><th>${escapeHtml(board.metricLabel || "Score")}</th></tr></thead><tbody>${visible.length ? visible.map((row, index) => { const submitted = publicCalendarDate(row.testedAt); const detail = [row.detail, row.status, submitted ? `Submitted ${submitted}` : ""].filter(Boolean).join(" · "); const warning = row.warning ? `<small class="public-row-warning">${escapeHtml(row.warning)}</small>` : ""; const categories = columns.map((column) => `<div><span>${escapeHtml(column.label || column.key)}</span><strong>${publicValue(row.values?.[column.key])}</strong></div>`).join(""); const categoryDetails = columns.length ? `<details class="public-category-details"><summary>Category scores</summary><div class="public-category-grid">${categories}</div></details>` : ""; return `<tr><td>${pageStart + index + 1}</td><td>${row.url && safeLink(row.url) ? `<a href="${escapeHtml(safeLink(row.url))}" target="_blank" rel="noopener">${escapeHtml(row.name || row.id)}</a>` : escapeHtml(row.name || row.id)}${detail ? `<small class="public-row-detail">${escapeHtml(detail)}</small>` : ""}${warning}</td><td><strong>${publicValue(row.score)}</strong>${categoryDetails}</td></tr>`; }).join("") : `<tr><td colspan="3" class="muted">No rows match this filter.</td></tr>`}</tbody></table></div><p class="attribution">${links}${links ? " · " : ""}${escapeHtml(board.metricLabel || "Metric")} values are reported by this source and are not combined with other boards.</p>`;
  renderPager("rankings-pager", "rankings", rows.length, publicPageSize);
}

async function loadPublicBenchmarks() {
  try {
    const payload = await fetchJson("/api/benchmarks");
    setPublicBoards(payload?.boards);
  } catch (error) {
    state.publicBoards = [];
    console.warn("Public benchmark sources unavailable", error);
  }
  renderRankings();
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
      ? state.rankings?.models?.find((m) => m.slug === resolveSlug(e.suggestedUpgradeSlug))
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
    const model = state.rankings?.models?.find((m) => m.slug === resolveSlug(e.suggestedUpgradeSlug));
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

// Settings & preferences now live in the AI Pulse desktop app. The gear tries to
// open the app via its custom protocol, with an in-browser fallback if it isn't
// installed / registered yet.
function promptOpenApp() {
  try {
    window.location.href = "aipulse://settings";
  } catch {
    /* protocol not registered */
  }
  showAppRedirectToast();
}

function showAppRedirectToast() {
  const existing = document.getElementById("app-redirect-toast");
  if (existing) {
    existing.classList.remove("hidden");
    return;
  }
  const toast = document.createElement("div");
  toast.id = "app-redirect-toast";
  toast.className = "app-toast";
  toast.innerHTML =
    '<div class="app-toast-body"><strong>Opening the AI Pulse app…</strong>' +
    "<span>Settings &amp; preferences live in the app now. If nothing opens, launch " +
    "<b>AI Pulse</b> from your system tray or app launcher.</span></div>" +
    '<div class="app-toast-actions">' +
    '<button type="button" id="app-toast-fallback" class="btn btn-ghost btn-sm">Edit here instead</button>' +
    '<button type="button" id="app-toast-close" class="btn btn-ghost btn-sm">Dismiss</button></div>';
  document.body.appendChild(toast);
  document.getElementById("app-toast-close").addEventListener("click", () => toast.remove());
  document.getElementById("app-toast-fallback").addEventListener("click", () => {
    toast.remove();
    openDrawer();
  });
}

document.getElementById("open-stack").addEventListener("click", promptOpenApp);
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

async function refreshResource(buttonId, endpoint, loaders) {
  const btn = document.getElementById(buttonId);
  if (!btn) return;
  const previous = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Refreshing…";
  try { await fetchJson(endpoint, { method: "POST", timeoutMs: 90_000 }); }
  catch (err) { console.warn(`Refresh failed: ${endpoint}`, err); }
  await Promise.allSettled(loaders.map((loader) => loader()));
  btn.disabled = false;
  btn.textContent = previous;
}

document.getElementById("refresh-rankings")?.addEventListener("click", async () => {
  const button = document.getElementById("refresh-rankings");
  const previous = button.textContent;
  button.disabled = true;
  button.textContent = "Refreshing…";
  try {
    if (state.benchmarkSource === "aa") {
      await fetchJson("/api/rankings/refresh", { method: "POST", timeoutMs: 90_000 });
      state.rankings = await fetchJson("/api/rankings");
    } else {
      const result = await fetchJson("/api/benchmarks/refresh", { method: "POST", timeoutMs: 90_000 });
      if (Array.isArray(result?.boards)) setPublicBoards(result.boards);
    }
    renderRankings();
  } catch (error) {
    const updated = document.getElementById("rankings-updated");
    if (updated) { updated.textContent = "⚠ Refresh failed — showing cached data"; updated.classList.add("stale-warning"); }
  } finally {
    button.disabled = false;
    button.textContent = previous;
  }
});
document.getElementById("benchmark-source")?.addEventListener("change", (event) => { state.benchmarkSource = event.target.value; state.pages.rankings = 1; renderRankings(); });
document.getElementById("refresh-videos")?.addEventListener("click", () => refreshResource("refresh-videos", "/api/videos/refresh", [loadVideos, loadCompanyVideos]));
document.getElementById("benchmark-search")?.addEventListener("input", (event) => { state.benchmarkQuery = event.target.value; state.pages.rankings = 1; renderRankings(); });
document.querySelectorAll("[data-benchmark-view]").forEach((button) => button.addEventListener("click", () => { document.querySelectorAll("[data-benchmark-view]").forEach((b) => b.classList.remove("active")); button.classList.add("active"); state.benchmarkView = button.dataset.benchmarkView; state.pages.rankings = 1; renderRankings(); }));
document.querySelectorAll("[data-access-filter]").forEach((button) => button.addEventListener("click", () => { document.querySelectorAll("[data-access-filter]").forEach((b) => b.classList.remove("active")); button.classList.add("active"); state.benchmarkAccess = button.dataset.accessFilter; state.pages.rankings = 1; renderRankings(); }));
document.querySelectorAll("[data-video-kind]").forEach((button) => button.addEventListener("click", () => setVideoKind(button.dataset.videoKind)));
document.getElementById("add-video-channel")?.addEventListener("click", () => {
  document.getElementById("video-channel-form").classList.remove("hidden");
  document.getElementById("video-channel-kind").value = state.videoKind;
  document.getElementById("video-channel-error").textContent = "";
  document.getElementById("video-channel-input").focus();
});
document.getElementById("cancel-video-channel")?.addEventListener("click", () => document.getElementById("video-channel-form").classList.add("hidden"));
document.getElementById("manage-video-channels")?.addEventListener("click", (event) => {
  const manager = document.getElementById("video-channel-manager");
  const hidden = manager.classList.toggle("hidden");
  event.currentTarget.setAttribute("aria-expanded", String(!hidden));
  if (!hidden) loadVideoChannels().catch(showVideoChannelError);
});
document.getElementById("video-channel-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = document.getElementById("video-channel-input");
  const kind = document.getElementById("video-channel-kind").value;
  const error = document.getElementById("video-channel-error");
  const submit = event.submitter;
  error.textContent = "";
  if (!input.value.trim()) { error.textContent = "Enter a YouTube channel link or handle."; return; }
  if (submit) { submit.disabled = true; submit.textContent = "Checking channel…"; }
  document.getElementById("video-channel-status").textContent = "Checking the channel and its public YouTube feed…";
  try {
    const result = await fetchJson("/api/videos/channels", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ input: input.value.trim(), kind }), timeoutMs: 90_000 });
    state.videoChannels = result.channels || [];
    setVideoKind(kind);
    input.value = "";
    document.getElementById("video-channel-form").classList.add("hidden");
    document.getElementById("video-channel-status").textContent = `${result.addedChannel?.name || "Channel"} added to ${kind === "company" ? "Companies" : "Creators"}.`;
    await Promise.allSettled([loadVideos(), loadCompanyVideos()]);
  } catch (failure) {
    error.textContent = friendlyRequestError(failure);
    document.getElementById("video-channel-status").textContent = "Channel was not added. Check the address and try again.";
  } finally { if (submit) { submit.disabled = false; submit.textContent = "Add channel"; } }
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
  if (chatState.searchBackend && chatState.searchBackend !== "none") return `Search: on (${chatState.searchBackend})`;
  return "Local model · search unavailable";
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
    opt.textContent = "No local model configured — open Settings";
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
      content: "Configure a local model in AI Pulse Settings, then try again.",
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

document.querySelectorAll(".nav-item").forEach((item) => item.addEventListener("click", () => setView(item.dataset.view)));
document.getElementById("sidebar-stack")?.addEventListener("click", promptOpenApp);
document.getElementById("sidebar-chat")?.addEventListener("click", () => setChatOpen(true));
setView("overview");

async function init() {
  connectWs();

  const [rankingsR, newsR, briefingR] = await Promise.allSettled([
    fetchJson("/api/rankings"),
    fetchJson(`/api/news?limit=50&period=${state.newsPeriod}&category=${state.newsCategory}`),
    fetchJson("/api/briefing"),
    loadPublicBenchmarks(),
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
    loadCompanyVideos().catch((err) => console.error(err)),
    loadChatModels().catch((err) => console.error(err)),
  ]);

  renderBriefing();
  renderNews();
  renderAiPicks();
  renderCreators();
  renderCompanyVideos();
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
