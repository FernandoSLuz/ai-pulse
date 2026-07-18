# Troubleshooting

This guide covers the most common issues with **AI Pulse** and how to fix them. Most problems are resolved from the desktop app's **Settings** window or the **tray** icon.

> AI Pulse is controlled entirely from the Electron desktop app. The app supervises the background service, so start there when something looks wrong.

## Quick reference

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| **"AI: degraded (rules)"** shown in the app | Every configured provider is rate-limited, or you have no provider key at all | Add another provider key (e.g. **Cerebras** or **OpenRouter**) in **Settings → Connections**, then wait for the rate-limit cooldown to clear. Curation resumes automatically once a provider answers. |
| Background service won't start, or keeps restarting | The server port is already in use, or a bad build | Change the port in **Settings → Startup & service → Server port**, then check the logs via **Settings → Open logs**. |
| **"Server offline"** / no data anywhere | The background service is stopped | Open the **tray → Start Background Service**. |
| No live benchmarks | Missing or invalid `AA_API_KEY` (Artificial Analysis) | Add a valid Artificial Analysis key in **Settings → Connections**. |
| Chat shows no models | No AI provider key configured | Add a **Gemini** or **Groq** key in **Settings → Connections**. |
| Web search in chat is off | No search provider configured | Add a **Tavily** or **Gemini** key in **Settings → Connections**. |
| Clicking the dashboard **gear** does nothing | The desktop app isn't installed or the `aipulse://` protocol isn't registered | Use the browser's **"Edit here instead"** fallback drawer, or open the app from the **tray**. |
| Port **3847** already in use | Another process (or a second copy of AI Pulse) holds the port | Change the port in **Settings → Startup & service → Server port**. |
| Installer blocked by **SmartScreen** | Windows doesn't recognize the publisher yet | Click **More info → Run anyway**. |
| Desktop leaderboard not visible | The leaderboard window is hidden | Enable **Settings → Desktop leaderboard → Show**, or use the **tray → Show Leaderboard**. |

## "AI: degraded (rules)"

AI Pulse rotates across several free cloud providers and uses the first that returns valid JSON. When you see **"AI: degraded (rules)"**, none of your configured providers answered, so curation fell back to deterministic rules.

- You need **at least one** provider key; adding more makes curation more resilient.
- Each provider backs off independently: rate-limited providers honor the retry hint, so a cooldown may need to pass before they recover.
- Add keys under **Settings → Connections**. Get them here:
  - Gemini — https://aistudio.google.com/apikey
  - Cerebras — https://cloud.cerebras.ai
  - Groq — https://console.groq.com/keys
  - OpenRouter — https://openrouter.ai/keys

Once a provider responds, the app switches the status back to, for example, **"AI: Gemini ✓"**.

## The service won't start or keeps restarting

The desktop app's supervisor health-pings the server every 20 seconds and restarts it on crash or hang. If it never stabilizes:

1. Change the port in **Settings → Startup & service → Server port** (something else may be holding **3847**).
2. Open the logs to see the underlying error:
   - **Settings → Open logs**
3. Use the tray controls to cycle the service: **Restart / Stop / Start Background Service**.

## Missing data or offline dashboard

If the web dashboard shows **"Server offline"** or no content loads, the background service is stopped. Start it from the **tray → Start Background Service**. The tray also offers **Restart** and **Stop**, plus **Quit AI Pulse** (which stops both the server and the app).

## Chat, search, and benchmarks

These features each depend on a specific key in **Settings → Connections**:

- **Benchmarks:** add a valid `AA_API_KEY` (Artificial Analysis).
- **Chat models:** add a **Gemini** or **Groq** key.
- **Chat web search:** add a **Tavily** key (preferred) or a **Gemini** key (grounding fallback).

## The dashboard gear does nothing

The web dashboard is a content view only. Its settings gear redirects to the desktop app via the `aipulse://` deep link. If nothing happens, the app likely isn't installed or the protocol isn't registered:

- Use the in-browser **"Edit here instead"** fallback drawer, **or**
- Open the app directly from the **tray**.

## Installer blocked by SmartScreen

When running `AI Pulse-Setup-<version>.exe`, Windows SmartScreen may warn about an unrecognized publisher. Click **More info → Run anyway**. The installer is per-user and needs no admin rights.

## Leaderboard not showing

The docked leaderboard is a separate window. If you can't see it:

- Enable **Settings → Desktop leaderboard → Show** (you can also set dock side, always-on-top, and rows there), or
- Use the **tray → Show Leaderboard**.

## Collecting logs

When reporting a problem or diagnosing a crash, grab the server log:

- In the app: **Settings → Open logs**
- On disk: `userData/logs/server.log`

```text
# Windows path
%APPDATA%\AI Pulse\logs\server.log
```

Logs are rotated at 5 MB, so capture the relevant section soon after the issue occurs.
