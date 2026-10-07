import { getLocalAIStatus, localAiAuthHeader, localAiBaseUrl } from "./manager.js";
export interface LocalChatMessage { role: "system" | "user" | "assistant"; content: string }
let active = false;

/** Bound work on small CPUs. Nothing is queued indefinitely behind background curation. */
export async function localChat(messages: LocalChatMessage[], opts: { json?: boolean; signal?: AbortSignal; maxTokens?: number } = {}): Promise<string> {
  if (active) throw new Error("The local model is busy. Please try again in a moment.");
  const base = localAiBaseUrl();
  const model = getLocalAIStatus().model?.id;
  const maxTokens = Math.max(32, Math.min(opts.maxTokens ?? 500, 1024));
  const signal = AbortSignal.any([AbortSignal.timeout(120_000), ...(opts.signal ? [opts.signal] : [])]);
  const headers = { "Content-Type": "application/json", Authorization: localAiAuthHeader() };
  active = true;
  try {
    // Use this model's tokenizer, including its chat template, rather than an
    // English character estimate (which fails badly for other languages).
    const templateResponse = await fetch(base.replace(/\/v1$/, "/apply-template"), {
      method: "POST", headers, signal, body: JSON.stringify({ messages, add_generation_prompt: true, chat_template_kwargs: { enable_thinking: false } }),
    });
    if (!templateResponse.ok) throw new Error("The local runtime could not prepare this request.");
    const template = await templateResponse.json() as { prompt?: string };
    if (!template.prompt) throw new Error("The local runtime returned an empty prompt.");
    const tokenResponse = await fetch(base.replace(/\/v1$/, "/tokenize"), {
      method: "POST", headers, signal, body: JSON.stringify({ content: template.prompt, add_special: true }),
    });
    if (!tokenResponse.ok) throw new Error("The local runtime could not measure this request.");
    const measured = await tokenResponse.json() as { tokens?: unknown[] };
    if (!Array.isArray(measured.tokens)) throw new Error("The local tokenizer returned an invalid response.");
    if (measured.tokens.length + maxTokens + 64 > 4096) {
      throw new Error("This conversation is too long for the light local model. Clear the chat or shorten the question.");
    }
    const response = await fetch(`${base}/chat/completions`, {
      method: "POST", headers, signal,
      body: JSON.stringify({
        model, messages, temperature: 0.1, max_tokens: maxTokens,
        chat_template_kwargs: { enable_thinking: false },
        ...(opts.json ? { response_format: { type: "json_object" } } : {}),
      }),
    });
    if (!response.ok) throw new Error(`Local model request failed (HTTP ${response.status}). Try again or restart local AI in Settings.`);
    const json = await response.json() as { choices?: Array<{ message?: { content?: string }; finish_reason?: string }> };
    const choice = json.choices?.[0];
    const content = choice?.message?.content?.trim();
    if (!content) throw new Error("The local model returned no answer. Try a shorter question.");
    if (opts.json && choice?.finish_reason === "length") throw new Error("The local response exceeded its limit. Basic curation was used.");
    return content;
  } finally { active = false; }
}
