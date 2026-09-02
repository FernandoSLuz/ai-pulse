import { app, BrowserWindow, Tray, Menu, screen, nativeImage, shell, ipcMain } from "electron";
import path from "node:path";
import { ServerSupervisor, type ServerStatus } from "./src/supervisor";
import {
  loadConfig,
  saveConfig,
  redactedKeys,
  LLM_KEY_NAMES,
  type AppConfig,
  type LlmKeyName,
} from "./src/config";
import { serverLogPath, settingsHtml, settingsPreload, leaderboardPreload } from "./src/paths";
import { Updater } from "./src/updater";
import {
  isLinux,
  DESKTOP_FILE,
  PROTOCOL,
  applyAutoLaunch,
  installDesktopIntegration,
  hyprlandDock,
  hyprlandReserve,
  hyprlandRelease,
} from "./src/platform";

// Set the app name before anything reads app.getPath("userData"), so config,
// data, and logs live under %APPDATA%\AI Pulse / ~/.config/AI Pulse (not the
// scoped package name).
app.setName("AI Pulse");
// Linux window identity: the Wayland app_id (and X11 WM_CLASS) come from the
// desktop name, read when the first BrowserWindow is constructed. "ai-pulse"
// is what the Hyprland rules, StartupWMClass and the .desktop file all match.
if (isLinux) app.setDesktopName(DESKTOP_FILE);

const WIDGET_WIDTH = 760;
const TOP_MARGIN = 12;
const LEADERBOARD_TITLE = "AI Pulse Widget";
// Wayland exposes no work area (Omarchy's bar is invisible to xdg clients), so
// reserve the bar height ourselves; the Hyprland rule places the window at y=38.
const LINUX_TOP_INSET = 38;
const WIDGET_ROW_HEIGHT = 21;
const WIDGET_CHROME = 260;
const WIDGET_HEAD = 26;

let settingsWindow: BrowserWindow | null = null;
let leaderboardWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

const supervisor = new ServerSupervisor();
const updater = new Updater();
let config: AppConfig = loadConfig();

const dashboardUrl = () => `http://localhost:${config.port}`;
const leaderboardUrl = () => `http://localhost:${config.port}/widget`;
const launchedHidden = process.argv.includes("--hidden");

// --- Leaderboard (docked always-on-top widget) ------------------------------

function workArea() {
  const display = screen.getPrimaryDisplay();
  // On Hyprland workArea === bounds; subtract the bar inset ourselves.
  if (!isLinux) return display.workArea;
  const b = display.bounds;
  return { x: b.x, y: b.y + LINUX_TOP_INSET, width: b.width, height: b.height - LINUX_TOP_INSET };
}

function maxWidgetHeight(): number {
  const area = workArea();
  const rows = config.leaderboard.rows;
  const cap = WIDGET_CHROME + WIDGET_HEAD + rows * WIDGET_ROW_HEIGHT;
  return Math.min(cap, area.height - TOP_MARGIN * 2);
}

function applyLeaderboardBounds(height: number): void {
  if (!leaderboardWindow) return;
  const area = workArea();
  const h = Math.min(Math.max(height, 200), maxWidgetHeight());
  if (isLinux) {
    // Wayland forbids client-side positioning: the Hyprland rule docks the
    // window on map, we follow the content height and then ask Hyprland to
    // re-dock (it keeps the window center on client resizes).
    leaderboardWindow.setSize(WIDGET_WIDTH, h);
    scheduleHyprlandDock();
    return;
  }
  const x = config.leaderboard.dockSide === "right" ? area.x + area.width - WIDGET_WIDTH : area.x;
  leaderboardWindow.setBounds({ x, y: area.y + TOP_MARGIN, width: WIDGET_WIDTH, height: h });
}

let dockTimer: NodeJS.Timeout | null = null;

