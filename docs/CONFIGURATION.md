# Configuration

In the packaged app, **all settings and API keys live in the app's Settings window** — there is no `.env` file to edit. The desktop app is the single control surface: it stores your preferences and keys, then injects the keys into the background server process for you.

> The dev-only `.env` workflow is described at the end, under [Developer environment variables](#developer-environment-variables).

## Where your configuration lives

The packaged app keeps everything under Electron's `userData` directory. On Windows that resolves to `%APPDATA%\AI Pulse`; on Linux to `~/.config/AI Pulse`.

| What | Windows | Linux | Notes |
| --- | --- | --- | --- |
| API keys + preferences | `%APPDATA%\AI Pulse\config.json` | `~/.config/AI Pulse/config.json` | The app is the only place you edit this. Keys are injected into the server child's environment at launch. |
| SQLite database | `%APPDATA%\AI Pulse\data\ai-pulse.db` | `~/.config/AI Pulse/data/ai-pulse.db` | Directory overridable via `AI_PULSE_DATA_DIR`. |
| Server logs | `%APPDATA%\AI Pulse\logs\server.log` | `~/.config/AI Pulse/logs/server.log` | Rotated at 5 MB. |
| Updater log | `%APPDATA%\AI Pulse\logs\updater.log` | `~/.config/AI Pulse/logs/updater.log` | electron-updater output. |

On Linux the app also writes a few desktop-integration files outside `userData` (`ai-pulse.desktop`, the icon, and the XDG autostart entry) — see [INSTALL.md](./INSTALL.md#what-the-app-sets-up-on-linux).

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
- **Desktop leaderboard** — show/hide, dock left or right, always-on-top, number of rows. **Always-on-top is Windows-only**: on Linux/Hyprland the compositor owns placement and stacking, so the toggle is disabled and the shipped Hyprland rule floats, pins, and docks the widget instead, while the app reserves the widget's strip on that monitor so other windows tile beside it (see [INSTALL.md](./INSTALL.md#6-omarchy-integration-optional)).
- **Startup & service** — Start on login (Windows: an `HKCU` Run entry; Linux: `~/.config/autostart/ai-pulse.desktop`), Start hidden in tray, Server port, and Restart / Stop / Start.
- **Preferences** — primary model, provider, priority weights (coding / reasoning / speed / cost), budget tier, and notes (the upgrade advisor formerly known as the web "My Stack").
- **Notifications** — breaking news, new models & leader changes, upgrade suggestions.
- **AI curation health** — live provider status and last outcome.

## News feeds, company channels, and `tier`

`packages/server/config/sources.json` is **reread on every poll cycle** (RSS ~20 min, YouTube ~30 min). Adding a feed or channel does not require a code change or a server restart. There is no schema validation: broken JSON means that source silently returns nothing.

| Array | Purpose |
| --- | --- |
| `feeds` | RSS/Atom news sources. Each item is `{ url, source, tier }`. |
| `youtubeChannels` | Independent creator channels shown in the **Creators** panel. `{ name, handle, channelId }`. |
| `companyChannels` | Official lab/company channels shown in the **Companies** panel. Same shape as `youtubeChannels`. |

`tier` is **not** a relevance score. It only decides which story wins when two headlines are treated as the same cluster (48h window + Jaccard ≥ 0.55): **the smaller number wins**. Defaults to 99 if omitted.

| `tier` | Meaning |
| --- | --- |
| 1 | Official lab/blog/changelog |
| 2 | Press and Google News queries |
| 3 | Community (HN, Reddit, …) |

New feed URLs must be verified with a real GET (HTTP 200 + parseable RSS/Atom + at least one item in the last 90 days) before they enter this file. YouTube `channelId` values come from `youtube.com/@handle` (`"externalId":"UC…"`), never guessed.

## Omarchy theme

On **Omarchy** the dashboard and the desktop leaderboard follow the active system theme. The server reads `~/.local/state/omarchy/current/theme/colors.toml`, maps its colors onto the CSS variables in `packages/web/styles.css`, and serves the result as `GET /theme.css`, which both pages link. It also:

- exposes `GET /api/theme` (the resolved palette) and `POST /api/theme/reload` (force a re-read — the `ai-pulse-theme-set` hook installed by `npm run linux:install` calls it on every theme switch);
- watches the theme directory and pushes a `{type:"theme"}` WebSocket message so open pages recolor **without a reload**.

Set `OMARCHY_THEME_COLORS` to point at a different palette file. When the file doesn't exist (Windows, or a non-Omarchy Linux desktop) the stylesheet is simply empty and the built-in look applies unchanged.

## Network

The server binds **`127.0.0.1`** by default, so nothing else on your LAN can reach it; set `AI_PULSE_BIND_HOST=0.0.0.0` to expose it. CORS is restricted to the server's own origins either way. It shuts down cleanly on `SIGTERM`/`SIGINT` (SQLite is checkpointed first), and `GET /api/health` identifies itself with `app: "ai-pulse"`, `version`, and `pid` — the desktop supervisor only adopts an already-running listener on the port if it answers that way.

## Developer environment variables

For **local development** only, running the server standalone reads a `.env` file — see [`.env.example`](../.env.example). The lookup order is `$AI_PULSE_ENV_FILE` ▸ `$AI_PULSE_RESOURCE_DIR/.env` ▸ `./.env` ▸ the repo root. The packaged app does **not** use `.env`; it injects config from `config.json` instead.

> Running the desktop app **unpackaged from a source checkout** (`npm run app`) seeds the API keys from the repo-root `.env` into `config.json` **once**, on first run — it never overwrites keys you have already saved. Packaged builds ignore `.env` entirely.

The server honors these environment variables:

| Variable | Purpose |
| --- | --- |
| `PORT` | Selects the server port (default `3847`, configurable in Settings). |
| `AI_PULSE_DATA_DIR` | Directory for the SQLite database. |
| `AI_PULSE_RESOURCE_DIR` | Packaged server resources (`config/`, `assets/`). |
| `AI_PULSE_WEB_DIR` | The web dashboard directory served by the server. |
| `AI_PULSE_BIND_HOST` | Interface to listen on. Default `127.0.0.1` (local only); `0.0.0.0` exposes the server to your LAN. |
| `AI_PULSE_ENV_FILE` | Explicit path of the `.env` file to load (dev only). |
| `AI_PULSE_VERSION` | Set by the desktop app when it spawns the server; reported by `GET /api/health`. |
| `OMARCHY_THEME_COLORS` | Linux/Omarchy: path of the `colors.toml` used to build `/theme.css` (default `~/.local/state/omarchy/current/theme/colors.toml`). |

## Where your keys go

Your keys are stored **locally** in `config.json` and injected into the server process's environment. They are **never sent anywhere except the provider APIs** you configured them for.
