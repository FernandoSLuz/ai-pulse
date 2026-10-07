# Releasing

AI Pulse ships as native Windows (x64), macOS (Intel x64 and Apple Silicon arm64), and Linux x64 packages. GitHub Actions builds every platform first and publishes one release only after all platform jobs succeed. You cut a release by pushing a **semantic version tag** — CI does the rest.

## Version tags

Releases are driven by Git tags of the form `v<major>.<minor>.<patch>`. The tag name alone decides whether the result is a prerelease or a full release:

| Tag pattern | Example | Publishes as |
| --- | --- | --- |
| Contains `-rc` | `v1.0.0-rc.1` | **Prerelease** |
| Plain version | `v1.0.0` | **Full release** |

Only `v*` tags trigger `release.yml`. Pushing to a branch does not.

The tag also decides which Linux packages are built: every tag gets an **AppImage**, but the **pacman** package is built only for plain (non-`-rc`) tags. pacman rewrites `1.2.0-rc.1` as `pkgver` `1.2.0_rc.1`, which `vercmp` sorts *above* `1.2.0`, so an installed RC package would block the upgrade to the final release.

## Publishing a release

1. Bump the versions in all three `package.json` files (root, `packages/server`, and `packages/widget`) so the shipped version matches the tag.
2. Run the manual `build-installer.yml` workflow and review every platform artifact.
3. Only after Fernando explicitly approves, create and push the tag. `release.yml` builds Windows, macOS, and Linux assets on native runners, then publishes all sets of assets in one final job after every build succeeds.

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
| `ci.yml` | Push / PR to `main` | Ubuntu + Windows + macOS | Builds and smoke-tests the app on each desktop platform, including Node-API/better-sqlite3 under Node and Electron; the Ubuntu job also boots the bundled server and asserts `GET /api/health`. The platform matrix packages Windows x64, macOS x64/arm64, and Linux x64 without publishing. |
| `release.yml` | Push of a `v*` tag | Windows + macOS + Ubuntu | Builds Windows x64 NSIS, macOS x64/arm64 DMG+ZIP, and Linux x64 AppImage/deb/rpm (plus pacman on final tags), then publishes only from the all-green `publish` job. |
| `build-installer.yml` | Manual (`workflow_dispatch`) | Windows + macOS + Ubuntu matrix | Builds the same platform installers without publishing, as workflow artifacts. |

## Where artifacts land

Published artifacts attach to the **GitHub Release** for the tag.

Before upload, the publish job normalizes spaces to hyphens defensively and validates
that both update feeds reference existing files. Published installer names include
the operating system and architecture so that non-technical users can choose the
right download without guessing. These names apply from v2.0.1 onward; older
releases may still use the previous filenames.

Windows (job `windows-installer`, x64):

- `AI-Pulse-<version>-Windows-x64-Setup.exe` — the NSIS installer
- `latest.yml` — Windows update feed
- `.blockmap`

macOS (job `macos-installer`):

- `AI-Pulse-<version>-macOS-x64.dmg` / `AI-Pulse-<version>-macOS-arm64.dmg`
- matching `AI-Pulse-<version>-macOS-x64.zip` / `AI-Pulse-<version>-macOS-arm64.zip` archives. macOS updates are manual for now because Intel and Apple Silicon feeds must remain architecture-specific.

Linux (job `linux-packages`, x64):

- `AI-Pulse-<version>-Linux-x86_64.AppImage` — every release, including `-rc` prereleases
- `AI-Pulse-<version>-Linux-Arch-Omarchy-x64.pacman` — final releases only
- `AI-Pulse-<version>-Linux-Debian-Ubuntu-amd64.deb` and `AI-Pulse-<version>-Linux-Fedora-RHEL-x86_64.rpm`
- `latest-linux.yml` — AppImage update feed (the pacman and macOS installs report updates as unsupported)

## Building the installers locally

To produce the installers on your own machine:

```bash
npm run dist -w @ai-pulse/widget            # Windows: NSIS installer (run on Windows)
npm run dist:mac -w @ai-pulse/widget        # macOS: DMG + ZIP (run on macOS)
npm run dist:linux -w @ai-pulse/widget      # Linux: AppImage + deb + rpm + pacman (run on Linux)
npm run dist:linux:dir -w @ai-pulse/widget  # Linux: unpacked app dir, no installer
```

The build output lands in `packages/widget/release`. The pacman target needs `bsdtar` on the build machine (`libarchive` on Arch, `libarchive-tools` on Debian/Ubuntu). Icons are regenerated from `build/icon-master-1024.png` with `npm run icons -w @ai-pulse/widget` (requires ImageMagick).

## Code signing

Code signing and notarization are **not configured**. Windows and macOS builds are unsigned, so SmartScreen/Gatekeeper may warn users; Linux packages carry no signature either. Production signing requires platform credentials and should be enabled before presenting a release as trusted.

## Packaging detail

esbuild bundles the server into a single ESM file (`dist/server/index.mjs`), with `better-sqlite3` and `node-notifier` marked external. `asar` is disabled so those native/optional modules resolve via `node_modules`.

The toolchain is Electron 43, electron-builder 26, and `better-sqlite3` 13 on Node >= 22.14. Node-API removes Electron ABI coupling, but native modules remain architecture-specific; this is why macOS builds run once on Intel and once on Apple Silicon, and why this release matrix intentionally publishes Linux x64 only until a native Linux arm64 build lane is available. The bundled llama.cpp b11474 CPU assets are likewise selected by OS and architecture and are verified by SHA-256 before first use. Electron >= 42 no longer downloads its binary during `npm install`, which is why every workflow runs `npx install-electron` right after `npm ci`.

The release gate must retain the native smoke checks for `better-sqlite3` under both
Node and Electron, the bundled server health check, and a real package build for
each matrix entry. Ubuntu RPM packaging requires `rpmbuild` from the `rpm` package;
the workflow installs it explicitly. No release should claim Linux arm64, Windows
arm64, or macOS automatic updates until those lanes and feeds are validated. The
published matrix is not a promise of compatibility with every historical OS
version; validate any additional target on its native runner before advertising
it.
