# AI Pulse

**Your personal AI model radar — as a quiet desktop app for Windows and Linux (Omarchy/Hyprland).**

[![CI](https://github.com/FernandoSLuz/ai-pulse/actions/workflows/ci.yml/badge.svg)](https://github.com/FernandoSLuz/ai-pulse/actions/workflows/ci.yml)

AI Pulse tracks the AI landscape for you: a live **news feed**, **benchmark rankings**, an **AI-analyst briefing** on every meaningful change, an embedded **chat** with a web-search agent, a **"My Stack"** upgrade advisor, and an always-on **desktop leaderboard** — all running locally and curated by free cloud AI that rotates so it's **always available**.

It lives in your **system tray**, starts silently on login, keeps itself alive, and you configure everything from one app window.

---

## Install

1. Download the build for your OS from the [**Releases**](https://github.com/FernandoSLuz/ai-pulse/releases) page:

   | OS | Asset | Install |
   |----|-------|---------|
   | **Windows** | `AI Pulse-Setup-<version>.exe` | Run it (per-user install, no admin; adds desktop + Start-menu shortcuts). If Windows SmartScreen warns about an unsigned app, choose **More info → Run anyway**. |
   | **Linux** (any distro) | `ai-pulse-<version>.AppImage` | `chmod +x ai-pulse-<version>.AppImage && ./ai-pulse-<version>.AppImage` — needs FUSE 2 (`sudo pacman -S fuse2` on Arch/Omarchy). |
   | **Linux** (Arch / Omarchy) | `ai-pulse-<version>.pacman` | `sudo pacman -U ./ai-pulse-<version>.pacman` — final releases only. |

2. On first launch the **Settings** window opens — under **Connections**, paste at least one AI provider key (Gemini is the easiest free one). See [docs/INSTALL.md](docs/INSTALL.md).

That's it. AI Pulse now runs in your tray and starts automatically on login (you can turn that off in Settings — or in **Task Manager → Startup** on Windows, or by deleting `~/.config/autostart/ai-pulse.desktop` on Linux).

> Prefer to test drive first? Release-candidate builds (`vX.Y.Z-rc.N`) are published as prereleases on the same Releases page — as `.exe` and `.AppImage` only; the `.pacman` package ships with final releases.

> On **Omarchy**, `npm run linux:install` from a source checkout adds the Hyprland window rule, the theme hook, and a bar widget — see [docs/INSTALL.md](docs/INSTALL.md#6-omarchy-integration-optional).

## What you get

- **News feed** — curated RSS sources, de-duplicated and scored (lab blogs plus press).
- **Creators** — YouTube videos from independent AI channels.
- **Companies** — official lab/company YouTube videos in a separate dashboard panel (not mixed into Creators).
- **Benchmark table** — Artificial Analysis intelligence, coding, math, price, speed, accessibility. Effort/reasoning variants of the same model collapse into one visible row (aliases keep My Stack highlights on the survivor).
- **AI Analyst** — a briefing on new models, leader changes, and big news.
- **Ask AI Pulse** — chat with free models plus an automatic web-search agent.
- **My Stack** — track your current model and get upgrade suggestions when something better lands.
- **Desktop leaderboard** — an always-on ranking widget docked to your screen edge (always-on-top on Windows; on Hyprland a shipped window rule floats and pins it and the app adds workspace gaps so other windows tile beside it).
- **Notifications** — desktop notifications (Windows toasts; `notify-send`/libnotify on Linux) for new models, leader changes, and upgrade suggestions.
- **Omarchy integration** — on Omarchy the dashboard and leaderboard follow your active theme, and a bar widget shows the current leader.

## Why it stays reliable

AI curation never depends on a single free tier. A router rotates across **Gemini → Cerebras → Groq → OpenRouter** (you only need one key; more = more resilient), backs off from rate-limited providers, and **never silently dies** — the app always shows whether curation is healthy or degraded. The desktop app **supervises** the background server and restarts it automatically on crash *or* hang. Details in [docs/RELIABILITY.md](docs/RELIABILITY.md).

## The app is the control center

Open AI Pulse from the tray (or its shortcut) to reach the **Settings** window:

- **Connections** — every API key, in one place. No `.env`, no config files to hand-edit.
- **Desktop leaderboard** — show/hide, dock left/right, pin on top (Windows only — Hyprland owns stacking), row count.
- **Startup & service** — start on login, start hidden, server port, and Start/Stop/Restart.
- **Preferences** — your primary model, provider, priority weights, budget, and notes.
- **Notifications** and a live **AI curation health** panel.

The browser dashboard is the *content* view; its settings gear opens the app.

## Tray controls

Right-click the tray icon for: **Open Settings**, **Show/Hide Leaderboard**, **Open Dashboard**, **Restart/Stop/Start Background Service**, **Start on login**, and **Quit AI Pulse** (which stops the server *and* the app).

On Linux the icon is a StatusNotifierItem shown by your bar's tray (on Omarchy, the omarchy-shell bar) — nothing extra to install. Clicking the icon does nothing there; use the right-click menu (**Open Settings**).

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

Requires **Node >= 22.14**.

```bash
npm ci && npx install-electron   # Electron >= 42 doesn't fetch its binary on install
npm run dev      # server only (http://localhost:3847), tsx watch
npm run app      # build everything + launch the Electron app
npm run build    # build server + desktop app
npm run gate     # build + syntax-check the browser/renderer JS (what CI runs)
npm run dist -w @ai-pulse/widget         # Windows installer (packages/widget/release)
npm run dist:linux -w @ai-pulse/widget   # Linux AppImage + pacman package
npm run linux:install                    # Omarchy: Hyprland rule, theme hook, bar widget
```

For standalone dev the server reads a repo-root `.env` (copy `.env.example`); the desktop app started from a source checkout copies those keys into its `config.json` on first run. The packaged app doesn't need one — keys live in the app. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Repository layout

```
packages/server/   Background service: polling, analyst, chat, REST + WebSocket API, SQLite
packages/web/      Browser dashboard (served by the server)
packages/widget/   Electron desktop app: tray, server supervisor, settings, leaderboard
packages/widget/linux/     Hyprland window rule + Omarchy theme hook (installed by scripts/linux-install.mjs)
packages/omarchy-plugin/   omarchy-shell bar widget (fernando.ai-pulse)
docs/              Documentation
.github/workflows/ CI (build/typecheck) and Release (Windows installer + Linux packages on tags)
```

## License

Personal project — not yet licensed for redistribution.
