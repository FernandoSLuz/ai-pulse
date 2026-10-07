import { buildPulseSystemPrompt } from "./context.js";
import { getChatModel } from "./models.js";
import { runSearchAgent, resolveSearchBackend } from "./search-agent.js";
import { citationsFromSearches } from "./tools.js";
import { localChat } from "../local-ai/index.js";
import type { ChatEnv, ChatMessage, ChatReply, SearchAgentResult } from "./types.js";
export async function runChat(opts: { modelId: string; messages: ChatMessage[]; env: ChatEnv }): Promise<ChatReply> {
  const model = getChatModel(opts.modelId); if (!model) throw new Error(`Unknown model: ${opts.modelId}`);
  const last = opts.messages.at(-1)?.content ?? ""; const searches: SearchAgentResult[] = []; const toolsUsed: string[] = ["query_pulse"];
  let extra = "";
  if (/\b(?:search\s*web|web\s*search|pesquise(?:\s+na)?\s+web|busque(?:\s+na)?\s+web|procure(?:\s+na)?\s+web)\b/i.test(last) && opts.env.tavilyKey) { const search = await runSearchAgent(last, opts.env); searches.push(search); toolsUsed.push("web_search"); extra = `\nExplicit web search results:\n${JSON.stringify(search).slice(0, 3500)}`; }
  const systemContent = `${buildPulseSystemPrompt(resolveSearchBackend(opts.env) !== "none")}${extra}`;
  const messages = opts.messages.filter(m => m.role === "user" || m.role === "assistant");
  const lastQuestion = messages.at(-1);
  const history: ChatMessage[] = [];
  // Leave room for the system context and the local model's response budget.
  const questionBudget = lastQuestion ? Math.min(2400, Math.max(1200, 8200 - systemContent.length)) : 0;
  let budget = Math.max(0, 8200 - systemContent.length - questionBudget);
  for (const message of messages.slice(0, -1).slice(-8).reverse()) {
    const content = message.content.slice(0, Math.min(message.content.length, 1200));
    if (content.length + 80 > budget) break;
    history.unshift({ role: message.role, content });
    budget -= content.length + 80;
  }
  if (lastQuestion) history.push({ role: lastQuestion.role, content: lastQuestion.content.slice(0, questionBudget) });
  const reply = await localChat([{ role: "system", content: systemContent }, ...history], { maxTokens: 700 });
  return { reply: reply || "I could not generate a local answer.", modelId: model.id, toolsUsed, citations: citationsFromSearches(searches), searchBackend: resolveSearchBackend(opts.env) };
}
