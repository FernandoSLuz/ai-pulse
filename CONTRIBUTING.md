# Contributing

Thanks for helping improve **AI Pulse** — a local AI model radar for Windows. This guide covers how to get set up, build, and land changes.

## Repo layout

AI Pulse is a monorepo using npm workspaces.

| Path | What it is |
| --- | --- |
| `packages/server` | Node + Express + WebSocket + SQLite backend. Polls benchmarks, RSS, and YouTube; runs the AI analyst; serves the REST API, WebSocket feed, and static web dashboard. |
| `packages/web` | The static browser dashboard (news, benchmarks, videos, chat, briefings). A content view only, served by the server. |
| `packages/widget` | The Electron desktop app — the single entry point and control surface. Supervises the server, and shows the tray, Settings window, and docked leaderboard. |
| `docs/` | Project documentation. |

## Prerequisites

- **Node 20+**
- **Windows** — required for building and running the desktop app and the installer.

## Dev setup

Install dependencies from the repo root:

```bash
npm install
```

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

Build the NSIS installer locally (output lands in `packages/widget/release`):

```bash
npm run dist -w @ai-pulse/widget
```

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

## Keep secrets out of git

API keys and preferences live in the app's `config.json`, and dev-only server runs read a repo-root `.env`. Both `.env` and `config.json` are git-ignored — never commit keys or secrets.

## Learn more

For a deeper look at the architecture, process model, and data flow, see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
