import { GoogleGenAI } from "@google/genai";
import type { ChatEnv, SearchAgentResult, SearchBackend, SearchResult } from "./types.js";

export function resolveSearchBackend(env: ChatEnv): SearchBackend {
  if (env.tavilyKey) return "tavily";
  if (env.geminiKey) return "gemini";
  return "none";
}

export async function runSearchAgent(query: string, env: ChatEnv): Promise<SearchAgentResult> {
  const trimmed = query.trim();
  if (!trimmed) {
    return { query: "", backend: "none", results: [], error: "Empty search query" };
  }

  if (env.tavilyKey) {
    const viaTavily = await searchTavily(trimmed, env.tavilyKey);
    if (viaTavily.results.length > 0 || !env.geminiKey) return viaTavily;
    // fall through to Gemini if Tavily returned nothing and Gemini is available
  }

  if (env.geminiKey) {
    return searchGeminiGrounded(trimmed, env.geminiKey);
  }

  return {
    query: trimmed,
    backend: "none",
    results: [],
    error:
      "Web search is not configured. Add TAVILY_API_KEY (preferred) or GEMINI_API_KEY to .env for the search agent.",
  };
}

async function searchTavily(query: string, apiKey: string): Promise<SearchAgentResult> {
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: "basic",
        max_results: 5,
        include_answer: false,
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn("[SearchAgent] Tavily failed:", res.status, text.slice(0, 200));
      return {
        query,
        backend: "tavily",
        results: [],
        error: `Tavily error ${res.status}`,
      };
    }
    const json = (await res.json()) as {
      results?: Array<{ title?: string; url?: string; content?: string }>;
    };
    const results: SearchResult[] = (json.results ?? [])
      .filter((r) => r.url)
      .map((r) => ({
        title: r.title ?? r.url ?? "Result",
        url: r.url!,
        snippet: (r.content ?? "").slice(0, 400),
      }));
    return { query, backend: "tavily", results };
  } catch (err) {
    console.warn("[SearchAgent] Tavily exception:", (err as Error).message);
    return {
      query,
      backend: "tavily",
      results: [],
      error: (err as Error).message,
    };
  }
}

async function searchGeminiGrounded(query: string, apiKey: string): Promise<SearchAgentResult> {
  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: `Search the web and return the most relevant facts for this query. Query: ${query}`,
      config: {
        tools: [{ googleSearch: {} }],
      },
    });

    const text = response.text?.trim() ?? "";
    const results: SearchResult[] = [];

    // Extract grounding chunks / citations when present
    const candidates = response.candidates ?? [];
    for (const cand of candidates) {
      const meta = cand.groundingMetadata as
        | {
            groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>;
            groundingSupports?: Array<{ segment?: { text?: string } }>;
          }
        | undefined;
      const chunks = meta?.groundingChunks ?? [];
      for (const chunk of chunks) {
        const web = chunk.web;
        if (web?.uri) {
          results.push({
            title: web.title ?? web.uri,
            url: web.uri,
            snippet: text.slice(0, 300),
          });
        }
      }
    }

    if (results.length === 0 && text) {
      results.push({
        title: "Gemini grounded summary",
        url: "",
        snippet: text.slice(0, 800),
      });
    }

    return { query, backend: "gemini", results };
  } catch (err) {
    console.warn("[SearchAgent] Gemini grounded search failed:", (err as Error).message);
    return {
      query,
      backend: "gemini",
      results: [],
      error: (err as Error).message,
    };
  }
}
