import { app, BrowserWindow, Tray, Menu, screen, nativeImage, shell, ipcMain } from "electron";
import path from "node:path";

const PORT = process.env.PORT || 3847;
const WIDGET_URL = `http://localhost:${PORT}/widget`;
const WIDGET_WIDTH = 760;
const TOP_MARGIN = 12;
const WIDGET_ROWS = 25;
const WIDGET_ROW_HEIGHT = 21;
const WIDGET_CHROME = 260; // headline + stack strip + search + count + padding
const WIDGET_HEAD = 26;
const MAX_WIDGET_HEIGHT =
  WIDGET_CHROME + WIDGET_HEAD + WIDGET_ROWS * WIDGET_ROW_HEIGHT;

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let dockSide: "right" | "left" = "right";
let pinOnTop = false;

function workArea() {
  return screen.getPrimaryDisplay().workArea;
}

function maxWidgetHeight(): number {
  const area = workArea();
  return Math.min(MAX_WIDGET_HEIGHT, area.height - TOP_MARGIN * 2);
}

function applyBounds(height: number): void {
  if (!mainWindow) return;
  const area = workArea();
  const h = Math.min(Math.max(height, 200), maxWidgetHeight());
  const x =
    dockSide === "right"
      ? area.x + area.width - WIDGET_WIDTH
      : area.x;
  mainWindow.setBounds({
    x,
    y: area.y + TOP_MARGIN,
    width: WIDGET_WIDTH,
    height: h,
  });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: WIDGET_WIDTH,
    height: 400,
    x: workArea().x + workArea().width - WIDGET_WIDTH,
    y: workArea().y + TOP_MARGIN,
    frame: false,
    transparent: true,
    alwaysOnTop: pinOnTop,
    skipTaskbar: true,
    resizable: false,
    movable: true,
    hasShadow: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(WIDGET_URL);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function createTrayIcon(): Electron.NativeImage {
  const candidates = [
    path.join(__dirname, "assets", "tray-icon.png"),
    path.join(__dirname, "..", "assets", "tray-icon.png"),
  ];
  for (const iconPath of candidates) {
    const fromFile = nativeImage.createFromPath(iconPath);
    if (!fromFile.isEmpty()) return fromFile.resize({ width: 16, height: 16 });
  }

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
  return Menu.buildFromTemplate([
    {
      label: "Dock Right",
      click: () => {
        dockSide = "right";
        mainWindow?.webContents.send("widget-reposition");
      },
    },
    {
      label: "Dock Left",
      click: () => {
        dockSide = "left";
        mainWindow?.webContents.send("widget-reposition");
      },
    },
    {
      label: pinOnTop ? "Unpin (allow overlay off)" : "Pin always on top",
      click: () => {
        pinOnTop = !pinOnTop;
        mainWindow?.setAlwaysOnTop(pinOnTop, "floating");
        tray?.setContextMenu(buildTrayMenu());
      },
    },
    { type: "separator" },
    {
      label: "Open Dashboard",
      click: () => shell.openExternal(`http://localhost:${PORT}`),
    },
    {
      label: "Reload Widget",
      click: () => mainWindow?.reload(),
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => app.quit(),
    },
  ]);
}

function createTray(): void {
  tray = new Tray(createTrayIcon());
  tray.setToolTip("AI Pulse Widget");
  tray.setContextMenu(buildTrayMenu());
}

ipcMain.on("widget-resize", (_event, contentHeight: number) => {
  applyBounds(contentHeight);
});

ipcMain.handle("widget-max-height", () => maxWidgetHeight());

app.whenReady().then(() => {
  createWindow();
  createTray();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