function scheduleHyprlandDock(): void {
  if (dockTimer) clearTimeout(dockTimer);
  dockTimer = setTimeout(() => {
    dockTimer = null;
    // Position first, then reserve the strip so tiled windows tile beside the
    // widget instead of underneath it (a real side dock).
    void hyprlandDock(LEADERBOARD_TITLE, WIDGET_WIDTH, config.leaderboard.dockSide, TOP_MARGIN).then(() =>
      hyprlandReserve(LEADERBOARD_TITLE, WIDGET_WIDTH, config.leaderboard.dockSide),
    );
  }, 150);
}

function createLeaderboardWindow(): void {
  if (leaderboardWindow) {
    leaderboardWindow.show();
    return;
  }
  const area = workArea();
  leaderboardWindow = new BrowserWindow({
    width: WIDGET_WIDTH,
    height: 400,
    x: config.leaderboard.dockSide === "right" ? area.x + area.width - WIDGET_WIDTH : area.x,
    y: area.y + TOP_MARGIN,
    // Stable title: the Hyprland rule matches it (static rules evaluate at map time).
    title: LEADERBOARD_TITLE,
    frame: false,
    transparent: true,
    // Always-on-top is a Wayland no-op; Hyprland float+pin rules take over on Linux.
    alwaysOnTop: !isLinux && config.leaderboard.pinOnTop,
    skipTaskbar: true,
    resizable: false,
    movable: true,
    // Electron >= 41 draws GTK client-side shadows/resize borders and (>= 43)
    // rounded corners on frameless Wayland windows — keep the widget flat and
    // let Hyprland's `rounding` rule own the shape.
    hasShadow: !isLinux,
    roundedCorners: !isLinux,
    backgroundColor: "#00000000",
    show: false,
    webPreferences: {
      preload: leaderboardPreload(),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  leaderboardWindow.on("page-title-updated", (e) => e.preventDefault());
  // Rows and strips open links with window.open / target=_blank: hand every
  // web URL to the desktop browser instead of spawning Electron windows.
  leaderboardWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  leaderboardWindow.loadURL(leaderboardUrl());
  leaderboardWindow.once("ready-to-show", () => {
    leaderboardWindow?.show();
    if (isLinux) scheduleHyprlandDock();
  });
  leaderboardWindow.on("closed", () => {
    leaderboardWindow = null;
    if (isLinux) void hyprlandRelease(WIDGET_WIDTH);
  });
}

function showLeaderboard(show: boolean): void {
  config.leaderboard.show = show;
  saveConfig(config);
  if (show) {
    createLeaderboardWindow();
  } else {
    leaderboardWindow?.close();
    leaderboardWindow = null;
  }
  refreshTrayMenu();
}

// --- Settings / control window (the "app view") -----------------------------

function createSettingsWindow(): void {
  if (settingsWindow) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 860,
    height: 720,
    minWidth: 640,
    minHeight: 520,
    title: "AI Pulse",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: settingsPreload(),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  settingsWindow.loadFile(settingsHtml());
  settingsWindow.once("ready-to-show", () => settingsWindow?.show());
  settingsWindow.on("close", (e) => {
    if (!isQuitting) {
      e.preventDefault(); // keep running in tray
      settingsWindow?.hide();
    }
  });
  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });
}

// --- Tray -------------------------------------------------------------------

function createTrayIcon(): Electron.NativeImage {
  const iconPath = path.join(__dirname, "assets", "tray-icon.png");
  const fromFile = nativeImage.createFromPath(iconPath);
  // Linux: the StatusNotifierItem host scales the pixmap for its slot and DPI
  // (Omarchy runs 4K displays at 1.5x), so ship the full 128px RGBA glyph.
  if (!fromFile.isEmpty()) return isLinux ? fromFile : fromFile.resize({ width: 16, height: 16 });

  const size = 16;
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - 7.5;
      const dy = y - 7.5;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const i = (y * size + x) * 4;
      if (dist <= 6) {
        buf[i] = 91;
        buf[i + 1] = 159;
        buf[i + 2] = 212;
        buf[i + 3] = dist <= 5 ? 255 : 120;
      }
    }
  }
  return nativeImage.createFromBuffer(buf, { width: size, height: size });
}

