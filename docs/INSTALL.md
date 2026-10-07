# Installing AI Pulse

AI Pulse is a local AI model radar for Windows, macOS, and Linux (Omarchy/Hyprland). This guide walks you through downloading the right build, installing it, configuring local AI, and managing the app afterward.

## 1. Download

1. Open the [GitHub Releases page](https://github.com/FernandoSLuz/ai-pulse/releases).
2. Download the asset for your OS from the latest release:

| OS | Asset | Notes |
| --- | --- | --- |
| Windows | `AI-Pulse-Setup-<version>.exe` | NSIS installer, per-user. |
| macOS (Intel) | `AI-Pulse-<version>-x64.dmg` | DMG installer for Intel Macs. |
| macOS (Apple Silicon) | `AI-Pulse-<version>-arm64.dmg` | DMG installer for Apple Silicon Macs. |
| Linux x64 (portable) | `ai-pulse-<version>.AppImage` | Portable; supports in-app updates on systems with FUSE 2. |
| Linux (Debian/Ubuntu) | `ai-pulse-<version>.deb` | Native x64 package. |
| Linux (Fedora/RHEL) | `ai-pulse-<version>.rpm` | Native x64 package. |
| Linux (Arch / Omarchy) | `ai-pulse-<version>.pacman` | Native package. **Final releases only.** |

> **Note:** Release-candidate and prerelease builds (tags like `v1.0.0-rc.1`) are published on the same Releases page, marked as prereleases. Pick a full release unless you specifically want to test an RC. RCs include Windows, macOS, and Linux x64 AppImage/deb/rpm assets but **no `.pacman`**: pacman turns `1.2.0-rc.1` into `1.2.0_rc.1`, which `vercmp` sorts *above* `1.2.0`, so an installed RC package would block the upgrade to the final release.

All builds are **unsigned** — on Windows expect a SmartScreen warning; the Linux packages carry no signature either.

macOS builds are also unsigned and may require **Open Anyway** in System Settings → Privacy & Security after the first launch.

### Supported release lanes

The release pipeline tests Windows x64, macOS Intel (x64), macOS Apple Silicon
(arm64), and Linux x64. Linux arm64 and Windows arm64 builds are not published.
The bundled CPU runtime is selected for the matching x64 or arm64 lane; it does
not require a GPU. Compatibility with every historical OS version is not
claimed. Electron 43 and the native llama.cpp release assets have their own
platform and system-library requirements, so use a current supported OS and
the package format intended for that distribution. If an older system reports
an unsupported binary or missing library, use a newer OS or build a compatible
runtime for that machine.

## 2. Install

### Windows

Double-click the downloaded `AI-Pulse-Setup-<version>.exe`.

- It uses an **NSIS installer** that installs **per-user** — **no administrator rights required**.
- It creates **desktop** and **Start-menu** shortcuts.
- It registers the `aipulse://` protocol so the web dashboard can hand off to the app.

#### If Windows SmartScreen warns you

The installer is unsigned, so SmartScreen may show a "Windows protected your PC" warning. To continue:

1. Click **More info**.
2. Click **Run anyway**.

### macOS

Open the DMG matching your Mac (`x64` for Intel or `arm64` for Apple Silicon),
then drag **AI Pulse** to Applications. macOS releases are updated by downloading
the next matching architecture build. The first launch may be blocked because
the build is unsigned; open **System Settings → Privacy & Security** and choose
**Open Anyway**. AI Pulse uses the standard macOS login-item API and stores its
data under the Electron user data directory.

### Linux — AppImage (Linux x64)

```bash
chmod +x ai-pulse-<version>.AppImage
./ai-pulse-<version>.AppImage
```

- Needs **FUSE 2** to mount itself: `sudo pacman -S fuse2` on Arch/Omarchy (already present on most Omarchy installs).
- Keep the file wherever you like. The **in-app updater** works for AppImage builds (via `latest-linux.yml`).

### Linux — Debian/Ubuntu (`.deb`)

```bash
sudo apt install ./ai-pulse-<version>.deb
```

### Linux — Fedora/RHEL (`.rpm`)

```bash
sudo dnf install ./ai-pulse-<version>.rpm
```

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

Your data and settings live in `~/.config/AI Pulse/` (`config.json`, `data/ai-pulse.db`, `logs/`) — the Linux counterpart of `%APPDATA%\AI Pulse\` on Windows and `~/Library/Application Support/AI Pulse/` on macOS.

## 3. First run — configure local AI

On first launch, AI Pulse opens the **Settings** window and detects available RAM.
Choose the recommended **Light** or **Balanced** profile. Light downloads
**Qwen3.5 0.8B Q4** (about 537 MiB); Balanced downloads **Qwen3 1.7B Q8_0**
(about 1.7 GiB). The app also downloads the pinned llama.cpp CPU runtime,
verifies every catalogue hash, and shows progress; you can cancel and resume
later. If no model is ready, deterministic rules keep rankings and briefings
usable. No cloud model is contacted.

The three public benchmark sources (Artificial Analysis, LiveBench, and SWE-bench
Verified), news, and videos work immediately with an internet connection and no
tokens. Benchmark sources can be changed in the dashboard's **Source** selector.

No AI provider key is required. In **Connections**, optionally configure:

- `AA_API_KEY` for benchmark enrichment (public rankings work without it);
- `TAVILY_API_KEY` for web search only.

In **Videos → Add channel**, enter a YouTube username, `@username`, channel URL,
or channel ID, then choose **Creators** or **Companies**. AI Pulse validates the
public RSS feed and stores the selection locally; no YouTube API key is needed.
The feed must include an item from the last 90 days. A channel cannot currently
be assigned to both kinds.

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
| Hyprland window rule | `~/.config/hypr/ai-pulse.lua` + a `require("hypr.ai-pulse")` line in `~/.config/hypr/hyprland.lua` | Only used in *Floating window* mode: floats the leaderboard, pins it to all workspaces, and docks it to the right edge below the bar; with "keep tiled windows beside the widget" on, the app also writes per-workspace gaps for that monitor into `~/.config/hypr/ai-pulse-dock.lua`. Hyprland has no always-on-top, so the **Always on top** toggle is disabled on Linux. |
| Theme hook | `~/.config/omarchy/hooks/theme-set.d/ai-pulse-theme-set` | Tells the server to reload colors when you switch themes (the server also watches the theme directory itself). |
| Bar widget + panel | `~/.config/omarchy/plugins/fernando.ai-pulse` (enabled after `omarchy.tray`) | Shows the current leader in the bar; turns urgent when the server is down or curation is degraded. Left click opens the **leaderboard panel** (headline, your stack, top models; `j`/`k`, Enter, `R`, `D`, `S`, Esc), right click = Settings, middle click = refresh. This is the default leaderboard on Omarchy; the floating window is optional (Settings → Desktop leaderboard → Mode). |

Packaged builds ship the same integration under `resources/linux` and `resources/omarchy-plugin`: use the tray's **Install Omarchy integration…** entry or run `ai-pulse --install-omarchy-integration` (`--uninstall` reverts).

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

Your data and keys (`~/.config/AI Pulse/` on Linux, `%APPDATA%\AI Pulse\` on Windows, or `~/Library/Application Support/AI Pulse/` on macOS) are never deleted by an uninstall — remove that directory yourself if you want a clean slate.
