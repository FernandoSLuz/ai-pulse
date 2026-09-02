// Regenerates every raster icon the app ships from the master artwork at
// packages/widget/build/icon-master-1024.png (opaque navy background):
//
//   build/icon.png                              512x512 RGBA  electron-builder icon (Windows/Linux)
//   assets/tray-icon.png                        128x128 RGBA  tray glyph, transparent background
//   assets/app-icon-256.png                     256x256 RGBA  hicolor icon (~/.local/share/icons) + update notifications
//   ../server/assets/notification-icon-128.png  128x128 RGBA  notify-send --icon (absolute path)
//
// Needs ImageMagick 7 (`magick`) on PATH — present on Omarchy; on Windows
// install it from imagemagick.org. Run with: npm run icons -w @ai-pulse/widget
import { execFileSync } from "node:child_process";
import { existsSync, copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const widgetDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverAssets = path.resolve(widgetDir, "..", "server", "assets");
const icon = path.join(widgetDir, "build", "icon.png");
const master = path.join(widgetDir, "build", "icon-master-1024.png");

// First run: preserve the opaque 1024² original before build/icon.png is downsized.
if (!existsSync(master)) copyFileSync(icon, master);

const magick = (args) => execFileSync("magick", args, { stdio: "inherit" });
const BG = "#0b1628"; // sampled navy background of the master artwork

// Opaque, square, with an alpha channel (desktop/launcher icon).
magick([master, "-alpha", "set", "-resize", "512x512", icon]);

// Glyph-only variants: knock out the navy background so the rings float on any bar/theme.
const glyph = (size, out) =>
  magick([master, "-alpha", "set", "-fuzz", "12%", "-transparent", BG, "-trim", "+repage",
    "-resize", `${size}x${size}`, "-gravity", "center", "-background", "none", "-extent", `${size}x${size}`, out]);

mkdirSync(path.join(widgetDir, "assets"), { recursive: true });
glyph(128, path.join(widgetDir, "assets", "tray-icon.png"));
glyph(256, path.join(widgetDir, "assets", "app-icon-256.png"));
mkdirSync(serverAssets, { recursive: true });
glyph(128, path.join(serverAssets, "notification-icon-128.png"));

console.log("[icons] regenerated build/icon.png, assets/tray-icon.png, assets/app-icon-256.png, server/assets/notification-icon-128.png");
