# Configuration

In the packaged app, **all settings and optional integration tokens live in the app's Settings window** — there is no `.env` file to edit. AI analysis and chat run locally through the configured GGUF runtime.

> The dev-only `.env` workflow is described at the end, under [Developer environment variables](#developer-environment-variables).

## Where your configuration lives

The packaged app keeps everything under Electron's `userData` directory. On Windows that resolves to `%APPDATA%\AI Pulse`, on macOS to `~/Library/Application Support/AI Pulse`, and on Linux to `~/.config/AI Pulse`.

| What | Windows | macOS | Linux | Notes |
| --- | --- | --- | --- | --- |
| Preferences, local AI profile, and optional tokens | `%APPDATA%\AI Pulse\config.json` | `~/Library/Application Support/AI Pulse/config.json` | `~/.config/AI Pulse/config.json` | The app is the only place you edit this. |
| SQLite database | `%APPDATA%\AI Pulse\data\ai-pulse.db` | `~/Library/Application Support/AI Pulse/data/ai-pulse.db` | `~/.config/AI Pulse/data/ai-pulse.db` | Directory overridable via `AI_PULSE_DATA_DIR`. |
| Server logs | `%APPDATA%\AI Pulse\logs\server.log` | `~/Library/Application Support/AI Pulse/logs/server.log` | `~/.config/AI Pulse/logs/server.log` | Rotated at 5 MB. |
| Updater log | `%APPDATA%\AI Pulse\logs\updater.log` | `~/Library/Application Support/AI Pulse/logs/updater.log` | `~/.config/AI Pulse/logs/updater.log` | electron-updater output. |

On Linux the app also writes a few desktop-integration files outside `userData` (`ai-pulse.desktop`, the icon, and the XDG autostart entry) — see [INSTALL.md](./INSTALL.md#what-the-app-sets-up-on-linux).

## Optional integrations

Add these in **Settings → Connections**. No AI provider key is required.

Artificial Analysis, LiveBench, and SWE-bench Verified load automatically without
tokens or accounts. In the dashboard, use **Benchmarks → Source** to switch between
their independent leaderboards. An internet connection is needed to refresh data;
the last successful results remain cached locally.

| Provider | Powers | Get a key | Required? |
| --- | --- | --- | --- |
| Artificial Analysis (`AA_API_KEY`) | Benchmark enrichment (rankings work without it) | https://artificialanalysis.ai/insights | Optional |
| Tavily (`TAVILY_API_KEY`) | Web search only | https://app.tavily.com | Optional |
| X (`X_API_BEARER_TOKEN`) | Optional official X API feed; embedded profiles work without it | X developer portal | Optional |

Notes on the optional keys:

- **Artificial Analysis** is *not* required for rankings: AI Pulse reads the public leaderboard directly. The keyed `/free` endpoint only enriches rows (composite coding/math indexes) and is skipped quietly when the key is missing or rejected.
- **Chat web search** uses **Tavily** when configured; it is not a model provider.

### X / Twitter profiles

The X view starts in **Embed** mode and does not require a token. It preselects
official AI profiles and accepts a username (`sama`), an `@username`, or a
profile URL from `x.com` or `twitter.com` (including `www` and `mobile` links).
Copied query strings and fragments are ignored. The embed is subject to X's
availability rules: protected profiles and pages that require login may not
render. AI Pulse does not claim that an embed guarantees access to posts.

`X_API_BEARER_TOKEN` is a separate, optional **API** mode for fetching the
official feed. It is not needed to add profiles or use the default embedded
view.

## Local AI setup

AI curation and chat use the selected local GGUF through llama-server. Light is
Qwen3.5 0.8B Q4 (minimum 4 GiB RAM) and Balanced is Qwen3 1.7B Q8_0
(minimum 8 GiB RAM). Automatic selection recommends Light below 16 GiB to
leave room for the OS and other apps. First setup detects RAM,
offers both profiles, downloads the model and pinned CPU runtime with progress
and hash verification, and supports cancellation. If no model is ready,
deterministic rules remain available; the app never switches to a cloud model.

## Settings window sections

The Settings window is organized into these sections:

- **Connections** — all API keys.
- **Desktop leaderboard** — on Linux a **Mode** switch: *Bar panel* (default on Omarchy; the leaderboard opens from the bar widget and nothing moves) or *Floating window* (show/hide, dock side, **monitor**, rows, and an opt-in "keep tiled windows beside the widget"). The monitor choice and the gaps are written as Hyprland rules into `~/.config/hypr/ai-pulse-dock.lua`; because a monitor is decided when the window maps, changing it reopens the leaderboard. **Always-on-top is Windows-only**: on Hyprland the compositor owns stacking, so the shipped Hyprland rule floats, pins, and docks the window instead (see [INSTALL.md](./INSTALL.md#6-omarchy-integration-optional)).
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

The dashboard's **Videos → Add channel** flow accepts a YouTube username,
`@username`, a channel URL, or a channel ID. Choose **Creators** or
**Companies**; the selection is stored in local SQLite and the server validates
the channel's public RSS feed before using it. No YouTube API key is required.
The feed must have a valid response and at least one item from the last 90 days.
A channel cannot currently be saved under both kinds because the video schema
uses one kind per channel identity.

## Omarchy theme

On **Omarchy** the dashboard and the desktop leaderboard follow the active system theme. The server reads `~/.local/state/omarchy/current/theme/colors.toml`, maps its colors onto the CSS variables in `packages/web/styles.css`, and serves the result as `GET /theme.css`, which both pages link. It also:

- exposes `GET /api/theme` (the resolved palette) and `POST /api/theme/reload` (force a re-read — the `ai-pulse-theme-set` hook installed by `npm run linux:install` calls it on every theme switch);
- watches the theme directory and pushes a `{type:"theme"}` WebSocket message so open pages recolor **without a reload**.

Set `OMARCHY_THEME_COLORS` to point at a different palette file. When the file doesn't exist (Windows, or a non-Omarchy Linux desktop) the stylesheet is simply empty and the built-in look applies unchanged.

## Network

The server binds **`127.0.0.1`** by default, so nothing else on your LAN can reach it; set `AI_PULSE_BIND_HOST=0.0.0.0` to expose it. CORS is restricted to the server's own origins either way. It shuts down cleanly on `SIGTERM`/`SIGINT` (SQLite is checkpointed first), and `GET /api/health` identifies itself with `app: "ai-pulse"`, `version`, and `pid` — the desktop supervisor only adopts an already-running listener on the port if it answers that way.

## Developer environment variables

For **local development** only, running the server standalone reads a `.env` file — see [`.env.example`](../.env.example). The lookup order is `$AI_PULSE_ENV_FILE` ▸ `$AI_PULSE_RESOURCE_DIR/.env` ▸ `./.env` ▸ the repo root. The packaged app does **not** use `.env`; it injects config from `config.json` instead.

> Running the desktop app **unpackaged from a source checkout** (`npm run app`) may seed optional integration tokens from the repo-root `.env` into `config.json` **once**, on first run — it never overwrites saved settings. Packaged builds ignore `.env` entirely; local model setup is managed by the first-run flow.

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
