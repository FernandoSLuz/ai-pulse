import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import http from "node:http";

import {
  getDb,
  getAllModels,
  getNews,
  saveMyStack,
  getLatestBriefing,
  getNotificationPrefs,
  saveNotificationPrefs,
  upsertModels,
  upsertNews,
  clearNewsWithHtml,
  clearLatestBriefingUpgrade,
  upsertVideos,
  getVideos,
  setMeta,
  getMeta,
} from "./db.js";
import { fetchArtificialAnalysisModels } from "./fetchers/artificial-analysis.js";
import { fetchAaPublicSiteModels } from "./fetchers/aa-public-site.js";
import { mergeBenchmarkModels } from "./fetchers/merge-models.js";
import { enrichAccessibility } from "./fetchers/huggingface-access.js";
import { fetchAllNews } from "./fetchers/rss-aggregator.js";
import { fetchCreatorVideos } from "./fetchers/youtube-channels.js";
import { buildRankingsSnapshot, detectLeaderChanges } from "./rankings.js";
import { evaluatePollHealth, recordSuccessfulPoll } from "./poll-health.js";
import {
  updateStackSuggestion,
  applyUpgradeSuggestion,
  dismissUpgradeSuggestion,
  applyEntrySuggestion,
  dismissEntrySuggestion,
  addRoleGapToStack,
  dismissRoleGap,
} from "./my-stack.js";
import { generateBriefing, getCachedBriefing, curateAiPicksAllPeriods } from "./analyst/engine.js";
import { notifyFromEvent } from "./notifications.js";
import { runChat } from "./chat/engine.js";
import { listAvailableModels } from "./chat/models.js";
import { resolveSearchBackend } from "./chat/search-agent.js";
import type { ChatMessage } from "./chat/types.js";
import type { ChangeEvent, NewsItem, NewsPeriod, StackRole, WsMessage } from "./types.js";
import { isNewsPeriod } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", "..", "..", ".env") });
const PORT = Number(process.env.PORT) || 3847;
const AA_KEY = process.env.AA_API_KEY;
const GROQ_KEY = process.env.GROQ_API_KEY;
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const TAVILY_KEY = process.env.TAVILY_API_KEY;
const OLLAMA_ENABLED = process.env.OLLAMA_ENABLED === "true";
const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "qwen2.5:7b";
const AA_POLL = Number(process.env.AA_POLL_INTERVAL_MS) || 7_200_000;
const RSS_POLL = Number(process.env.RSS_POLL_INTERVAL_MS) || 1_200_000;
const YT_POLL = Number(process.env.YT_POLL_INTERVAL_MS) || 1_800_000;

const webRoot = path.join(__dirname, "..", "..", "web");
const analystEnv = {
  geminiKey: GEMINI_KEY,
  groqKey: GROQ_KEY,
  ollamaEnabled: OLLAMA_ENABLED,
  ollamaUrl: OLLAMA_URL,
  ollamaModel: OLLAMA_MODEL,
};
const chatEnv = {
  geminiKey: GEMINI_KEY,
  groqKey: GROQ_KEY,
  tavilyKey: TAVILY_KEY,
};

getDb();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(webRoot));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

const clients = new Set<WebSocket>();

function broadcast(msg: WsMessage): void {
  const data = JSON.stringify(msg);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) client.send(data);
  }
}

wss.on("connection", (ws) => {
  clients.add(ws);
  ws.on("close", () => clients.delete(ws));
  ws.send(
    JSON.stringify({
      type: "status",
      payload: { connected: true, models: getAllModels().length },
    } satisfies WsMessage),
  );
});

app.get("/api/health", (_req, res) => {
  const health = evaluatePollHealth(AA_POLL);
  res.json({
    ok: true,
    port: PORT,
    models: getAllModels().length,
    poll: health,
    newsUpdatedAt: getMeta("news_last_poll"),
    videosUpdatedAt: getMeta("videos_last_poll"),
  });
});

app.get("/api/rankings", (_req, res) => {
  try {
    const models = getAllModels();
    res.json(buildRankingsSnapshot(models));
  } catch (err) {
    console.error("[API] /api/rankings failed:", err);
    res.status(503).json({ error: "temporarily unavailable" });
  }
});

