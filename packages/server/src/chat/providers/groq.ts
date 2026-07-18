import Groq from "groq-sdk";
import { CHAT_TOOL_DEFINITIONS } from "../tools.js";
import type { ChatMessage, ProviderTurn, ToolCallRequest } from "../types.js";

const groqTools = CHAT_TOOL_DEFINITIONS.map((t) => ({
  type: "function" as const,
  function: {
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  },
}));

export type GroqHistoryMessage =
  | { role: "system" | "user" | "assistant"; content: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
    }
  | { role: "tool"; tool_call_id: string; content: string };

export function toGroqMessages(
  system: string,
  messages: ChatMessage[],
): GroqHistoryMessage[] {
  return [
    { role: "system", content: system },
    ...messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
  ];
}

export async function callGroqChat(opts: {
  apiKey: string;
  model: string;
  messages: GroqHistoryMessage[];
}): Promise<ProviderTurn> {
  const groq = new Groq({ apiKey: opts.apiKey });
  const completion = await groq.chat.completions.create({
    model: opts.model,
    messages: opts.messages as Parameters<typeof groq.chat.completions.create>[0]["messages"],
    tools: groqTools,
    temperature: 0.4,
  });

  const choice = completion.choices[0]?.message;
  if (!choice) return { content: null, toolCalls: [] };

  const toolCalls: ToolCallRequest[] = (choice.tool_calls ?? []).map((tc) => {
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(tc.function.arguments || "{}") as Record<string, unknown>;
    } catch {
      args = {};
    }
    return { id: tc.id, name: tc.function.name, arguments: args };
  });

  return {
    content: choice.content ?? null,
    toolCalls,
  };
}

export function groqAssistantToolMessage(
  content: string | null,
  toolCalls: ToolCallRequest[],
): GroqHistoryMessage {
  return {
    role: "assistant",
    content,
    tool_calls: toolCalls.map((tc) => ({
      id: tc.id,
      type: "function" as const,
      function: {
        name: tc.name,
        arguments: JSON.stringify(tc.arguments ?? {}),
      },
    })),
  };
}
