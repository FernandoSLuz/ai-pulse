export type ChatProvider = "gemini" | "groq";

export interface ChatModelDef {
  id: string;
  label: string;
  provider: ChatProvider;
  apiModel: string;
  description: string;
}

export const CHAT_MODELS: ChatModelDef[] = [
  {
    id: "gemini-3.5-flash",
    label: "Gemini 3.5 Flash",
    provider: "gemini",
    apiModel: "gemini-3.5-flash",
    description: "Best free quality / coding",
  },
  {
    id: "llama-3.3-70b",
    label: "Llama 3.3 70B",
    provider: "groq",
    apiModel: "llama-3.3-70b-versatile",
    description: "Strong general chat",
  },
  {
    id: "qwen3-32b",
    label: "Qwen3 32B",
    provider: "groq",
    apiModel: "qwen/qwen3-32b",
    description: "Strong reasoning",
  },
  {
    id: "gpt-oss-120b",
    label: "GPT-OSS 120B",
    provider: "groq",
    apiModel: "openai/gpt-oss-120b",
    description: "High-quality open model",
  },
  {
    id: "llama-3.1-8b",
    label: "Llama 3.1 8B Instant",
    provider: "groq",
    apiModel: "llama-3.1-8b-instant",
    description: "Fast / high free RPD",
  },
];

export function getChatModel(id: string): ChatModelDef | undefined {
  return CHAT_MODELS.find((m) => m.id === id);
}

export function listAvailableModels(env: {
  geminiKey?: string;
  groqKey?: string;
}): ChatModelDef[] {
  return CHAT_MODELS.filter((m) => {
    if (m.provider === "gemini") return Boolean(env.geminiKey);
    if (m.provider === "groq") return Boolean(env.groqKey);
    return false;
  });
}
