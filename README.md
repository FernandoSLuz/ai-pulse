# AI Pulse — Local AI News + Benchmark Dashboard

Your personal AI model radar: news feed, benchmark rankings, AI analyst briefings, embedded chat with a search agent, and a Windows side widget — all running locally.

## Quick start

### 1. Install dependencies

```powershell
cd "C:\Users\Fernando Personal\ai-pulse"
npm install
```

### 2. Configure API keys

```powershell
copy .env.example .env
```

Edit `.env` and add:

| Key | Where to get it | Required? |
|-----|-----------------|-----------|
| `AA_API_KEY` | [artificialanalysis.ai/insights](https://artificialanalysis.ai/insights) | Recommended (uses demo data without it) |
| `GROQ_API_KEY` | [console.groq.com/keys](https://console.groq.com/keys) | Optional — Groq chat models (analyst prefers Gemini) |
| `GEMINI_API_KEY` | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) | Optional — preferred free analyst + Gemini chat/search |
| `TAVILY_API_KEY` | [app.tavily.com](https://app.tavily.com) | Optional — preferred web search agent (1,000 free credits/month) |

### 3. Run the server

```powershell
npm run dev
```

Open **http://localhost:3847** in Brave.

### 4. Set Brave homepage

Run the helper:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/configure-brave.ps1
```

Or manually:
1. `brave://settings/appearance` → Show home button → `http://localhost:3847`
2. `brave://settings/newTab` → New tab page shows → **Homepage**

### 5. Launch the side widget

In a second terminal:

```powershell
npm run widget
```

### 6. Auto-start on Windows login

```powershell
npm run setup
```

This registers a scheduled task for the server and adds the widget to your Startup folder.

## Features

- **News feed** — 8 curated RSS sources (LAXIMA Signal, MarkTechPost, Hugging Face, OpenAI, etc.)
- **Benchmark table** — Artificial Analysis intelligence, coding, math, pricing, speed, accessibility
- **AI Analyst** — Groq-powered briefings on every update (Ollama fallback)
- **Ask AI Pulse** — Embedded chat with free models + a search agent for broader questions
- **My Stack** — Track your current model; get upgrade suggestions when something better appears
- **Side widget** — Always-on-top ranking panel docked to screen edge
- **Notifications** — Windows toasts for new models, leader changes, and upgrade suggestions

## Chat setup

Use the floating **Ask AI Pulse** button on the dashboard. Pick a free model and ask about news, benchmarks, or your stack. Broader/current-web questions call a **search agent** automatically when configured.

### 1. Keys

| Key | Models / role |
|-----|----------------|
| `GROQ_API_KEY` | Llama 3.3 70B, Qwen3 32B, GPT-OSS 120B, Llama 3.1 8B Instant |
| `GEMINI_API_KEY` | Gemini 3.5 Flash chat; also powers search-agent fallback (Gemini 2.5 Flash + Google Search) |
| `TAVILY_API_KEY` | Preferred search agent (clean web snippets for the chat model) |

Restart the server after editing `.env` (`npm run dev`).

### 2. Which model to pick

- **Pulse-local questions** (rankings, news, My Stack): any available model — prefer **Gemini 3.5 Flash** or **Llama 3.3 70B**.
- **Broader / current-events questions**: any model; the chat will call `web_search` when needed. Prefer having **Tavily** set; otherwise Gemini search fallback is used if `GEMINI_API_KEY` is set.

### 3. Free-tier notes

- Gemini Flash: ~1,500 requests/day (chat). Search fallback via Gemini 2.5 Flash grounding: ~500 RPD.
- Groq: varies by model (often ~1,000 RPD; Llama 3.1 8B is higher).
- Tavily: 1,000 free search credits/month.

The chat status line shows `Web search: on (Tavily)`, `on (Gemini)`, or `off` so you know whether the agent is ready.

## My Stack setup

Click the gear icon on the dashboard to set:
- Your primary model and provider (Cursor, API, Ollama, etc.)
- Priority weights (coding, reasoning, speed, cost)
- Budget tier and must-haves

When a new model beats your stack on your priorities, you'll see a suggestion — never auto-switched.

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Dashboard won't load | Ensure `npm run dev` is running |
| Widget shows "Server offline" | Start the server first, then the widget |
| No live benchmarks | Add `AA_API_KEY` to `.env` |
| Briefings are rule-based only | Add `GEMINI_API_KEY` (preferred), or enable Ollama / `GROQ_API_KEY` |
| Chat shows no models | Add `GROQ_API_KEY` and/or `GEMINI_API_KEY`, restart server |
| Web search is off | Add `TAVILY_API_KEY` (preferred) or `GEMINI_API_KEY` for search fallback |

## Project structure

```
packages/server/   Background service + API + polling
packages/web/      Dashboard UI (served by server)
packages/widget/   Electron side panel
scripts/           Windows setup helpers
```
