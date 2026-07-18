export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchAgentResult {
  query: string;
  backend: "tavily" | "gemini" | "none";
  results: SearchResult[];
  error?: string;
}

export type SearchBackend = "tavily" | "gemini" | "none";

export interface ChatCitation {
  title: string;
  url: string;
}

export interface ChatReply {
  reply: string;
  modelId: string;
  toolsUsed: string[];
  citations: ChatCitation[];
  searchBackend: SearchBackend;
}

export interface ChatEnv {
  geminiKey?: string;
  groqKey?: string;
  tavilyKey?: string;
}

export interface ToolCallRequest {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ProviderTurn {
  content: string | null;
  toolCalls: ToolCallRequest[];
}
