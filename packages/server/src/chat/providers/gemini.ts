import { GoogleGenAI, type Content, type Part, type FunctionDeclaration } from "@google/genai";
import { CHAT_TOOL_DEFINITIONS } from "../tools.js";
import type { ChatMessage, ProviderTurn, ToolCallRequest } from "../types.js";

const geminiDeclarations: FunctionDeclaration[] = CHAT_TOOL_DEFINITIONS.map((t) => ({
  name: t.name,
  description: t.description,
  parametersJsonSchema: t.parameters,
}));

export function toGeminiContents(messages: ChatMessage[]): Content[] {
  const contents: Content[] = [];
  for (const m of messages) {
    if (m.role !== "user" && m.role !== "assistant") continue;
    contents.push({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    });
  }
  return contents;
}

export async function callGeminiChat(opts: {
  apiKey: string;
  model: string;
  system: string;
  contents: Content[];
}): Promise<ProviderTurn> {
  const ai = new GoogleGenAI({ apiKey: opts.apiKey });
  const response = await ai.models.generateContent({
    model: opts.model,
    contents: opts.contents,
    config: {
      systemInstruction: opts.system,
      temperature: 0.4,
      tools: [{ functionDeclarations: geminiDeclarations }],
    },
  });

  const toolCalls: ToolCallRequest[] = [];
  let textParts: string[] = [];

  const parts = response.candidates?.[0]?.content?.parts ?? [];
  for (const part of parts) {
    if (part.text) textParts.push(part.text);
    if (part.functionCall?.name) {
      const args = (part.functionCall.args ?? {}) as Record<string, unknown>;
      toolCalls.push({
        id: `gemini_${toolCalls.length}_${part.functionCall.name}`,
        name: part.functionCall.name,
        arguments: args,
      });
    }
  }

  // Fallback: some SDK versions expose functionCalls on the response
  if (toolCalls.length === 0 && Array.isArray(response.functionCalls)) {
    for (const fc of response.functionCalls) {
      if (!fc.name) continue;
      toolCalls.push({
        id: `gemini_${toolCalls.length}_${fc.name}`,
        name: fc.name,
        arguments: (fc.args ?? {}) as Record<string, unknown>,
      });
    }
  }

  return {
    content: textParts.join("\n").trim() || null,
    toolCalls,
  };
}

export function geminiModelToolContent(toolCalls: ToolCallRequest[]): Content {
  return {
    role: "model",
    parts: toolCalls.map(
      (tc): Part => ({
        functionCall: {
          name: tc.name,
          args: tc.arguments,
        },
      }),
    ),
  };
}

export function geminiToolResponseContent(
  toolCalls: ToolCallRequest[],
  results: string[],
): Content {
  return {
    role: "user",
    parts: toolCalls.map(
      (tc, i): Part => ({
        functionResponse: {
          name: tc.name,
          response: safeJson(results[i] ?? "{}"),
        },
      }),
    ),
  };
}

function safeJson(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
    return { result: parsed };
  } catch {
    return { result: raw };
  }
}
