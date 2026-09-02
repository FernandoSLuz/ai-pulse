#!/usr/bin/env node
// Installs the Omarchy / Hyprland integration for a source checkout or an
// AppImage into the user's ~/.config (never into /usr/share/omarchy):
//
//   ~/.config/hypr/ai-pulse.lua                     window rules (+ require line in hyprland.lua)
//   ~/.config/omarchy/hooks/theme-set.d/ai-pulse-theme-set   theme hook (POST /api/theme/reload)
//   ~/.config/omarchy/plugins/fernando.ai-pulse/    bar widget plugin (enabled after omarchy.tray)
//
// Every file it touches is backed up first (*.bak-<timestamp>). Re-running is
// safe. Undo with: node scripts/linux-install.mjs --uninstall
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const widgetDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(widgetDir, "..", "..");
const home = os.homedir();
const cfg = process.env.XDG_CONFIG_HOME || path.join(home, ".config");
const uninstall = process.argv.includes("--uninstall");

const HYPR_RULES_SRC = path.join(widgetDir, "linux", "hypr", "ai-pulse.lua");
const HYPR_RULES_DST = path.join(cfg, "hypr", "ai-pulse.lua");
const HYPRLAND_LUA = path.join(cfg, "hypr", "hyprland.lua");
const REQUIRE_LINE = 'require("hypr.ai-pulse")';
const HOOK_SRC = path.join(widgetDir, "linux", "hooks", "ai-pulse-theme-set");
const HOOK_DST = path.join(cfg, "omarchy", "hooks", "theme-set.d", "ai-pulse-theme-set");
const PLUGIN_ID = "fernando.ai-pulse";
const PLUGIN_SRC = path.join(repoRoot, "packages", "omarchy-plugin", PLUGIN_ID);
const PLUGIN_DST = path.join(cfg, "omarchy", "plugins", PLUGIN_ID);

const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
const log = (msg) => console.log(`[linux-install] ${msg}`);

function backup(file) {
  if (!fs.existsSync(file)) return;
  const bak = `${file}.bak-${stamp}`;
  fs.copyFileSync(file, bak);
  log(`backup: ${bak}`);
}

function have(cmd) {
  return spawnSync("sh", ["-c", `command -v ${cmd}`], { stdio: "ignore" }).status === 0;
}

function run(cmd, args, { optional = false } = {}) {
  const res = spawnSync(cmd, args, { stdio: "inherit" });
  if (res.status !== 0 && !optional) throw new Error(`${cmd} ${args.join(" ")} exited ${res.status}`);
  return res.status === 0;
}

function installHyprRules() {
  fs.mkdirSync(path.dirname(HYPR_RULES_DST), { recursive: true });
  backup(HYPR_RULES_DST);
  fs.copyFileSync(HYPR_RULES_SRC, HYPR_RULES_DST);
  log(`rules: ${HYPR_RULES_DST}`);

  if (!fs.existsSync(HYPRLAND_LUA)) {
    log(`WARNING: ${HYPRLAND_LUA} not found — add ${REQUIRE_LINE} to your Hyprland config yourself`);
    return;
  }
  const current = fs.readFileSync(HYPRLAND_LUA, "utf8");
  if (current.split("\n").some((l) => l.trim() === REQUIRE_LINE)) {
    log("hyprland.lua already requires hypr.ai-pulse");
  } else {
    backup(HYPRLAND_LUA);
    const anchor = 'require("hypr.autostart")';
    const next = current.includes(anchor)
      ? current.replace(anchor, `${anchor}\n${REQUIRE_LINE} -- AI Pulse window rules`)
      : `${current.trimEnd()}\n\n${REQUIRE_LINE} -- AI Pulse window rules\n`;
    fs.writeFileSync(HYPRLAND_LUA, next);
    log(`hyprland.lua: added ${REQUIRE_LINE}`);
  }
  if (have("hyprctl")) {
    run("hyprctl", ["reload"], { optional: true });
    const errors = spawnSync("hyprctl", ["configerrors"], { encoding: "utf8" }).stdout?.trim() ?? "";
    log(errors && !/no errors/i.test(errors) ? `hyprctl configerrors:\n${errors}` : "hyprctl configerrors: clean");
  }
}

