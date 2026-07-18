# Installing AI Pulse

AI Pulse is a local AI model radar for Windows. This guide walks you through downloading the installer, running it, adding your first provider key, and managing the app afterward.

## 1. Download the installer

1. Open the [GitHub Releases page](https://github.com/FernandoSLuz/ai-pulse/releases).
2. Download the installer for the latest release:

```
AI Pulse-Setup-<version>.exe
```

> **Note:** Release-candidate and prerelease builds (tags like `v1.0.0-rc.1`) are published on the same Releases page, marked as prereleases. Pick a full release unless you specifically want to test an RC.

## 2. Run the installer

Double-click the downloaded `AI Pulse-Setup-<version>.exe`.

- It uses an **NSIS installer** that installs **per-user** — **no administrator rights required**.
- It creates **desktop** and **Start-menu** shortcuts.
- It registers the `aipulse://` protocol so the web dashboard can hand off to the app.

### If Windows SmartScreen warns you

The installer is unsigned, so SmartScreen may show a "Windows protected your PC" warning. To continue:

1. Click **More info**.
2. Click **Run anyway**.

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

You can toggle auto-start in two places:

- **Settings → Startup & service → Start on login**
- **Task Manager → Startup** (the app registers a standard Windows login item you can disable there)

## 5. Opening AI Pulse later

Reopen the app any time via:

- The **desktop shortcut**
- The **Start menu** entry
- The **tray icon** (if it's already running in the background)

## 6. Uninstalling

To remove AI Pulse:

- Go to **Windows Settings → Apps → Installed apps** (or **Apps & features**), find **AI Pulse**, and choose **Uninstall**.
- Or run the bundled **uninstaller** from the AI Pulse Start-menu folder.