function buildTrayMenu(): Menu {
  const status = supervisor.getStatus();
  const serviceLabel = status.userStopped
    ? "Service: stopped"
    : status.failed
      ? "Service: failed — click Start"
      : status.healthy
        ? status.adopted
          ? "Service: running ✓ (adopted)"
          : "Service: running ✓"
        : status.running
          ? "Service: starting…"
          : "Service: restarting…";

  return Menu.buildFromTemplate([
    { label: "AI Pulse", enabled: false },
    { type: "separator" },
    { label: "Open Settings", click: () => createSettingsWindow() },
    {
      label: config.leaderboard.show ? "Hide Leaderboard" : "Show Leaderboard",
      click: () => showLeaderboard(!config.leaderboard.show),
    },
    { label: "Open Dashboard in Browser", click: () => void shell.openExternal(dashboardUrl()) },
    {
      label:
        updater.state.status === "available"
          ? `Update available: v${updater.state.availableVersion}`
          : updater.state.status === "downloaded"
            ? "Restart to install update"
            : "Check for updates",
      click: () => {
        if (updater.state.status === "downloaded") updater.install();
        else updater.check();
        createSettingsWindow();
      },
    },
    { type: "separator" },
    { label: serviceLabel, enabled: false },
    { label: "Restart Background Service", click: () => supervisor.restart() },
    status.userStopped
      ? { label: "Start Background Service", click: () => supervisor.start() }
      : { label: "Stop Background Service", click: () => supervisor.stop() },
    { type: "separator" },
    {
      label: "Start on login",
      type: "checkbox",
      checked: config.autoLaunch,
      click: (item) => setAutoLaunch(item.checked),
    },
    { type: "separator" },
    { label: "Quit AI Pulse", click: () => void quitAll() },
  ]);
}

function refreshTrayMenu(): void {
  tray?.setContextMenu(buildTrayMenu());
}

function createTray(): void {
  tray = new Tray(createTrayIcon());
  tray.setToolTip("AI Pulse");
  // Tray click events never fire on Linux; the context menu carries "Open Settings".
  if (!isLinux) tray.on("double-click", () => createSettingsWindow());
  refreshTrayMenu();
}

// --- Auto-launch ------------------------------------------------------------

function setAutoLaunch(enabled: boolean): void {
  config.autoLaunch = enabled;
  saveConfig(config);
  applyAutoLaunch(config);
  refreshTrayMenu();
  pushSettingsState();
}

// --- Quit-all ---------------------------------------------------------------

let shutdownStarted = false;

async function quitAll(): Promise<void> {
  if (shutdownStarted) return;
  shutdownStarted = true;
  isQuitting = true;
  refreshTrayMenu();
  try {
    await supervisor.shutdown();
  } catch {
    /* best effort */
  }
  if (isLinux) await hyprlandRelease(WIDGET_WIDTH).catch(() => undefined);
  leaderboardWindow?.destroy();
  settingsWindow?.destroy();
  tray?.destroy();
  app.quit();
}

// --- IPC (settings window <-> main) -----------------------------------------

function settingsState() {
  return {
    config: {
      port: config.port,
      autoLaunch: config.autoLaunch,
      startHidden: config.startHidden,
      leaderboard: config.leaderboard,
      keys: redactedKeys(config), // booleans only — never expose raw secrets
    },
    keyNames: LLM_KEY_NAMES,
    service: supervisor.getStatus(),
    update: updater.state,
    platform: process.platform,
    logPath: serverLogPath(),
    alwaysOnTopSupported: !isLinux,
    autostartPath: isLinux ? autostartHint() : null,
  };
}

function autostartHint(): string {
  const base = process.env.XDG_CONFIG_HOME || path.join(app.getPath("home"), ".config");
  return path.join(base, "autostart", DESKTOP_FILE);
}

