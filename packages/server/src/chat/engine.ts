import { buildPulseSystemPrompt } from "./context.js";
import { getChatModel } from "./models.js";
import {
  callGeminiChat,
  geminiModelToolContent,
  geminiToolResponseContent,
  toGeminiContents,
} from "./providers/gemini.js";
import {
  callGroqChat,
  groqAssistantToolMessage,
  toGroqMessages,
  type GroqHistoryMessage,
} from "./providers/groq.js";
import { resolveSearchBackend } from "./search-agent.js";
import { citationsFromSearches, executeToolCall } from "./tools.js";
import type {
  ChatEnv,
  ChatMessage,
  ChatReply,
  SearchAgentResult,
} from "./types.js";

const MAX_TOOL_ROUNDS = 2;

export async function runChat(opts: {
  modelId: string;
  messages: ChatMessage[];
  env: ChatEnv;
}): Promise<ChatReply> {
  const model = getChatModel(opts.modelId);
  if (!model) {
    throw new Error(`Unknown model: ${opts.modelId}`);
  }

  const searchBackend = resolveSearchBackend(opts.env);
  const searchEnabled = searchBackend !== "none";
  const system = buildPulseSystemPrompt(searchEnabled);
  const userMessages = opts.messages.filter((m) => m.role === "user" || m.role === "assistant");

  if (model.provider === "gemini") {
    if (!opts.env.geminiKey) throw new Error("GEMINI_API_KEY is not configured");
    return runGeminiLoop({
      apiKey: opts.env.geminiKey,
      apiModel: model.apiModel,
      modelId: model.id,
      system,
      messages: userMessages,
      env: opts.env,
      searchBackend,
    });
  }

  if (!opts.env.groqKey) throw new Error("GROQ_API_KEY is not configured");
  return runGroqLoop({
    apiKey: opts.env.groqKey,
    apiModel: model.apiModel,
    modelId: model.id,
    system,
    messages: userMessages,
    env: opts.env,
    searchBackend,
  });
}

async function runGroqLoop(opts: {
  apiKey: string;
  apiModel: string;
  modelId: string;
  system: string;
  messages: ChatMessage[];
  env: ChatEnv;
  searchBackend: ChatReply["searchBackend"];
}): Promise<ChatReply> {
  const history: GroqHistoryMessage[] = toGroqMessages(opts.system, opts.messages);
  const toolsUsed = new Set<string>();
  const searches: SearchAgentResult[] = [];
  const webBudget = { remaining: 2 };

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const turn = await callGroqChat({
      apiKey: opts.apiKey,
      model: opts.apiModel,
      messages: history,
    });

    if (!turn.toolCalls.length) {
      return {
        reply: turn.content?.trim() || "I couldn't generate a reply.",
        modelId: opts.modelId,
        toolsUsed: [...toolsUsed],
        citations: citationsFromSearches(searches),
        searchBackend: opts.searchBackend,
      };
    }

    if (round === MAX_TOOL_ROUNDS) {
      return {
        reply:
          turn.content?.trim() ||
          "I hit the tool-call limit. Try asking again with a more specific question.",
        modelId: opts.modelId,
        toolsUsed: [...toolsUsed],
        citations: citationsFromSearches(searches),
        searchBackend: opts.searchBackend,
      };
    }

    history.push(groqAssistantToolMessage(turn.content, turn.toolCalls));

    for (const call of turn.toolCalls) {
      toolsUsed.add(call.name);
      const exec = await executeToolCall(call, opts.env, { webSearchBudget: webBudget });
      if (exec.search) searches.push(exec.search);
      history.push({
        role: "tool",
        tool_call_id: call.id,
        content: exec.result,
      });
    }
  }

  return {
    reply: "I couldn't finish that request.",
    modelId: opts.modelId,
    toolsUsed: [...toolsUsed],
    citations: citationsFromSearches(searches),
    searchBackend: opts.searchBackend,
  };
}

async function runGeminiLoop(opts: {
  apiKey: string;
  apiModel: string;
  modelId: string;
  system: string;
  messages: ChatMessage[];
  env: ChatEnv;
  searchBackend: ChatReply["searchBackend"];
}): Promise<ChatReply> {
  const contents = toGeminiContents(opts.messages);
  const toolsUsed = new Set<string>();
  const searches: SearchAgentResult[] = [];
  const webBudget = { remaining: 2 };

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const turn = await callGeminiChat({
      apiKey: opts.apiKey,
      model: opts.apiModel,
      system: opts.system,
      contents,
    });

    if (!turn.toolCalls.length) {
      return {
        reply: turn.content?.trim() || "I couldn't generate a reply.",
        modelId: opts.modelId,
        toolsUsed: [...toolsUsed],
        citations: citationsFromSearches(searches),
        searchBackend: opts.searchBackend,
      };
    }

    if (round === MAX_TOOL_ROUNDS) {
      return {
        reply:
          turn.content?.trim() ||
          "I hit the tool-call limit. Try asking again with a more specific question.",
        modelId: opts.modelId,
        toolsUsed: [...toolsUsed],
        citations: citationsFromSearches(searches),
        searchBackend: opts.searchBackend,
      };
    }

    contents.push(geminiModelToolContent(turn.toolCalls));
    const results: string[] = [];
    for (const call of turn.toolCalls) {
      toolsUsed.add(call.name);
      const exec = await executeToolCall(call, opts.env, { webSearchBudget: webBudget });
      if (exec.search) searches.push(exec.search);
      results.push(exec.result);
    }
    contents.push(geminiToolResponseContent(turn.toolCalls, results));
  }

  return {
    reply: "I couldn't finish that request.",
    modelId: opts.modelId,
    toolsUsed: [...toolsUsed],
    citations: citationsFromSearches(searches),
    searchBackend: opts.searchBackend,
  };
}
