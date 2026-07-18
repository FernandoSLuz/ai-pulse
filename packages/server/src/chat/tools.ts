import { runQueryPulse } from "./context.js";
import { runSearchAgent } from "./search-agent.js";
import type { ChatCitation, ChatEnv, SearchAgentResult, ToolCallRequest } from "./types.js";

export const CHAT_TOOL_DEFINITIONS = [
  {
    name: "query_pulse",
    description:
      "Look up live AI Pulse dashboard data: rankings/benchmarks, news, My Stack, or analyst briefing.",
    parameters: {
      type: "object",
      properties: {
        topic: {
          type: "string",
          description:
            "What to fetch: rankings, news, stack, briefing, or overview (default overview).",
        },
        limit: {
          type: "number",
          description: "Max items for news/rankings (1-20).",
        },
      },
    },
  },
  {
    name: "web_search",
    description:
      "Search the live web via the search agent for broader or current-events questions beyond Pulse data.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query string.",
        },
      },
      required: ["query"],
    },
  },
] as const;

export interface ToolExecution {
  name: string;
  result: string;
  search?: SearchAgentResult;
}

export async function executeToolCall(
  call: ToolCallRequest,
  env: ChatEnv,
  opts: { webSearchBudget: { remaining: number } },
): Promise<ToolExecution> {
  if (call.name === "query_pulse") {
    const topic = typeof call.arguments.topic === "string" ? call.arguments.topic : "overview";
    const limit = typeof call.arguments.limit === "number" ? call.arguments.limit : undefined;
    return {
      name: "query_pulse",
      result: runQueryPulse({ topic, limit }),
    };
  }

  if (call.name === "web_search") {
    if (opts.webSearchBudget.remaining <= 0) {
      return {
        name: "web_search",
        result: JSON.stringify({
          error: "Web search budget exhausted for this turn (max 2 searches).",
        }),
      };
    }
    opts.webSearchBudget.remaining -= 1;
    const query = typeof call.arguments.query === "string" ? call.arguments.query : "";
    const search = await runSearchAgent(query, env);
    return {
      name: "web_search",
      result: JSON.stringify(search),
      search,
    };
  }

  return {
    name: call.name,
    result: JSON.stringify({ error: `Unknown tool: ${call.name}` }),
  };
}

export function citationsFromSearches(searches: SearchAgentResult[]): ChatCitation[] {
  const seen = new Set<string>();
  const out: ChatCitation[] = [];
  for (const s of searches) {
    for (const r of s.results) {
      if (!r.url || seen.has(r.url)) continue;
      seen.add(r.url);
      out.push({ title: r.title, url: r.url });
    }
  }
  return out.slice(0, 8);
}