function pushSettingsState(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send("settings:state", settingsState());
  }
}

function registerIpc(): void {
  ipcMain.handle("settings:getState", () => settingsState());

  ipcMain.handle("settings:setKey", (_e, name: string, value: string) => {
    if (!LLM_KEY_NAMES.includes(name as LlmKeyName)) return settingsState();
    const trimmed = (value ?? "").trim();
    if (trimmed) config.keys[name as LlmKeyName] = trimmed;
    else delete config.keys[name as LlmKeyName];
    saveConfig(config);
    supervisor.restart(); // apply new key
    return settingsState();
  });

  ipcMain.handle("settings:setPrefs", (_e, prefs: Partial<AppConfig>) => {
    const prevPort = config.port;
    if (typeof prefs.port === "number" && prefs.port >= 1 && prefs.port <= 65535) config.port = prefs.port;
    const portChanged = config.port !== prevPort; // only flag an actually-applied change
    const hiddenChanged = typeof prefs.startHidden === "boolean" && prefs.startHidden !== config.startHidden;
    if (typeof prefs.startHidden === "boolean") config.startHidden = prefs.startHidden;
    if (prefs.leaderboard) {
      config.leaderboard = { ...config.leaderboard, ...prefs.leaderboard };
    }
    saveConfig(config);
    if (leaderboardWindow) applyLeaderboardBounds(leaderboardWindow.getBounds().height);
    if (!isLinux) leaderboardWindow?.setAlwaysOnTop(config.leaderboard.pinOnTop, "floating");
    if (typeof prefs.autoLaunch === "boolean") setAutoLaunch(prefs.autoLaunch);
    else if (hiddenChanged) applyAutoLaunch(config); // keep the --hidden arg in sync
    if (portChanged) {
      supervisor.restart();
      // The leaderboard is loaded against the old port; drop it so the
      // healthy-status handler recreates it on the new port.
      leaderboardWindow?.close();
      leaderboardWindow = null;
    }
    refreshTrayMenu();
    return settingsState();
  });

  ipcMain.handle("service:status", () => supervisor.getStatus());
  ipcMain.handle("service:start", () => (supervisor.start(), supervisor.getStatus()));
  ipcMain.handle("service:stop", () => (supervisor.stop(), supervisor.getStatus()));
  ipcMain.handle("service:restart", () => (supervisor.restart(), supervisor.getStatus()));

  ipcMain.handle("leaderboard:toggle", (_e, show: boolean) => {
    showLeaderboard(show);
    return settingsState();
  });

  ipcMain.handle("update:check", () => (updater.check(), updater.state));
  ipcMain.handle("update:download", () => (updater.download(), updater.state));
  ipcMain.handle("update:install", () => updater.install());
  ipcMain.handle("update:status", () => updater.state);

  ipcMain.handle("app:openDashboard", () => void shell.openExternal(dashboardUrl()));
  ipcMain.handle("app:openLogs", async () => {
    // .log may have no handler on Linux — fall back to revealing it in the file manager.
    const err = await shell.openPath(serverLogPath());
    if (err) shell.showItemInFolder(serverLogPath());
  });
  ipcMain.handle("app:openExternal", (_e, url: string) => {
    // Only ever open normal web links (e.g. provider key pages).
    if (typeof url === "string" && /^https?:\/\//i.test(url)) void shell.openExternal(url);
  });

  // Proxy the server health JSON so the renderer avoids cross-origin fetches.
  ipcMain.handle("server:health", async () => {
    try {
      const res = await fetch(`http://127.0.0.1:${config.port}/api/health`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return { ok: false };
      return await res.json();
    } catch {
      return { ok: false };
    }
  });

  // Guarded proxy to the local server API so the settings renderer can read/write
  // preferences (stack, notifications, models) without cross-origin fetches.
  const apiUrl = (p: string) => `http://127.0.0.1:${config.port}${p}`;
  const allowed = (p: string) => typeof p === "string" && p.startsWith("/api/");

  ipcMain.handle("api:get", async (_e, p: string) => {
    if (!allowed(p)) return { error: "forbidden" };
    try {
      const res = await fetch(apiUrl(p), { signal: AbortSignal.timeout(8000) });
      return await res.json();
    } catch (err) {
      return { error: (err as Error).message };
    }
  });

  ipcMain.handle("api:put", async (_e, p: string, body: unknown) => {
    if (!allowed(p)) return { error: "forbidden" };
    try {
      const res = await fetch(apiUrl(p), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
        signal: AbortSignal.timeout(8000),
      });
      return await res.json();
    } catch (err) {
      return { error: (err as Error).message };
    }
  });

  // Leaderboard renderer (unchanged contract).
  ipcMain.on("widget-resize", (_e, contentHeight: number) => applyLeaderboardBounds(contentHeight));
  ipcMain.handle("widget-max-height", () => maxWidgetHeight());
}

// --- Lifecycle --------------------------------------------------------------

/** Open the settings window when launched via an aipulse:// deep link. */
function handleProtocolArgv(argv: string[]): void {
  const link = argv.find((a) => a.startsWith("aipulse://"));
  if (link) createSettingsWindow();
}

function registerProtocol(): void {
  if (isLinux) {
    // Electron's own registration needs CHROME_DESKTOP (set by setDesktopName)
    // AND an installed .desktop entry, and AppImages/source checkouts install
    // none — so write ours and register the scheme with xdg-mime first.
    void installDesktopIntegration().then(() => {
      const ok = app.setAsDefaultProtocolClient(PROTOCOL);
      console.log(`[Protocol] ${PROTOCOL}:// handler: xdg-mime registered; Electron ${ok ? "confirmed" : "deferred"}`);
    });
    return;
  }
  if (app.isPackaged) {
    app.setAsDefaultProtocolClient(PROTOCOL);
  } else if (process.platform === "win32" && process.argv.length >= 2) {
    // Dev: register with the explicit electron + script path so the browser
    // dashboard's aipulse:// link can reach this instance.
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", (_e, argv) => {
    handleProtocolArgv(argv);
    createSettingsWindow();
  });

  // macOS deep-link delivery (Windows/Linux arrive via argv/second-instance).
  app.on("open-url", (_e, url) => {
    if (url.startsWith("aipulse://")) createSettingsWindow();
  });

  app.whenReady().then(() => {
    if (process.platform === "win32") app.setAppUserModelId("com.aipulse.desktop");
    registerProtocol();
    registerIpc();

    supervisor.on("status", (status: ServerStatus) => {
      refreshTrayMenu();
      pushSettingsState();
      if (status.healthy && config.leaderboard.show && !leaderboardWindow) {
        createLeaderboardWindow();
      }
    });

    updater.on("state", () => {
      refreshTrayMenu();
      pushSettingsState();
    });
    updater.init();

    createTray();
    // A crashed previous instance may have left its dock reservation behind.
    if (isLinux) void hyprlandRelease(WIDGET_WIDTH);
    supervisor.start();

    // Apply auto-launch registration to match saved config on every start
    // (on Linux this also refreshes the autostart entry's launcher path).
    applyAutoLaunch(config);

    if (!launchedHidden) createSettingsWindow();
    handleProtocolArgv(process.argv); // cold-start deep link
  });

  app.on("window-all-closed", () => {
    // Intentionally do nothing — the app lives in the tray until "Quit AI Pulse".
  });

  // Every quit path (tray "Quit", app.quit(), and Chromium's own SIGTERM/SIGINT
  // handling — which never reaches Node's process.on handlers) funnels through
  // quitAll so the supervised server and the Hyprland reservation go with us.
  app.on("before-quit", (e) => {
    isQuitting = true;
    if (shutdownStarted) return; // quitAll() finished and is calling app.quit()
    e.preventDefault();
    void quitAll();
  });
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => void quitAll());
  }
}
