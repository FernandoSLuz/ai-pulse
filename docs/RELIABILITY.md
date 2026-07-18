# Reliability & self-healing

AI Pulse is built to keep running and keep curating even when individual cloud APIs get flaky. This page explains the two mechanisms that make that true: **AI curation resilience** (how the analyst survives provider outages) and **service self-healing** (how the desktop app keeps the background server alive).

---

## AI curation resilience

Curation is **cloud-only** — there are no local models. Instead, an LLM router rotates across free cloud providers and uses the **first one that answers with valid JSON**. If your top choice is rate-limited or down, the next one picks up the run.

### Provider rotation order

The router always tries candidates in this fixed order:

| # | Provider | Model |
|---|----------|-------|
| 1 | Gemini | 3.5 Flash |
| 2 | Cerebras | Llama 3.3 70B |
| 3 | Groq | Llama 3.1 8B |
| 4 | OpenRouter | Llama 3.3 70B (`:free`) |
| 5 | Gemini | 2.5 Flash |
| 6 | OpenRouter | DeepSeek V3 (`:free`) |

### Per-candidate backoff

Each candidate carries its **own** backoff state, so one provider misbehaving never poisons the others. When a candidate fails, it's classified and parked accordingly:

| Classification | Trigger | Backoff |
|----------------|---------|---------|
| `rate_limit` | 429 / quota exceeded | Honors the provider's own retry hint |
| `unavailable` | Bad model id / 400 / 401 / 403 / 404 | Parks the candidate for **~12h** |
| `error` | Transient failures | Cools down for **~2m** |

The router simply skips any candidate that's currently in backoff and moves to the next one in the list.

### No silent degradation

Curation **never** quietly falls back without telling you. Every run records — in the database — which provider actually served it, or that it fell back to the deterministic **rules** engine.

That status is exposed through the health endpoint:

```http
GET /api/health
```

The response includes full **analyst provider status** plus the **last outcome** (`lastOutcome`), which is what the app surfaces in the UI:

- `AI: Gemini ✓` — a cloud provider served the last run
- `AI: degraded (rules)` — every provider was unavailable and deterministic rules were used

Because the outcome is persisted and reported, a degraded state is always visible rather than hidden.

### You need at least one key — more is better

You need **at least ONE** provider key for curation to work. Adding more keys makes the system **more resilient**: with several providers configured, a single outage or quota wall just shifts the run to the next candidate instead of degrading to rules.

Where to get keys:

| Provider | Get a key |
|----------|-----------|
| Gemini | https://aistudio.google.com/apikey |
| Cerebras | https://cloud.cerebras.ai |
| Groq | https://console.groq.com/keys |
| OpenRouter | https://openrouter.ai/keys |

All keys are edited in the desktop app under **Settings → Connections**.

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

- **Tray menu** — the app lives in the system tray, where you can **Start / Stop / Restart Background Service** or **Quit AI Pulse** (which stops both the server and the app). If the service is running from here, the supervisor is active.
- **Settings → AI curation health** — shows which provider is serving curation and whether it's currently degraded, mirroring the `AI: <provider>` / `AI: degraded` indicator.
- **`GET /api/health`** — the source of truth. Returns full provider status and the last curation outcome, plus the server health the supervisor uses for its 20s pings:

```bash
curl http://localhost:3847/api/health
```

> The default port is **3847**; change it under **Settings → Startup & service → Server port**.

If the tray shows the service running, Settings shows a named AI provider (not `degraded`), and `/api/health` returns cleanly, everything is healthy.
