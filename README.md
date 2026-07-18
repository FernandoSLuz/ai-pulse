# AI Pulse

**Your personal AI model radar — as a quiet Windows desktop app.**

[![CI](https://github.com/FernandoSLuz/ai-pulse/actions/workflows/ci.yml/badge.svg)](https://github.com/FernandoSLuz/ai-pulse/actions/workflows/ci.yml)

AI Pulse tracks the AI landscape for you: a live **news feed**, **benchmark rankings**, an **AI-analyst briefing** on every meaningful change, an embedded **chat** with a web-search agent, a **"My Stack"** upgrade advisor, and an always-on **desktop leaderboard** — all running locally and curated by free cloud AI that rotates so it's **always available**.

It lives in your **system tray**, starts silently on login, keeps itself alive, and you configure everything from one app window.

---

## Install

1. Download **`AI Pulse-Setup-<version>.exe`** from the [**Releases**](https://github.com/FernandoSLuz/ai-pulse/releases) page.
2. Run it (per-user install, no admin; adds desktop + Start-menu shortcuts). If Windows SmartScreen warns about an unsigned app, choose **More info → Run anyway**.
3. On first launch the **Settings** window opens — under **Connections**, paste at least one AI provider key (Gemini is the easiest free one). See [docs/INSTALL.md](docs/INSTALL.md).

That's it. AI Pulse now runs in your tray and starts automatically on login (you can turn that off in Settings or Task Manager → Startup).

> Prefer to test drive first? Release-candidate builds (`vX.Y.Z-rc.N`) are published as prereleases on the same Releases page.

## What you get

- **News feed** — curated RSS sources, de-duplicated and scored.
- **Benchmark table** — Artificial Analysis intelligence, coding, math, price, speed, accessibility.
- **AI Analyst** — a briefing on new models, leader changes, and big news.
- **Ask AI Pulse** — chat with free models plus an automatic web-search agent.
- **My Stack** — track your current model and get upgrade suggestions when something better lands.
- **Desktop leaderboard** — an always-on-top ranking widget docked to your screen edge.
- **Notifications** — Windows toasts for new models, leader changes, and upgrade suggestions.

## Why it stays reliable

AI curation never depends on a single free tier. A router rotates across **Gemini → Cerebras → Groq → OpenRouter** (you only need one key; more = more resilient), backs off from rate-limited providers, and **never silently dies** — the app always shows whether curation is healthy or degraded. The desktop app **supervises** the background server and restarts it automatically on crash *or* hang. Details in [docs/RELIABILITY.md](docs/RELIABILITY.md).

## The app is the control center

Open AI Pulse from the tray (or its shortcut) to reach the **Settings** window:

- **Connections** — every API key, in one place. No `.env`, no config files to hand-edit.
- **Desktop leaderboard** — show/hide, dock left/right, pin on top, row count.
- **Startup & service** — start on login, start hidden, server port, and Start/Stop/Restart.
- **Preferences** — your primary model, provider, priority weights, budget, and notes.
- **Notifications** and a live **AI curation health** panel.

The browser dashboard is the *content* view; its settings gear opens the app.

## Tray controls

Right-click the tray icon for: **Open Settings**, **Show/Hide Leaderboard**, **Open Dashboard**, **Restart/Stop/Start Background Service**, **Start on login**, and **Quit AI Pulse** (which stops the server *and* the app).

## Documentation

| Doc | What's inside |
|-----|---------------|
| [Install](docs/INSTALL.md) | Download, install, first run, uninstall |
| [Configuration](docs/CONFIGURATION.md) | API keys, where config/data live, env vars |
| [Operating (runbook)](docs/OPERATIONS.md) | Tray, logs, startup, day-to-day |
| [Reliability](docs/RELIABILITY.md) | Cloud AI rotation + self-healing supervisor |
| [Architecture](docs/ARCHITECTURE.md) | How the pieces fit together |
| [Releasing](docs/RELEASING.md) | Tagging, CI, RC vs. full releases |
| [Troubleshooting](docs/TROUBLESHOOTING.md) | Symptoms → fixes |
| [Contributing](CONTRIBUTING.md) | Dev setup and PR flow |

## Develop from source

```bash
npm install
npm run dev      # server only (http://localhost:3847), tsx watch
npm run app      # build everything + launch the Electron app
npm run build    # build server + desktop app
npm run dist -w @ai-pulse/widget   # build the Windows installer (packages/widget/release)
```

For standalone dev the server reads a repo-root `.env` (copy `.env.example`). The packaged app doesn't need one — keys live in the app. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Repository layout

```
packages/server/   Background service: polling, analyst, chat, REST + WebSocket API, SQLite
packages/web/      Browser dashboard (served by the server)
packages/widget/   Electron desktop app: tray, server supervisor, settings, leaderboard
docs/              Documentation
.github/workflows/ CI (build/typecheck) and Release (installer on tags)
```

## License

Personal project — not yet licensed for redistribution.
