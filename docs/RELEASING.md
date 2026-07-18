# Releasing

AI Pulse ships as a Windows installer built and published by GitHub Actions. You cut a release by pushing a **semantic version tag** — CI does the rest.

## Version tags

Releases are driven by Git tags of the form `v<major>.<minor>.<patch>`. The tag name alone decides whether the result is a prerelease or a full release:

| Tag pattern | Example | Publishes as |
| --- | --- | --- |
| Contains `-rc` | `v1.0.0-rc.1` | **Prerelease** |
| Plain version | `v1.0.0` | **Full release** |

Only `v*` tags trigger `release.yml`. Pushing to a branch does not.

## Publishing a release

1. Bump package versions if you want the shipped version to match the tag (optional).
2. Create and push the tag. `release.yml` builds the installer on `windows-latest` and publishes a GitHub Release.

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

Two workflows run in GitHub Actions:

| Workflow | Trigger | Runner | What it does |
| --- | --- | --- | --- |
| `ci.yml` | Push / PR to `main` | Ubuntu | Install, build the server + app, syntax-check the browser JS, boot the bundled server, and assert `GET /api/health`. |
| `release.yml` | Push of a `v*` tag | Windows | Build the NSIS installer and publish a GitHub Release with the `.exe`. |

## Where artifacts land

Published artifacts attach to the **GitHub Release** for the tag:

- `AI Pulse-Setup-<version>.exe` — the NSIS installer
- `latest.yml`
- `.blockmap`

## Building the installer locally

To produce the installer on your own machine:

```bash
npm run dist -w @ai-pulse/widget
```

The build output lands in `packages/widget/release`.

## Code signing

Code signing is **not configured**. The installer is an **unsigned build**, so Windows SmartScreen may warn users on first run.

## Packaging detail

esbuild bundles the server into a single ESM file (`dist/server/index.mjs`), with `better-sqlite3` and `node-notifier` marked external. `asar` is disabled so those native/optional modules resolve via `node_modules`.