app.get("/api/news", (req, res) => {
  try {
    const category = (req.query.category as string) ?? "all";
    const rawPeriod = (req.query.period as string) ?? "all";
    const period: NewsPeriod = isNewsPeriod(rawPeriod) ? rawPeriod : "all";
    const view = ((req.query.view as string) ?? "all") as "all" | "ai_pick";
    const limit = Number(req.query.limit) || 50;
    res.json({
      items: getNews(limit, category, period, view),
      updatedAt: getMeta("news_last_poll"),
      period,
      view,
    });
  } catch (err) {
    console.error("[API] /api/news failed:", err);
    res.status(503).json({ error: "temporarily unavailable", items: [], updatedAt: null });
  }
});

let newsCoreInFlight: Promise<NewsItem[]> | null = null;
let newsEnrichRunning = false;

app.post("/api/news/refresh", async (_req, res) => {
  try {
    // Refresh only waits for RSS ingest; AI pick enrichment continues in the background.
    const newItems = await pollNewsCore();
    scheduleNewsEnrichment(newItems);
    res.json({
      ok: true,
      updatedAt: getMeta("news_last_poll"),
      items: getNews(50),
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get("/api/videos", (req, res) => {
  try {
    const limit = Number(req.query.limit) || 40;
    res.json({
      items: getVideos(limit),
      updatedAt: getMeta("videos_last_poll"),
    });
  } catch (err) {
    console.error("[API] /api/videos failed:", err);
    res.status(503).json({ error: "temporarily unavailable", items: [], updatedAt: null });
  }
});

app.get("/api/briefing", (_req, res) => {
  try {
    res.json(getCachedBriefing());
  } catch (err) {
    console.error("[API] /api/briefing failed:", err);
    res.status(503).json({ error: "temporarily unavailable" });
  }
});

app.post("/api/briefing/refresh", async (_req, res) => {
  try {
    const briefing = await runAnalyst({ type: "manual", details: {} });
    res.json(briefing);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get("/api/stack", (_req, res) => {
  const { profile } = updateStackSuggestion(getAllModels());
  res.json(profile);
});

app.put("/api/stack", (req, res) => {
  const body = req.body ?? {};
  const entries = Array.isArray(body.entries)
    ? body.entries.map((e: Record<string, unknown>) => ({
        ...e,
        suggestedUpgradeDismissed: false,
      }))
    : undefined;
  saveMyStack({ ...body, entries });
  const { profile } = updateStackSuggestion(getAllModels());
  broadcast({ type: "stack", payload: profile });
  res.json(profile);
});

app.post("/api/stack/apply-suggestion", (_req, res) => {
  const updated = applyUpgradeSuggestion();
  const briefing = clearLatestBriefingUpgrade();
  broadcast({ type: "stack", payload: updated });
  if (briefing) broadcast({ type: "briefing", payload: briefing });
  res.json(updated);
});

app.post("/api/stack/dismiss-suggestion", (_req, res) => {
  const updated = dismissUpgradeSuggestion();
  const briefing = clearLatestBriefingUpgrade();
  broadcast({ type: "stack", payload: updated });
  if (briefing) broadcast({ type: "briefing", payload: briefing });
  res.json(updated);
});

app.post("/api/stack/entries/:id/apply-suggestion", (req, res) => {
  const updated = applyEntrySuggestion(req.params.id);
  const briefing = clearLatestBriefingUpgrade();
  broadcast({ type: "stack", payload: updated });
  if (briefing) broadcast({ type: "briefing", payload: briefing });
  res.json(updated);
});

app.post("/api/stack/entries/:id/dismiss-suggestion", (req, res) => {
  const updated = dismissEntrySuggestion(req.params.id);
  const briefing = clearLatestBriefingUpgrade();
  broadcast({ type: "stack", payload: updated });
  if (briefing) broadcast({ type: "briefing", payload: briefing });
  res.json(updated);
});

app.post("/api/briefing/dismiss-upgrade", (_req, res) => {
  const briefing = clearLatestBriefingUpgrade();
  dismissUpgradeSuggestion();
  if (briefing) broadcast({ type: "briefing", payload: briefing });
  res.json(briefing ?? { upgradeSuggestion: null, upgradeSlug: null });
});

app.post("/api/stack/role-gaps/:role/add", (req, res) => {
  const role = req.params.role as StackRole;
  if (!["primary", "secondary", "free"].includes(role)) {
    res.status(400).json({ error: "Invalid role" });
    return;
  }
  const updated = addRoleGapToStack(role, getAllModels());
  broadcast({ type: "stack", payload: updated });
  res.json(updated);
});

app.post("/api/stack/role-gaps/:role/dismiss", (req, res) => {
  const role = req.params.role as StackRole;
  if (!["primary", "secondary", "free"].includes(role)) {
    res.status(400).json({ error: "Invalid role" });
    return;
  }
  const updated = dismissRoleGap(role, getAllModels());
  broadcast({ type: "stack", payload: updated });
  res.json(updated);
});

app.get("/api/notifications/prefs", (_req, res) => {
  res.json(getNotificationPrefs());
});

app.put("/api/notifications/prefs", (req, res) => {
  res.json(saveNotificationPrefs(req.body));
});

app.get("/api/models", (_req, res) => {
  res.json(getAllModels().map((m) => ({ slug: m.slug, name: m.name, creator: m.creator })));
});

app.get("/api/chat/models", (_req, res) => {
  const models = listAvailableModels(chatEnv);
  const searchBackend = resolveSearchBackend(chatEnv);
  res.json({
    models: models.map((m) => ({
      id: m.id,
      label: m.label,
      provider: m.provider,
      description: m.description,
    })),
    searchBackend,
    searchEnabled: searchBackend !== "none",
  });
});

app.post("/api/chat", async (req, res) => {
  try {
    const modelId = typeof req.body?.modelId === "string" ? req.body.modelId : "";
    const rawMessages = Array.isArray(req.body?.messages) ? req.body.messages : [];
    if (!modelId) {
      res.status(400).json({ error: "modelId is required" });
      return;
    }
    const messages: ChatMessage[] = rawMessages
      .filter(
        (m: unknown): m is { role: string; content: string } =>
          Boolean(m) &&
          typeof m === "object" &&
          typeof (m as { role?: unknown }).role === "string" &&
          typeof (m as { content?: unknown }).content === "string",
      )
      .map((m: { role: string; content: string }) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content.slice(0, 8000),
      }))
      .slice(-20);

    if (messages.length === 0 || messages[messages.length - 1]?.role !== "user") {
      res.status(400).json({ error: "messages must end with a user message" });
      return;
    }

    const available = listAvailableModels(chatEnv);
    if (!available.some((m) => m.id === modelId)) {
      res.status(400).json({
        error: "Model not available. Configure GEMINI_API_KEY and/or GROQ_API_KEY in .env.",
      });
      return;
    }

    const result = await runChat({ modelId, messages, env: chatEnv });
    res.json(result);
  } catch (err) {
    console.warn("[Chat]", (err as Error).message);
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get("/widget", (_req, res) => {
  res.sendFile(path.join(webRoot, "widget.html"));
});

let lastNewSlugs: string[] = [];
let lastLeaderChanges: string[] = [];

async function pollBenchmarks(): Promise<void> {
  console.log("[Poll] Fetching benchmarks...");
  try {
    const fromApi = await fetchArtificialAnalysisModels(AA_KEY);
    const fromSite = await fetchAaPublicSiteModels();
    const raw = mergeBenchmarkModels(fromApi, fromSite);
    if (raw.length === 0) {
      console.warn("[Poll] No models returned — keeping previous data; freshness warning may apply");
      const health = evaluatePollHealth(AA_POLL);
      if (health.warning) console.warn(`[Poll Health] ${health.warning}`);
      broadcast({ type: "rankings", payload: buildRankingsSnapshot(getAllModels(), AA_POLL) });
      return;
    }

    raw.sort((a, b) => b.intelligence - a.intelligence);
    // Persist + broadcast first; HF accessibility lookups are slow and must not block readiness.
    const newSlugs = upsertModels(raw);
    recordSuccessfulPoll();
    const snapshot = buildRankingsSnapshot(getAllModels(), AA_POLL);
    const leaderChanges = detectLeaderChanges(snapshot.winners);

    lastNewSlugs = newSlugs;
    lastLeaderChanges = leaderChanges;

    const { profile: stack, newlySuggested, newRoleGaps } = updateStackSuggestion(snapshot.models);
    broadcast({ type: "rankings", payload: snapshot });
    broadcast({ type: "stack", payload: stack });

    void enrichAccessibility(raw, 40)
      .then(() => {
        upsertModels(raw);
        broadcast({ type: "rankings", payload: buildRankingsSnapshot(getAllModels(), AA_POLL) });
      })
      .catch((err) => console.warn("[Poll] Accessibility enrichment failed:", (err as Error).message));

    for (const { candidate, entry } of newlySuggested) {
      notifyFromEvent({
        type: "upgrade_suggestion",
        details: {
          message: candidate.reason,
          fingerprint: `upgrade:${entry.id}:${candidate.slug}`,
        },
      });
    }
    for (const gap of newRoleGaps) {
      notifyFromEvent({
        type: "upgrade_suggestion",
        details: {
          message: gap.reason,
          fingerprint: `role_gap:${gap.role}:${gap.modelSlug}`,
        },
      });
    }

    const events: ChangeEvent[] = [];
    if (newSlugs.length > 0) {
      events.push({ type: "new_model", details: { slugs: newSlugs } });
      notifyFromEvent({ type: "new_model", details: { slugs: newSlugs } }, snapshot.models);
    }
    if (leaderChanges.length > 0) {
      events.push({ type: "leader_change", details: { changes: leaderChanges } });
      notifyFromEvent({ type: "leader_change", details: { changes: leaderChanges } }, snapshot.models);
    }

    if (events.length > 0 || !getLatestBriefing()) {
      try {
        await runAnalyst(events[0] ?? { type: "manual", details: {} });
      } catch (err) {
        console.warn("[Poll] Analyst after benchmarks failed:", (err as Error).message);
      }
    }
  } catch (err) {
    console.error("[Poll] Benchmark fetch failed:", err);
    const health = evaluatePollHealth(AA_POLL);
    if (health.warning) console.warn(`[Poll Health] ${health.warning}`);
    broadcast({ type: "rankings", payload: buildRankingsSnapshot(getAllModels(), AA_POLL) });
  }
}

async function pollNewsCore(): Promise<NewsItem[]> {
  if (newsCoreInFlight) return newsCoreInFlight;

  newsCoreInFlight = (async () => {
    console.log("[Poll] Fetching RSS...");
    const { items, feedsOk, feedsFailed } = await fetchAllNews();
    const newItems = upsertNews(items);

    // Only bump freshness when at least one feed succeeded; keep prior stamp on total failure.
    if (feedsOk > 0) {
      setMeta("news_last_poll", new Date().toISOString());
    } else if (feedsFailed > 0) {
      console.warn("[Poll] All RSS feeds failed — keeping previous news freshness stamp");
    }

    const feed = getNews(50);
    broadcast({ type: "news", payload: { items: feed, updatedAt: getMeta("news_last_poll") } });
    return newItems;
  })().finally(() => {
    newsCoreInFlight = null;
  });

  return newsCoreInFlight;
}

async function pollNewsEnrichment(newItems: NewsItem[]): Promise<void> {
  console.log("[Poll] News enrichment starting…");
  const high = newItems.filter((n) => n.relevanceScore >= 80);
  if (high.length > 0) {
    const top = high[0];
    try {
      notifyFromEvent({
        type: "high_news",
        details: { title: top.title, source: top.source, id: top.id },
      });
    } catch (err) {
      console.warn("[Poll] High-news notify failed:", (err as Error).message);
    }
    try {
      await runAnalyst({ type: "high_news", details: { title: top.title } });
    } catch (err) {
      console.warn("[Poll] Analyst after high news failed:", (err as Error).message);
    }
  }

  try {
    const periods: NewsPeriod[] = ["hour", "12h", "today", "week", "month"];
    const picksByPeriod = await curateAiPicksAllPeriods(periods, analystEnv);
    broadcast({ type: "ai_picks", payload: picksByPeriod });
    console.log("[Poll] News enrichment done");
  } catch (err) {
    console.warn("[AI Pick] Curation failed:", (err as Error).message);
  }
}

function scheduleNewsEnrichment(newItems: NewsItem[]): void {
  if (newsEnrichRunning) {
    console.log("[Poll] Skipping news enrichment — already in progress");
    return;
  }
  newsEnrichRunning = true;
  void pollNewsEnrichment(newItems)
    .catch((err) => console.warn("[Poll] News enrichment failed:", (err as Error).message))
    .finally(() => {
      newsEnrichRunning = false;
    });
}

async function pollNews(): Promise<void> {
  const newItems = await pollNewsCore();
  scheduleNewsEnrichment(newItems);
}

async function pollVideos(): Promise<void> {
  console.log("[Poll] Fetching YouTube creators...");
  try {
    const videos = await fetchCreatorVideos();
    const newVideos = upsertVideos(videos);
    setMeta("videos_last_poll", new Date().toISOString());
    broadcast({
      type: "videos",
      payload: { items: getVideos(40), updatedAt: getMeta("videos_last_poll") },
    });

    for (const v of newVideos.slice(0, 5)) {
      notifyFromEvent({
        type: "new_video",
        details: { id: v.id, title: v.title, channel: v.channel },
      });
    }
  } catch (err) {
    console.error("[Poll] YouTube fetch failed:", err);
  }
}

async function runAnalyst(trigger: ChangeEvent) {
  const models = getAllModels();
  const briefing = await generateBriefing(
    {
      newModelSlugs: lastNewSlugs,
      leaderChanges: lastLeaderChanges,
      topNews: getNews(10),
      models,
    },
    analystEnv,
  );

  broadcast({ type: "briefing", payload: briefing });
  return briefing;
}

async function bootstrap(): Promise<void> {
  const removed = clearNewsWithHtml();
  if (removed > 0) console.log(`[News] Cleared ${removed} items with raw HTML`);
  await pollBenchmarks();
  await pollNews();
  await pollVideos();
  if (!getLatestBriefing()) {
    try {
      await runAnalyst({ type: "manual", details: {} });
    } catch (err) {
      console.warn("[Bootstrap] Initial briefing failed:", (err as Error).message);
    }
  }
  console.log(`[Bootstrap] Ready at http://localhost:${PORT} (background enrichment may still finish)`);
}

function withPollGuard(name: string, lock: { running: boolean }, fn: () => Promise<void>): () => Promise<void> {
  return async () => {
    if (lock.running) {
      console.log(`[Poll] Skipping ${name} — already in progress`);
      return;
    }
    lock.running = true;
    try {
      await fn();
    } catch (err) {
      console.error(`[Poll] ${name} failed:`, err);
    } finally {
      lock.running = false;
    }
  };
}

const benchmarkLock = { running: false };
const newsLock = { running: false };
const videosLock = { running: false };

setInterval(withPollGuard("benchmarks", benchmarkLock, pollBenchmarks), AA_POLL);
setInterval(withPollGuard("news", newsLock, pollNews), RSS_POLL);
setInterval(withPollGuard("videos", videosLock, pollVideos), YT_POLL);
setInterval(() => {
  const health = evaluatePollHealth(AA_POLL);
  if (health.stale) {
    console.warn(`[Poll Health] ${health.warning}`);
    try {
      broadcast({ type: "rankings", payload: buildRankingsSnapshot(getAllModels(), AA_POLL) });
    } catch (err) {
      console.error("[Poll Health] Broadcast failed:", err);
    }
  }
}, Math.min(AA_POLL / 4, 30 * 60_000));

server.listen(PORT, () => {
  console.log(`AI Pulse server running at http://localhost:${PORT}`);
  bootstrap().catch((err) => console.error("Bootstrap failed:", err));
});
