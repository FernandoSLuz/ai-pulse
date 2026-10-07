# Reliability & self-healing

AI Pulse is built to keep running and keep curating on ordinary desktop hardware. This page explains the local runtime setup, deterministic fallback, and service self-healing.

---

## AI curation resilience

Curation and chat run locally through llama-server and a downloaded GGUF selected from the model catalogue. First setup detects RAM and recommends a light or balanced profile, downloads it with progress, verifies its hash, and permits cancellation. No cloud model fallback exists.

### Local profiles

The app offers two general profiles:

| # | Profile | Purpose |
|---|----------|-------|
| 1 | Light | Qwen3.5 0.8B Q4 GGUF (about 537 MiB; 4 GiB recommended RAM) |
| 2 | Balanced | Qwen3 1.7B Q8_0 GGUF (about 1.7 GiB; 8 GiB recommended RAM) |

The runtime records download, hash verification, startup, and cancellation states. A
missing or failed model never triggers a cloud fallback.

### No silent degradation

Curation **never** quietly falls back without telling you. Every run records — in the database — which provider actually served it, or that it fell back to the deterministic **rules** engine.

That status is exposed through the health endpoint:

```http
GET /api/health
```

The response includes full **analyst provider status** plus the **last outcome** (`lastOutcome`), which is what the app surfaces in the UI:

- `AI: local <profile> ✓` — the selected local model served the last run
- `AI: degraded (rules)` — deterministic rules were used because the local model was unavailable

Because the outcome is persisted and reported, a degraded state is always visible rather than hidden.

No AI provider key is required. Optional `AA_API_KEY` enriches benchmark records,
`TAVILY_API_KEY` enables web search, and `X_API_BEARER_TOKEN` fetches official X
posts. None of these integrations supplies a model or is used as a fallback:
inference is local-only, and a missing model uses deterministic rules rather than
an online model.

### Benchmark data

Rankings do **not** depend on any key: the server reads the public Artificial Analysis
leaderboard and mirrors the models it reports (metadata + metrics joined by slug). An
`AA_API_KEY` is optional enrichment, and a rejected key is simply skipped — it never causes
fabricated rows. When a full feed is fetched, models missing from it are pruned, so retired
entries stop ranking against current ones.

---

## Service self-healing

The Electron desktop app is the supervisor. Its main process spawns the server as a child process (using Electron's bundled Node) and a **ServerSupervisor** watches it continuously.

### Health pinging

The supervisor pings the server every **20 seconds**:

```http
GET /api/health
```

### Restart policy

| Condition | Detection | Response |
|-----------|-----------|----------|
| **Crash** | Child process exits | Restart with **exponential backoff**, capped at **30s** |
| **Hang** | **3** consecutive failed health checks | Restart the server |

This means a hard crash and a wedged-but-alive process are both handled — the first by watching the process, the second by watching its health responses.

### Log rotation

Server `stdout`/`stderr` are written to:

```
userData/logs/server.log
```

The log is **rotated at 5 MB**, so it can't grow without bound.

### Poll freshness

The server polls Artificial Analysis (benchmarks), RSS feeds (news), and YouTube (creator videos). When a source stops updating, the app raises **staleness warnings** so you know the data on screen is aging rather than assuming it's current.

---

## How to tell if it's healthy

You have three complementary ways to check status:

- **Tray menu** — the app lives in the system tray (on Linux, a StatusNotifierItem in your bar's tray — on Omarchy, the omarchy-shell bar; use its right-click menu, since clicks do nothing there), where you can **Start / Stop / Restart Background Service** or **Quit AI Pulse** (which stops both the server and the app). If the service is running from here, the supervisor is active.
- **Settings → AI curation health** — shows which provider is serving curation and whether it's currently degraded, mirroring the `AI: <provider>` / `AI: degraded` indicator.
- **`GET /api/health`** — the source of truth. Returns full provider status and the last curation outcome, plus the server health the supervisor uses for its 20s pings:

```bash
curl http://localhost:3847/api/health
```

> The default port is **3847**; change it under **Settings → Startup & service → Server port**.

If the tray shows the service running, Settings shows a ready local profile (not `degraded`), and `/api/health` returns cleanly, everything is healthy.
