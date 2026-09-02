# Installing AI Pulse

AI Pulse is a local AI model radar for Windows and Linux (Omarchy/Hyprland). This guide walks you through downloading the right build, installing it, adding your first provider key, and managing the app afterward.

## 1. Download

1. Open the [GitHub Releases page](https://github.com/FernandoSLuz/ai-pulse/releases).
2. Download the asset for your OS from the latest release:

| OS | Asset | Notes |
| --- | --- | --- |
| Windows | `AI Pulse-Setup-<version>.exe` | NSIS installer, per-user. |
| Linux (any distro) | `ai-pulse-<version>.AppImage` | Portable; supports in-app updates. |
| Linux (Arch / Omarchy) | `ai-pulse-<version>.pacman` | Native package. **Final releases only.** |

> **Note:** Release-candidate and prerelease builds (tags like `v1.0.0-rc.1`) are published on the same Releases page, marked as prereleases. Pick a full release unless you specifically want to test an RC. RCs ship the `.exe` and the `.AppImage` but **no `.pacman`**: pacman turns `1.2.0-rc.1` into `1.2.0_rc.1`, which `vercmp` sorts *above* `1.2.0`, so an installed RC package would block the upgrade to the final release.

All builds are **unsigned** — on Windows expect a SmartScreen warning; the Linux packages carry no signature either.

## 2. Install

### Windows

Double-click the downloaded `AI Pulse-Setup-<version>.exe`.

- It uses an **NSIS installer** that installs **per-user** — **no administrator rights required**.
- It creates **desktop** and **Start-menu** shortcuts.
- It registers the `aipulse://` protocol so the web dashboard can hand off to the app.

#### If Windows SmartScreen warns you

The installer is unsigned, so SmartScreen may show a "Windows protected your PC" warning. To continue:

1. Click **More info**.
2. Click **Run anyway**.

### Linux — AppImage (any distro)

```bash
chmod +x ai-pulse-<version>.AppImage
./ai-pulse-<version>.AppImage
```

- Needs **FUSE 2** to mount itself: `sudo pacman -S fuse2` on Arch/Omarchy (already present on most Omarchy installs).
- Keep the file wherever you like. The **in-app updater** works for AppImage builds (via `latest-linux.yml`).

### Linux — pacman package (Arch / Omarchy)

```bash
sudo pacman -U ./ai-pulse-<version>.pacman
```

- Installs to `/opt/AI Pulse/ai-pulse` with a system-wide `.desktop` entry and icon, so it shows up in your app launcher.
- The in-app updater reports **unsupported** for this install method — upgrade with `sudo pacman -U` on the next final release's `.pacman` asset.

### What the app sets up on Linux

On every start the app (either packaging) writes a few files into your home so the desktop can find it:

| File | Purpose |
| --- | --- |
| `~/.local/share/applications/ai-pulse.desktop` | Launcher entry and the `aipulse://` handler (registered with `xdg-mime default ai-pulse.desktop x-scheme-handler/aipulse`). |
| `~/.local/share/icons/hicolor/256x256/apps/ai-pulse.png` | App icon. |
| `~/.config/autostart/ai-pulse.desktop` | Only while **Start on login** is on (XDG autostart; Omarchy's uwsm session runs it via `xdg-desktop-autostart.target`). Turning the toggle off deletes it. |

Your data and settings live in `~/.config/AI Pulse/` (`config.json`, `data/ai-pulse.db`, `logs/`) — the Linux counterpart of `%APPDATA%\AI Pulse\` on Windows.

## 3. First run — add a provider key

On first launch, AI Pulse opens the **Settings** window. Under the **Connections** section, add **at least one** AI provider key so curation works.

We recommend starting with **Gemini** (generous free tier). Adding more providers makes AI curation more resilient.

| Provider | Where to get a key |
| --- | --- |
| Gemini (recommended) | https://aistudio.google.com/apikey |
| Cerebras | https://cloud.cerebras.ai |
| Groq | https://console.groq.com/keys |
| OpenRouter | https://openrouter.ai/keys |

> You only need one key to get started. Keys are stored with the app and injected into the background service for you — there is no `.env` file to edit.

## 4. Running in the tray & auto-start

After first-run setup, AI Pulse runs quietly in the **system tray** and **auto-starts on login** (it starts hidden in the tray).

- **Windows:** the icon sits in the notification area. Click or double-click it to open the app; right-click for the menu.
- **Linux:** the icon is a **StatusNotifierItem** shown by your bar's tray (on Omarchy, the omarchy-shell bar's `omarchy.tray` widget). Electron speaks SNI over D-Bus directly — nothing extra to install. Left/double-click do nothing on Linux; **right-click → Open Settings** is the way in.

You can toggle auto-start in these places:

- **Settings → Startup & service → Start on login** (both OSes)
- **Windows:** **Task Manager → Startup** (the app registers a standard Windows login item you can disable there)
- **Linux:** the toggle writes/deletes `~/.config/autostart/ai-pulse.desktop` (XDG autostart); deleting that file by hand has the same effect.

## 5. Opening AI Pulse later

Reopen the app any time via:

- The **desktop shortcut** or **Start menu** entry (Windows)
- Your **app launcher** — the `AI Pulse` entry from `ai-pulse.desktop` (Linux)
- The **tray icon** (if it's already running in the background; on Linux use its right-click menu)
- The dashboard's settings gear, which opens the app through the `aipulse://` link

## 6. Omarchy integration (optional)

On **Omarchy** (Arch + Hyprland + omarchy-shell) the app runs fine as-is, but a source checkout can wire it into the desktop properly:

```bash
git clone https://github.com/FernandoSLuz/ai-pulse && cd ai-pulse
npm ci && npx install-electron
npm run linux:install
```

That installs (backing up anything it touches):

| What | Where | Effect |
| --- | --- | --- |
| Hyprland window rule | `~/.config/hypr/ai-pulse.lua` + a `require("hypr.ai-pulse")` line in `~/.config/hypr/hyprland.lua` | Floats the leaderboard, pins it to all workspaces, and docks it to the right edge below the bar; the app then reserves that strip on the monitor so tiled windows sit beside the widget, never under it. Hyprland has no always-on-top, so the **Always on top** toggle is disabled on Linux. |
| Theme hook | `~/.config/omarchy/hooks/theme-set.d/ai-pulse-theme-set` | Tells the server to reload colors when you switch themes (the server also watches the theme directory itself). |
| Bar widget | `~/.config/omarchy/plugins/fernando.ai-pulse` (enabled after `omarchy.tray`) | Shows the current leaderboard leader in the bar; turns urgent when the server is down or curation is degraded. Left click = dashboard, right click = Settings, middle click = refresh. |

Two Omarchy tweaks are deliberately **not** installed by the script because they change desktop-wide behaviour: showing notification popups on a single monitor (clone the daemon with `omarchy plugin clone omarchy.notifications` and filter `Quickshell.screens` by output name in the clone's `Service.qml`), and setting your browser's home page to `http://localhost:3847/`.

Once installed, the dashboard and the leaderboard follow your active Omarchy theme automatically. `npm run linux:uninstall -w @ai-pulse/widget` reverts all of it. Details in [CONFIGURATION.md](./CONFIGURATION.md#omarchy-theme) and [OPERATIONS.md](./OPERATIONS.md#omarchy-theme-and-bar-widget).

## 7. Uninstalling

### Windows

- Go to **Windows Settings → Apps → Installed apps** (or **Apps & features**), find **AI Pulse**, and choose **Uninstall**.
- Or run the bundled **uninstaller** from the AI Pulse Start-menu folder.

### Linux

1. Quit the app (tray → **Quit AI Pulse**).
2. Remove the package:
   - pacman: `sudo pacman -Rns ai-pulse`
   - AppImage: delete the `.AppImage` file.
3. Remove the per-user files the app wrote (neither `pacman -Rns` nor deleting the AppImage touches them):

   ```bash
   rm -f ~/.local/share/applications/ai-pulse.desktop \
         ~/.local/share/icons/hicolor/256x256/apps/ai-pulse.png \
         ~/.config/autostart/ai-pulse.desktop
   ```

4. If you ran `npm run linux:install`, revert it with `npm run linux:uninstall -w @ai-pulse/widget` from the same checkout.

Your data and keys (`~/.config/AI Pulse/` on Linux, `%APPDATA%\AI Pulse\` on Windows) are never deleted by an uninstall — remove that directory yourself if you want a clean slate.
