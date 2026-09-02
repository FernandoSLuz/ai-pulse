# Operating AI Pulse (runbook)

The Electron desktop app is the single control surface for AI Pulse. It supervises the background server, shows the tray and Settings window, and hosts the docked leaderboard. This runbook covers the everyday operational tasks.

## Tray menu

Right-click the AI Pulse tray icon to reach the service controls. On Linux the icon is a StatusNotifierItem in your bar's tray (on Omarchy, the omarchy-shell bar's `omarchy.tray` widget); left/double-click do nothing there, so the context menu — including **Open Settings** — is the only interaction.

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

The server process itself shuts down cleanly on `SIGTERM`/`SIGINT` (SQLite is checkpointed first), so `kill <pid>` on Linux is safe; the `pid` is reported by `GET /api/health`.

## Stop or restart just the background service

Use the tray when you want the app to stay open but the server to cycle:

- **Tray → Stop Background Service** — pause the server.
- **Tray → Start Background Service** — bring it back.
- **Tray → Restart Background Service** — cycle it in one step.

You can also reach the same controls from **Settings → Startup & service**.

## Disable auto-start

Auto-launch starts the app hidden in the tray. On Windows it is a login item (an `HKCU` Run entry); on Linux it is an XDG autostart entry, `~/.config/autostart/ai-pulse.desktop` (Omarchy's uwsm session runs it via `xdg-desktop-autostart.target`). Turn it off either way:

- **In the app:** Settings → **Startup & service** → turn off **Start on login** (on Linux this deletes the autostart file).
- **In Windows:** **Task Manager → Startup** → select **AI Pulse** → **Disable**.
- **In Linux:** delete `~/.config/autostart/ai-pulse.desktop`.

Related toggle: **Start hidden in tray** (Settings → Startup & service) controls whether the app opens quietly in the tray on login.

## Where logs, database, and config live

Everything lives under the app's `userData` folder. On Windows that is `%APPDATA%\AI Pulse\`; on Linux it is `~/.config/AI Pulse/`.

| What | Windows | Linux |
| --- | --- | --- |
| API keys + preferences | `%APPDATA%\AI Pulse\config.json` | `~/.config/AI Pulse/config.json` |
| SQLite database | `%APPDATA%\AI Pulse\data\ai-pulse.db` | `~/.config/AI Pulse/data/ai-pulse.db` |
| Server log | `%APPDATA%\AI Pulse\logs\server.log` | `~/.config/AI Pulse/logs/server.log` |
| Updater log | `%APPDATA%\AI Pulse\logs\updater.log` | `~/.config/AI Pulse/logs/updater.log` |

Notes:

- `config.json` is the **only** place you edit API keys — the app injects them into the server's environment. Edit keys from **Settings → Connections**.
- `server.log` captures server stdout/stderr and is rotated at **5 MB**.

### Open the logs

**Settings → Open logs** reveals `server.log` on disk. On Linux you can also follow it live:

```bash
tail -f ~/.config/'AI Pulse'/logs/server.log
```

## Change the port

The server listens on **3847** by default.

**Settings → Startup & service → Server port** — set a new port, then restart the background service for it to take effect.

## Show, hide, and dock the leaderboard

The always-on desktop leaderboard widget is controlled from **Settings → Desktop leaderboard**:

- **Show** — show or hide the widget.
- **Dock left / right** — pin it to either screen edge.
- **Always-on-top** — keep it above other windows. **Windows only**: on Linux/Hyprland the compositor owns placement and stacking, so the toggle is disabled; the Hyprland rule shipped in `packages/widget/linux/hypr/ai-pulse.lua` (installed by `npm run linux:install`) floats the widget, pins it to all workspaces, and docks it to the right edge below the bar. While the leaderboard is visible the app also keeps tiled windows clear of it: it writes `~/.config/hypr/ai-pulse-dock.lua` (required by `ai-pulse.lua`) with extra `gaps_out` on the dock side for every workspace bound to that monitor and runs `hyprctl reload config-only`, so windows tile beside the widget instead of underneath — a real side dock that leaves the bar untouched (a monitor-level reserved area would shrink the bar). The gaps follow the dock side and monitor and are removed when the leaderboard is hidden, on quit, and on the next start (in case a crash left them behind). Both app windows carry the window class `ai-pulse`.
- **Rows** — how many models to list.

## Open the dashboard in a browser

The server serves the content dashboard (news, benchmarks, videos, chat, briefings). With the default port, open:

```text
http://localhost:3847
```

The dashboard is a content view only. Its settings gear redirects back into the desktop app via the `aipulse://` deep link (with an in-browser fallback drawer if the app isn't installed).

The server binds to `127.0.0.1` only. To reach it from another device on your LAN, run it with `AI_PULSE_BIND_HOST=0.0.0.0` (see [CONFIGURATION.md](./CONFIGURATION.md#network)).

## Updating

AI Pulse checks GitHub Releases for a newer version on startup and every few hours. Nothing installs on its own:

- When an update is found you get a tray/notification hint, and **Settings → Updates** shows it.
- Click **Download & install** to fetch it, then **Restart & install** to apply. You can also **Check for updates** manually there.
- Release-candidate builds are prereleases and are not offered as automatic updates.
- **Linux:** in-app updates work for the **AppImage** (`latest-linux.yml`). A **pacman** install shows *unsupported* in **Settings → Updates** — upgrade it with `sudo pacman -U ./ai-pulse-<version>.pacman` from the next final release (RCs ship no `.pacman`).

## Omarchy: theme and bar widget

After `npm run linux:install` (see [INSTALL.md](./INSTALL.md#6-omarchy-integration-optional)):

- **Theme** — the dashboard and the leaderboard follow the active Omarchy theme. The server watches the theme directory and pushes a `{type:"theme"}` WebSocket message, so open pages recolor without a reload; the installed `theme-set` hook also calls `POST /api/theme/reload`. If a page ever looks stale, `curl -X POST http://localhost:3847/api/theme/reload` forces a re-read.
- **Bar widget** (`fernando.ai-pulse`) — shows the current leaderboard leader (signal glyph + name) in the omarchy-shell bar and turns **urgent** when the server is down or curation is degraded to rules. **Left click** opens the dashboard, **right click** opens Settings (`aipulse://`), **middle click** refreshes. Its settings are `port`, `interval`, `showLeader`, and `maxChars`.

## If something looks wrong

If the feed is stale, curation shows **degraded (rules)**, the server won't stay up, or the dashboard won't load, see **[TROUBLESHOOTING.md](./TROUBLESHOOTING.md)**.
