# Troubleshooting

This guide covers the most common issues with **AI Pulse** and how to fix them. Most problems are resolved from the desktop app's **Settings** window or the **tray** icon.

> AI Pulse is controlled entirely from the Electron desktop app. The app supervises the background service, so start there when something looks wrong.

## Quick reference

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| **"AI: degraded (rules)"** shown in the app | The local model is downloading, cancelled, unavailable, or failed to start | Open **Settings → Local AI**, resume/retry the verified download, or keep using rules mode. |
| Background service won't start, or keeps restarting | The server port is already in use, or a bad build | Change the port in **Settings → Startup & service → Server port**, then check the logs via **Settings → Open logs**. |
| **"Server offline"** / no data anywhere | The background service is stopped | Open the **tray → Start Background Service**. |
| No live benchmarks | The public Artificial Analysis fetch failed (network/DNS), or the app was built before the current parser | Check **Settings → Open logs** for `[AA Public]` lines. An `AA_API_KEY` is optional enrichment, not a requirement. |
| Chat shows no models | The local runtime/model is not ready | Open **Settings → Local AI** and resume the model setup. |
| Web search in chat is off | Tavily is not configured or network access failed | Add optional `TAVILY_API_KEY` in **Settings → Connections**. |
| Clicking the dashboard **gear** does nothing | The desktop app isn't installed or the `aipulse://` protocol isn't registered | Use the browser's **"Edit here instead"** fallback drawer, or open the app from the **tray**. |
| Port **3847** already in use | Another process (or a second copy of AI Pulse) holds the port | Change the port in **Settings → Startup & service → Server port**. |
| Installer blocked by **SmartScreen** | Windows doesn't recognize the publisher yet | Click **More info → Run anyway**. |
| Desktop leaderboard not visible | The leaderboard window is hidden | Enable **Settings → Desktop leaderboard → Show**, or use the **tray → Show Leaderboard**. |
| **Linux:** no tray icon | Your bar has no StatusNotifierItem host running | See [Tray icon missing (Linux)](#tray-icon-missing-linux). On Omarchy make sure the bar's `omarchy.tray` widget is enabled. |
| **Linux:** `aipulse://` does nothing | The scheme handler isn't registered | `xdg-mime query default x-scheme-handler/aipulse` should print `ai-pulse.desktop`; otherwise run `update-desktop-database ~/.local/share/applications` and restart the app. |
| **Linux/Hyprland:** leaderboard not docked, or floats anywhere | The Hyprland rule isn't loaded | `hyprctl configerrors`, then re-run `npm run linux:install`. See [Leaderboard not showing](#leaderboard-not-showing). |
| **Linux:** **Always on top** is greyed out | Expected — Hyprland has no always-on-top | Use the bar panel (default), or in floating-window mode the shipped rule floats and pins the widget. |
| **Linux:** clicking the bar entry does nothing | The plugin isn't loaded | `omarchy plugin list` should show `fernando.ai-pulse enabled`; else `npm run linux:install` and check `journalctl --user -t omarchy-shell` for QML errors. |
| **Linux/Hyprland:** windows stay squeezed after AI Pulse crashed | The dock gaps file was left behind | Start AI Pulse again (it clears it on launch), or empty `~/.config/hypr/ai-pulse-dock.lua` and run `hyprctl reload config-only`. |
| **Linux:** no notifications | No notification daemon is running | `notify-send -a 'AI Pulse' test` should pop a notification; on Omarchy the omarchy-shell notification daemon renders them. |
| **Linux:** AppImage won't start | FUSE 2 is missing | `sudo pacman -S fuse2` (Arch/Omarchy). |

## "AI: degraded (rules)"

AI Pulse runs its analyst and chat locally. When you see **"AI: degraded (rules)"**, the local model is not ready and deterministic rules are serving the app.

- Resume or retry the model download under **Settings → Local AI**.
- Verify that the configured model hash completed and that enough disk/RAM is available.
- No external model key is required or used as fallback.

## The service won't start or keeps restarting

The desktop app's supervisor health-pings the server every 20 seconds and restarts it on crash or hang. If it never stabilizes:

1. Change the port in **Settings → Startup & service → Server port** (something else may be holding **3847**).
2. Open the logs to see the underlying error:
   - **Settings → Open logs**
3. Use the tray controls to cycle the service: **Restart / Stop / Start Background Service**.

## Missing data or offline dashboard

If the web dashboard shows **"Server offline"** or no content loads, the background service is stopped. Start it from the **tray → Start Background Service**. The tray also offers **Restart** and **Stop**, plus **Quit AI Pulse** (which stops both the server and the app).

## Chat, search, and benchmarks

These features each depend on a specific key in **Settings → Connections**:

- **Benchmarks:** no key needed — rankings come from the public Artificial Analysis leaderboard. An `AA_API_KEY` only enriches rows with the composite coding/math indexes.
- **Chat models:** use the configured local GGUF; no key is required.
- **Chat web search:** add an optional `TAVILY_API_KEY`; it provides search only.

## The dashboard gear does nothing

The web dashboard is a content view only. Its settings gear redirects to the desktop app via the `aipulse://` deep link. If nothing happens, the app likely isn't installed or the protocol isn't registered:

- Use the in-browser **"Edit here instead"** fallback drawer, **or**
- Open the app directly from the **tray** (on Linux, from its right-click menu or your app launcher).

On Linux the app registers the handler itself on every start (`~/.local/share/applications/ai-pulse.desktop` + `xdg-mime default ai-pulse.desktop x-scheme-handler/aipulse`). To check and repair:

```bash
xdg-mime query default x-scheme-handler/aipulse   # should print: ai-pulse.desktop
update-desktop-database ~/.local/share/applications
```

Then restart the app.

## Installer blocked by SmartScreen

When running `AI-Pulse-<version>-Windows-x64-Setup.exe`, Windows SmartScreen may warn about an unrecognized publisher. Click **More info → Run anyway**. The installer is per-user and needs no admin rights.

## AppImage won't start (Linux)

The AppImage mounts itself with **FUSE 2**. If it exits immediately or complains about `libfuse.so.2`:

```bash
sudo pacman -S fuse2      # Arch / Omarchy
chmod +x AI-Pulse-<version>-Linux-x86_64.AppImage
./AI-Pulse-<version>-Linux-x86_64.AppImage
```

Most Omarchy installs already have `fuse2`. Prefer the `.pacman` package on Arch for a final release (`sudo pacman -U ./AI-Pulse-<version>-Linux-Arch-Omarchy-x64.pacman`); RCs are AppImage-only.

## Tray icon missing (Linux)

On Linux the tray icon is a **StatusNotifierItem** over D-Bus, shown by whatever bar hosts SNI (on Omarchy, the omarchy-shell bar's `omarchy.tray` widget). If nothing shows up, check that a watcher exists and that AI Pulse registered with it:

```bash
busctl --user get-property org.kde.StatusNotifierWatcher /StatusNotifierWatcher org.kde.StatusNotifierWatcher RegisteredStatusNotifierItems
```

No watcher on the bus means your bar isn't providing a tray; an empty list means the app isn't running (start it from your launcher). Remember that clicking the icon does nothing on Linux — the right-click menu (**Open Settings**) is the way in.

## No notifications (Linux)

AI Pulse sends desktop notifications through `notify-send`/libnotify. Test the notification daemon on its own:

```bash
notify-send -a 'AI Pulse' test
```

If that shows nothing, no daemon is running (on Omarchy it's the omarchy-shell notification daemon). If it works but AI Pulse stays quiet, check the toggles under **Settings → Notifications**.

## Leaderboard not showing

The docked leaderboard is a separate window. If you can't see it:

- Enable **Settings → Desktop leaderboard → Show** (you can also set dock side, always-on-top, and rows there), or
- Use the **tray → Show Leaderboard**.

On **Linux/Hyprland** the compositor owns placement and stacking (**Always on top** is disabled there). The window is floated, pinned to all workspaces, and docked to the right edge by the Hyprland rule that `npm run linux:install` puts in `~/.config/hypr/ai-pulse.lua`. If the widget is visible but not docked, or missing on some workspaces:

```bash
hyprctl clients -j | jq '.[] | select(.class=="ai-pulse")'   # is the window there, floating, pinned?
hyprctl configerrors                                            # did the rule file load?
```

Then re-run `npm run linux:install` from the source checkout and `hyprctl reload`. Both AI Pulse windows have the class `ai-pulse`.

## Collecting logs

When reporting a problem or diagnosing a crash, grab the server log:

- In the app: **Settings → Open logs**
- On disk: `userData/logs/server.log` (the updater writes `updater.log` next to it)

```text
# Windows path
%APPDATA%\AI Pulse\logs\server.log
```

```bash
# Linux path — follow it live
tail -f ~/.config/'AI Pulse'/logs/server.log
```

Logs are rotated at 5 MB, so capture the relevant section soon after the issue occurs.
