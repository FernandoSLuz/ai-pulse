// electron-builder afterPack hook: rebuild native modules (better-sqlite3) for
// Electron INSIDE the packed app. Doing it here (rather than at the repo root)
// works under npm workspaces because the packed app has both the widget's
// package.json (which lists better-sqlite3) and a real node_modules next to it.
const path = require("node:path");

exports.default = async function afterPack(context) {
  const { rebuild } = require("@electron/rebuild");
  const { Arch } = require("electron-builder");

  // asar is disabled, so the app lives at <appOutDir>/resources/app.
  const buildPath = path.join(context.appOutDir, "resources", "app");
  const electronVersion = context.packager.config.electronVersion || "33.4.11";
  const arch = Arch[context.arch] || "x64";

  console.log(`[afterPack] Rebuilding better-sqlite3 for Electron ${electronVersion} (${arch})`);
  await rebuild({
    buildPath,
    electronVersion,
    arch,
    onlyModules: ["better-sqlite3"],
    force: true,
  });
  console.log("[afterPack] better-sqlite3 rebuilt for Electron.");
};
