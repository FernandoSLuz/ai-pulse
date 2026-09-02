# Releasing

AI Pulse ships as a Windows installer and Linux packages (AppImage + pacman), all built and published by GitHub Actions. You cut a release by pushing a **semantic version tag** — CI does the rest.

## Version tags

Releases are driven by Git tags of the form `v<major>.<minor>.<patch>`. The tag name alone decides whether the result is a prerelease or a full release:

| Tag pattern | Example | Publishes as |
| --- | --- | --- |
| Contains `-rc` | `v1.0.0-rc.1` | **Prerelease** |
| Plain version | `v1.0.0` | **Full release** |

Only `v*` tags trigger `release.yml`. Pushing to a branch does not.

The tag also decides which Linux packages are built: every tag gets an **AppImage**, but the **pacman** package is built only for plain (non-`-rc`) tags. pacman rewrites `1.2.0-rc.1` as `pkgver` `1.2.0_rc.1`, which `vercmp` sorts *above* `1.2.0`, so an installed RC package would block the upgrade to the final release.

## Publishing a release

1. Bump package versions if you want the shipped version to match the tag (optional).
2. Create and push the tag. `release.yml` builds the Windows installer on `windows-latest` and the Linux packages on `ubuntu-latest`, then publishes both sets of assets to one GitHub Release.

### Release candidate

```bash
git tag v1.0.0-rc.1
git push origin v1.0.0-rc.1
```

The tag contains `-rc`, so the GitHub Release is marked as a **prerelease**.

### Full release

```bash
git tag v1.0.0
git push origin v1.0.0
```

A plain version tag publishes a **full release**.

## What CI does

Three workflows run in GitHub Actions:

| Workflow | Trigger | Runner | What it does |
| --- | --- | --- | --- |
| `ci.yml` | Push / PR to `main` | Ubuntu | `npm ci` + `npx install-electron`, smoke-test `better-sqlite3` under Node and Electron (Node-API), build the server + app, syntax-check the browser JS, boot the bundled server and assert `GET /api/health`, then `electron-builder --linux --dir` as a packaging sanity check. |
| `release.yml` | Push of a `v*` tag | Windows + Ubuntu | Job `windows-installer` builds the NSIS installer; job `linux-packages` builds the AppImage (plus the pacman package for non-rc tags; it installs `libarchive-tools` first because fpm's pacman writer needs `bsdtar`). Both publish to the same GitHub Release. |
| `build-installer.yml` | Manual (`workflow_dispatch`), for iterating on the installers without cutting a release | Windows / Ubuntu matrix | Builds the same installers without publishing, as workflow artifacts. |

## Where artifacts land

Published artifacts attach to the **GitHub Release** for the tag.

Windows (job `windows-installer`):

- `AI Pulse-Setup-<version>.exe` — the NSIS installer
- `latest.yml` — Windows update feed
- `.blockmap`

Linux (job `linux-packages`):

- `ai-pulse-<version>.AppImage` — every release, including `-rc` prereleases
- `ai-pulse-<version>.pacman` — final releases only
- `latest-linux.yml` — AppImage update feed (the pacman install reports updates as unsupported)

## Building the installers locally

To produce the installers on your own machine:

```bash
npm run dist -w @ai-pulse/widget            # Windows: NSIS installer (run on Windows)
npm run dist:linux -w @ai-pulse/widget      # Linux: AppImage + pacman (run on Linux)
npm run dist:linux:dir -w @ai-pulse/widget  # Linux: unpacked app dir, no installer
```

The build output lands in `packages/widget/release`. The pacman target needs `bsdtar` on the build machine (`libarchive` on Arch, `libarchive-tools` on Debian/Ubuntu). Icons are regenerated from `build/icon-master-1024.png` with `npm run icons -w @ai-pulse/widget` (requires ImageMagick).

## Code signing

Code signing is **not configured**. The Windows installer and the Linux packages are all **unsigned builds**: Windows SmartScreen may warn users on first run, and Linux users get no signature to verify.

## Packaging detail

esbuild bundles the server into a single ESM file (`dist/server/index.mjs`), with `better-sqlite3` and `node-notifier` marked external. `asar` is disabled so those native/optional modules resolve via `node_modules`.

The toolchain is Electron 43, electron-builder 26, and `better-sqlite3` 13 on Node >= 22.14. `better-sqlite3` >= 13 is a **Node-API** addon (Node-API 10), so one prebuilt binary loads under both Node and Electron: there is **no `@electron/rebuild` step and no per-runtime ABI rebuild** anywhere — CI merely smoke-tests the module under both runtimes. Electron >= 42 no longer downloads its binary during `npm install`, which is why every workflow runs `npx install-electron` right after `npm ci`.
