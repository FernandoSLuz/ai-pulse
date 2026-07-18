# Configuration

In the packaged app, **all settings and API keys live in the app's Settings window** — there is no `.env` file to edit. The desktop app is the single control surface: it stores your preferences and keys, then injects the keys into the background server process for you.

> The dev-only `.env` workflow is described at the end, under [Developer environment variables](#developer-environment-variables).

## Where your configuration lives

The packaged app keeps everything under Electron's `userData` directory. On Windows that resolves to `%APPDATA%\AI Pulse`.

| What | Location | Notes |
| --- | --- | --- |
| API keys + preferences | `userData/config.json` → `%APPDATA%\AI Pulse\config.json` | The app is the only place you edit this. Keys are injected into the server child's environment at launch. |
| SQLite database | `userData\data\ai-pulse.db` | Directory overridable via `AI_PULSE_DATA_DIR`. |
| Server logs | `userData\logs\server.log` | Rotated at 5 MB. |

## API keys

Add these in **Settings → Connections**. You need at least **one** AI provider key; the rest are optional and unlock or harden specific features.

| Provider | Powers | Get a key | Required? |
| --- | --- | --- | --- |
| Gemini | AI curation (router) + chat web-search grounding fallback | https://aistudio.google.com/apikey | At least one AI key required* |
| Cerebras | AI curation (router) | https://cloud.cerebras.ai | Optional* |
| Groq | AI curation (router) | https://console.groq.com/keys | Optional* |
| OpenRouter | AI curation (router) | https://openrouter.ai/keys | Optional* |
| Artificial Analysis (`AA_API_KEY`) | Benchmark rankings | https://artificialanalysis.ai/insights | Optional |
| Tavily | Chat web-search agent (preferred) | https://app.tavily.com | Optional |

\* Gemini, Cerebras, Groq, and OpenRouter are the AI curation providers. **You must supply at least one of them.** Each is individually optional, but adding more makes curation more resilient.

Notes on the optional keys:

- **Artificial Analysis** uses the free-tier `/free` endpoint. Other endpoints are plan-gated and skipped quietly.
- **Chat web search** prefers **Tavily**. Without it, the agent falls back to **Gemini grounding**.

## AI provider rotation

AI curation is **cloud-only** (no local models). An LLM router rotates across free cloud providers in a fixed order and uses the **first one that answers with valid JSON**:

1. Gemini 3.5 Flash
2. Cerebras Llama 3.3 70B
3. Groq Llama 3.1 8B
4. OpenRouter Llama 3.3 70B (`:free`)
5. Gemini 2.5 Flash
6. OpenRouter DeepSeek V3 (`:free`)

Each candidate has independent backoff:

- **Rate-limited** (429 / quota) → honors the provider's retry hint.
- **Unavailable** (bad model id, 400/401/403/404) → parked for ~12h.
- **Transient errors** → cool down for ~2m.

Curation **never silently degrades**. Every run records which provider served it — or that it fell back to deterministic **"rules"** — in the database. `GET /api/health` returns full provider status plus the last outcome, so the app can show `AI: Gemini ✓` or `AI: degraded (rules)`.

## Settings window sections

The Settings window is organized into these sections:

- **Connections** — all API keys.
- **Desktop leaderboard** — show/hide, dock left or right, always-on-top, number of rows.
- **Startup & service** — Start on login, Start hidden in tray, Server port, and Restart / Stop / Start.
- **Preferences** — primary model, provider, priority weights (coding / reasoning / speed / cost), budget tier, and notes (the upgrade advisor formerly known as the web "My Stack").
- **Notifications** — breaking news, new models & leader changes, upgrade suggestions.
- **AI curation health** — live provider status and last outcome.

## Developer environment variables

For **local development** only, running the server standalone reads a repo-root `.env` file — see [`.env.example`](../.env.example). The packaged app does **not** use `.env`; it injects config from `config.json` instead.

The server honors these environment variables:

| Variable | Purpose |
| --- | --- |
| `PORT` | Selects the server port (default `3847`, configurable in Settings). |
| `AI_PULSE_DATA_DIR` | Directory for the SQLite database. |
| `AI_PULSE_RESOURCE_DIR` | Packaged server resources (`config/`, `assets/`). |
| `AI_PULSE_WEB_DIR` | The web dashboard directory served by the server. |

## Where your keys go

Your keys are stored **locally** in `config.json` and injected into the server process's environment. They are **never sent anywhere except the provider APIs** you configured them for.
