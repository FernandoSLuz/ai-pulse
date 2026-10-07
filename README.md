# AI Pulse

**Your personal AI model radar — a quiet local desktop app for Windows, macOS, and Linux (Omarchy/Hyprland).**

[![CI](https://github.com/FernandoSLuz/ai-pulse/actions/workflows/ci.yml/badge.svg)](https://github.com/FernandoSLuz/ai-pulse/actions/workflows/ci.yml)

AI Pulse tracks the AI landscape for you: a live **news feed**, **benchmark rankings**, an **AI-analyst briefing**, local **chat**, optional web search, a **"My Stack"** upgrade advisor, social posts, and an always-on **desktop leaderboard**. Analysis and chat run on a small local GGUF model configured during first setup.

It lives in your **system tray**, starts silently on login, keeps itself alive, and you configure everything from one app window.

---

## Install

1. Download the build for your OS from the [**Releases**](https://github.com/FernandoSLuz/ai-pulse/releases) page:

   | OS | Asset | Install |
   |----|-------|---------|
   | **Windows** | `AI-Pulse-Setup-<version>.exe` | Run it (per-user install, no admin; adds desktop + Start-menu shortcuts). If Windows SmartScreen warns about an unsigned app, choose **More info → Run anyway**. |
   | **macOS** (Intel) | `AI-Pulse-<version>-x64.dmg` | Open the DMG and drag AI Pulse to Applications. |
   | **macOS** (Apple Silicon) | `AI-Pulse-<version>-arm64.dmg` | Open the DMG and drag AI Pulse to Applications. |
   | **Linux x64** (portable) | `ai-pulse-<version>.AppImage` | `chmod +x ai-pulse-<version>.AppImage && ./ai-pulse-<version>.AppImage` — needs FUSE 2 (`sudo pacman -S fuse2` on Arch/Omarchy). |
   | **Linux x64** (Debian/Ubuntu) | `ai-pulse-<version>.deb` | `sudo apt install ./ai-pulse-<version>.deb`. |
   | **Linux x64** (Fedora/RHEL) | `ai-pulse-<version>.rpm` | `sudo dnf install ./ai-pulse-<version>.rpm`. |
   | **Linux x64** (Arch / Omarchy) | `ai-pulse-<version>.pacman` | `sudo pacman -U ./ai-pulse-<version>.pacman` — final releases only. |

2. On first launch the **Settings** window opens. Choose a local model profile; AI Pulse downloads the matching GGUF/runtime, verifies its hash, and shows progress or cancellation. No AI provider key is required. See [docs/INSTALL.md](docs/INSTALL.md).

That's it. AI Pulse now runs in your tray and starts automatically on login (you can turn that off in Settings — or in **Task Manager → Startup** on Windows, or by deleting `~/.config/autostart/ai-pulse.desktop` on Linux).

> Prefer to test drive first? Release-candidate builds (`vX.Y.Z-rc.N`) are published as prereleases on the same Releases page. They include Windows, macOS, and Linux x64 AppImage/deb/rpm assets; the `.pacman` package ships with final releases only.

> On **Omarchy**, `npm run linux:install` from a source checkout adds the Hyprland window rule, the theme hook, and a bar widget — see [docs/INSTALL.md](docs/INSTALL.md#6-omarchy-integration-optional).

The published desktop builds currently cover Windows x64, macOS Intel and Apple Silicon, and Linux x64. Linux arm64 and Windows arm64 are not published yet. The AppImage targets mainstream 64-bit Linux systems with FUSE 2; the native packages target their named distributions. AI Pulse does not promise compatibility with every OS release: the release matrix is tested on the GitHub Actions runner versions documented in [Releasing](docs/RELEASING.md), and older systems may need a matching older Electron or system library.

## What you get

- **News feed** — curated RSS sources, de-duplicated and scored (lab blogs plus press).
- **Creators** — YouTube videos from independent AI channels.
- **Companies** — official lab/company YouTube videos in a separate dashboard panel (not mixed into Creators).
- **Benchmark sources** — switch between Artificial Analysis, LiveBench, and SWE-bench Verified without API tokens. Each keeps its own scores and methodology. Artificial Analysis includes prices, speed, and evidence-backed access labels, with all tested configurations shown by default and an optional best-per-model view.
- **AI Analyst** — a briefing on new models, leader changes, and big news.
- **Ask AI Pulse** — local chat with optional Tavily web search.
- **X / Twitter** — a no-token embedded profile view is the default, preselected with official AI accounts. Add a username, `@username`, or an `x.com`/`twitter.com` profile URL; X may still restrict embeds for protected or login-required accounts. The optional `X_API_BEARER_TOKEN` adds the separate official API feed.
- **My Stack** — track your current model and get upgrade suggestions when something better lands.
- **Desktop leaderboard** — on Windows an always-on-top widget docked to your screen edge; on Omarchy a **bar panel**: click the AI Pulse entry in the bar and the leaderboard drops down like the other Omarchy panels (Esc closes, nothing else moves). The floating window remains available in Settings.
- **Notifications** — desktop notifications (Windows toasts; `notify-send`/libnotify on Linux) for new models, leader changes, and upgrade suggestions.
- **Omarchy integration** — on Omarchy the dashboard and leaderboard follow your active theme, and a bar widget shows the current leader.

## Why it stays reliable

The local runtime is configured on first launch with light/balanced profiles selected from detected RAM. Light uses **Qwen3.5 0.8B Q4**, and Balanced uses **Qwen3 1.7B Q8_0**; both are downloaded as pinned, hash-verified GGUF files and served by the pinned llama.cpp CPU runtime. The app works without a model too: deterministic rules keep rankings and briefings usable while a download is pending or cancelled. All three benchmark sources load public data automatically; `AA_API_KEY` is optional enrichment. X posts and Tavily are optional data/search integrations, never model fallbacks. Details in [docs/RELIABILITY.md](docs/RELIABILITY.md).

## The app is the control center

Open AI Pulse from the tray (or its shortcut) to reach the **Settings** window:

- **Local AI** — model profile, download progress/hash status, and runtime controls.
- **Connections** — optional AA, Tavily, and X tokens. No `.env`, no config files to hand-edit.
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
| [Configuration](docs/CONFIGURATION.md) | Local AI, optional integrations, config/data, env vars |
| [Operating (runbook)](docs/OPERATIONS.md) | Tray, logs, startup, day-to-day |
| [Reliability](docs/RELIABILITY.md) | Local runtime, rules mode, and self-healing supervisor |
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
npm run dist:linux -w @ai-pulse/widget   # Linux AppImage + deb + rpm + pacman packages
npm run linux:install                    # Omarchy: Hyprland rule, theme hook, bar widget
```

For standalone development the server reads a repo-root `.env` (copy `.env.example`); the desktop app started from a source checkout copies optional integration keys into its `config.json` on first run. The packaged app does not need `.env`, and no model provider key exists: model inference is always local. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Repository layout

```
packages/server/   Background service: polling, analyst, chat, REST + WebSocket API, SQLite
packages/web/      Browser dashboard (served by the server)
packages/widget/   Electron desktop app: tray, server supervisor, settings, leaderboard
packages/widget/linux/     Hyprland window rule + Omarchy theme hook (installed by scripts/linux-install.mjs)
packages/omarchy-plugin/   omarchy-shell bar widget (fernando.ai-pulse)
docs/              Documentation
.github/workflows/ CI and native installer/release pipelines for Windows, macOS, and Linux
```

## License

Personal project — not yet licensed for redistribution.
