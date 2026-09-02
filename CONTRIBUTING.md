# Contributing

Thanks for helping improve **AI Pulse** — a local AI model radar for Windows and Linux (Omarchy/Hyprland). This guide covers how to get set up, build, and land changes.

## Repo layout

AI Pulse is a monorepo using npm workspaces.

| Path | What it is |
| --- | --- |
| `packages/server` | Node + Express + WebSocket + SQLite backend. Polls benchmarks, RSS, and YouTube; runs the AI analyst; serves the REST API, WebSocket feed, and static web dashboard. |
| `packages/web` | The static browser dashboard (news, benchmarks, videos, chat, briefings). A content view only, served by the server. |
| `packages/widget` | The Electron desktop app — the single entry point and control surface. Supervises the server, and shows the tray, Settings window, and docked leaderboard. `src/platform.ts` holds the per-OS desktop integration; `linux/` holds the Hyprland window rule and the Omarchy theme hook; `scripts/linux-install.mjs` installs them. |
| `packages/omarchy-plugin` | The omarchy-shell bar widget (`fernando.ai-pulse`). Not shipped inside the app packages — installed by `npm run linux:install`. |
| `docs/` | Project documentation. |

## Prerequisites

- **Node 22.14+** (`engines`).
- **Windows** — to build and run the NSIS installer.
- **Linux** — to build the AppImage and pacman packages. Any distro works for the AppImage (FUSE 2 to run it); **Omarchy** (Arch + Hyprland + omarchy-shell) is the reference desktop for the tray, window rules, theme, and bar widget. The pacman target needs `bsdtar` (`libarchive` on Arch, `libarchive-tools` on Debian/Ubuntu).
- **ImageMagick** — only to regenerate icons (`npm run icons -w @ai-pulse/widget`, from `build/icon-master-1024.png`).

## Dev setup

Install dependencies from the repo root, then fetch the Electron binary (Electron >= 42 no longer downloads it during install):

```bash
npm ci
npx install-electron
```

`better-sqlite3` >= 13 is a Node-API addon: the single prebuilt binary loads under both Node and Electron, so there is no `@electron/rebuild` step and `npm rebuild better-sqlite3` is a no-op.

Run the server on its own with hot reload (tsx watch):

```bash
npm run dev
```

The server listens at http://localhost:3847.

Build everything and launch the full Electron app:

```bash
npm run app
```

## Building

Build the server and desktop app:

```bash
npm run build
```

Run what CI runs (build + `node --check` on the browser and renderer JS):

```bash
npm run gate
```

Build the installers locally (output lands in `packages/widget/release`):

```bash
npm run dist -w @ai-pulse/widget            # Windows: NSIS installer
npm run dist:linux -w @ai-pulse/widget      # Linux: AppImage + pacman
npm run dist:linux:dir -w @ai-pulse/widget  # Linux: unpacked app dir only
```

## Linux / Omarchy integration

From a source checkout, `npm run linux:install` (= `node packages/widget/scripts/linux-install.mjs`) wires the app into an Omarchy desktop: the Hyprland window rule (`~/.config/hypr/ai-pulse.lua` plus a `require("hypr.ai-pulse")` line in `hyprland.lua`, with backups), the theme hook (`~/.config/omarchy/hooks/theme-set.d/ai-pulse-theme-set`), and the bar widget plugin (`~/.config/omarchy/plugins/fernando.ai-pulse`, enabled after `omarchy.tray`). `npm run linux:uninstall -w @ai-pulse/widget` reverts it.

Things to know when touching that code:

- Both app windows have the window class **`ai-pulse`** (from `app.setDesktopName`). Match on that — never on `Electron`.
- Hyprland config is **Lua**: the `o.window` rules live in `packages/widget/linux/hypr/ai-pulse.lua`. Validate with `hyprctl reload && hyprctl configerrors`.
- The bar widget lives in `packages/omarchy-plugin/`; validate with `omarchy plugin validate <dir>`.
- Hyprland has no always-on-top, so the **Always on top** toggle is disabled on Linux; placement and stacking come from the window rule.

## Code style

- Write **TypeScript** and match the existing idioms in the file you're editing.
- The web dashboard and Electron renderers are **plain JS/TS + HTML/CSS** — there is no framework. Keep them that way.

## Branch & PR flow

1. Create a **feature branch** off `main`.
2. Open a **PR into `main`**.
3. Make sure **CI passes** before requesting review.

## Where things live

| Area | Location |
| --- | --- |
| AI providers / LLM router | `packages/server/src/analyst/llm-router.ts` |
| Server supervisor | `packages/widget/src/supervisor.ts` |
| Settings UI | `packages/widget/renderer/` |
| Linux desktop integration (`.desktop`, icon, `aipulse://`, autostart) | `packages/widget/src/platform.ts` |
| Hyprland window rule + Omarchy theme hook | `packages/widget/linux/` |
| Omarchy installer | `packages/widget/scripts/linux-install.mjs` |
| Omarchy bar widget | `packages/omarchy-plugin/fernando.ai-pulse/` |
| Omarchy theme bridge (`/theme.css`, `/api/theme`) | `packages/server/src/theme.ts` |

## Keep secrets out of git

API keys and preferences live in the app's `config.json`, and dev-only server runs read a repo-root `.env`. Launching the desktop app unpackaged from a checkout seeds the keys from that `.env` into `config.json` once, on first run (saved keys are never overwritten); packaged builds ignore `.env`. Both `.env` and `config.json` are git-ignored — never commit keys or secrets.

## Learn more

For a deeper look at the architecture, process model, and data flow, see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