function uninstallHyprRules() {
  if (fs.existsSync(HYPR_RULES_DST)) {
    fs.rmSync(HYPR_RULES_DST);
    log(`removed ${HYPR_RULES_DST}`);
  }
  if (fs.existsSync(HYPRLAND_LUA)) {
    const current = fs.readFileSync(HYPRLAND_LUA, "utf8");
    const next = current
      .split("\n")
      .filter((l) => !l.trim().startsWith(REQUIRE_LINE))
      .join("\n");
    if (next !== current) {
      backup(HYPRLAND_LUA);
      fs.writeFileSync(HYPRLAND_LUA, next);
      log("hyprland.lua: removed require line");
    }
  }
  if (have("hyprctl")) run("hyprctl", ["reload"], { optional: true });
}

function installHook() {
  if (have("omarchy")) {
    run("omarchy", ["hook", "install", "theme-set", HOOK_SRC]);
  } else {
    fs.mkdirSync(path.dirname(HOOK_DST), { recursive: true });
    fs.copyFileSync(HOOK_SRC, HOOK_DST);
    fs.chmodSync(HOOK_DST, 0o755);
  }
  log(`hook: ${HOOK_DST}`);
}

function installPlugin() {
  if (!fs.existsSync(PLUGIN_SRC)) {
    log(`plugin source missing (${PLUGIN_SRC}) — skipped`);
    return;
  }
  fs.mkdirSync(path.dirname(PLUGIN_DST), { recursive: true });
  // Symlink for a source checkout (edits hot-reload in the shell); copy otherwise.
  if (fs.existsSync(PLUGIN_DST)) fs.rmSync(PLUGIN_DST, { recursive: true, force: true });
  if (process.env.AI_PULSE_PLUGIN_COPY) fs.cpSync(PLUGIN_SRC, PLUGIN_DST, { recursive: true });
  else fs.symlinkSync(PLUGIN_SRC, PLUGIN_DST, "dir");
  log(`plugin: ${PLUGIN_DST}`);
  if (have("omarchy")) {
    run("omarchy", ["plugin", "validate", PLUGIN_SRC], { optional: true });
    if (have("omarchy-shell")) run("omarchy-shell", ["shell", "rescanPlugins"], { optional: true });
    if (!run("omarchy", ["plugin", "enable", PLUGIN_ID, "--after", "omarchy.tray"], { optional: true })) {
      run("omarchy", ["plugin", "enable", PLUGIN_ID], { optional: true });
    }
  }
}

function uninstallPlugin() {
  if (have("omarchy")) run("omarchy", ["plugin", "disable", PLUGIN_ID], { optional: true });
  if (fs.existsSync(PLUGIN_DST)) {
    fs.rmSync(PLUGIN_DST, { recursive: true, force: true });
    log(`removed ${PLUGIN_DST}`);
  }
}

try {
  if (process.platform !== "linux") throw new Error("Linux only");
  if (uninstall) {
    uninstallHyprRules();
    if (fs.existsSync(HOOK_DST)) {
      fs.rmSync(HOOK_DST);
      log(`removed ${HOOK_DST}`);
    }
    uninstallPlugin();
    log("done (uninstall). The app's own ~/.local/share/applications and ~/.config/autostart entries are managed by AI Pulse itself.");
  } else {
    installHyprRules();
    installHook();
    installPlugin();
    log("done. Start AI Pulse (npm run widget) — it registers its .desktop entry and the aipulse:// handler on launch.");
  }
} catch (err) {
  console.error(`[linux-install] ${err.message}`);
  process.exit(1);
}
