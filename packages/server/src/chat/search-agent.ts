import type { ChatEnv, SearchAgentResult, SearchBackend, SearchResult } from "./types.js";

export function resolveSearchBackend(env: ChatEnv): SearchBackend {
  if (env.tavilyKey) return "tavily";
  return "none";
}

export async function runSearchAgent(query: string, env: ChatEnv): Promise<SearchAgentResult> {
  const trimmed = query.trim();
  if (!trimmed) {
    return { query: "", backend: "none", results: [], error: "Empty search query" };
  }

  if (env.tavilyKey) {
    return searchTavily(trimmed, env.tavilyKey);
  }

  return {
    query: trimmed,
    backend: "none",
    results: [],
    error:
      "Web search is not configured. Add Tavily in Settings → Connections for optional search.",
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
