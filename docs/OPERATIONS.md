# Operating AI Pulse (runbook)

The Electron desktop app is the single control surface for AI Pulse. It supervises the background server, shows the tray and Settings window, and hosts the docked leaderboard. This runbook covers the everyday operational tasks.

## Tray menu

Right-click the AI Pulse tray icon to reach the service controls.

| Item | What it does |
| --- | --- |
| **Start Background Service** | Starts the server child process if it is stopped. |
| **Stop Background Service** | Stops the server but leaves the app running. |
| **Restart Background Service** | Stops and restarts the server child process. |
| **Quit AI Pulse** | Stops the server **and** exits the app. |

> The app also health-pings the server every 20s and restarts it automatically on a crash (exponential backoff, capped at 30s) or a hang (after 3 consecutive failed health checks). You normally don't need to touch these controls.

## Exit everything

To shut down both the server and the app:

**Tray → Quit AI Pulse**

This stops the background service and closes the desktop app. Closing the Settings or leaderboard window alone does **not** exit — the app keeps running in the tray.

## Stop or restart just the background service

Use the tray when you want the app to stay open but the server to cycle:

- **Tray → Stop Background Service** — pause the server.
- **Tray → Start Background Service** — bring it back.
- **Tray → Restart Background Service** — cycle it in one step.

You can also reach the same controls from **Settings → Startup & service**.

## Disable auto-start

Auto-launch is a Windows login item (an `HKCU` Run entry). It starts the app hidden in the tray. Turn it off either way:

- **In the app:** Settings → **Startup & service** → turn off **Start on login**.
- **In Windows:** **Task Manager → Startup** → select **AI Pulse** → **Disable**.

Related toggle: **Start hidden in tray** (Settings → Startup & service) controls whether the app opens quietly in the tray on login.

## Where logs, database, and config live

Everything lives under the app's `userData` folder. On Windows that is `%APPDATA%\AI Pulse\`.

| What | Path |
| --- | --- |
| API keys + preferences | `%APPDATA%\AI Pulse\config.json` |
| SQLite database | `%APPDATA%\AI Pulse\data\ai-pulse.db` |
| Server log | `%APPDATA%\AI Pulse\logs\server.log` |

Notes:

- `config.json` is the **only** place you edit API keys — the app injects them into the server's environment. Edit keys from **Settings → Connections**.
- `server.log` captures server stdout/stderr and is rotated at **5 MB**.

### Open the logs

**Settings → Open logs** reveals `server.log` on disk.

## Change the port

The server listens on **3847** by default.

**Settings → Startup & service → Server port** — set a new port, then restart the background service for it to take effect.

## Show, hide, and dock the leaderboard

The always-on desktop leaderboard widget is controlled from **Settings → Desktop leaderboard**:

- **Show** — show or hide the widget.
- **Dock left / right** — pin it to either screen edge.
- **Always-on-top** — keep it above other windows.
- **Rows** — how many models to list.

## Open the dashboard in a browser

The server serves the content dashboard (news, benchmarks, videos, chat, briefings). With the default port, open:

```text
http://localhost:3847
```

The dashboard is a content view only. Its settings gear redirects back into the desktop app via the `aipulse://` deep link (with an in-browser fallback drawer if the app isn't installed).

## If something looks wrong

If the feed is stale, curation shows **degraded (rules)**, the server won't stay up, or the dashboard won't load, see **[TROUBLESHOOTING.md](./TROUBLESHOOTING.md)**.
