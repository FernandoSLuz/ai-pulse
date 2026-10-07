import type { ChatEnv, ChatProvider } from "./types.js";
import { getLocalAIStatus } from "../local-ai/index.js";
export interface ChatModelDef { id: string; label: string; provider: ChatProvider; apiModel: string; description: string }
export function getChatModel(id: string): ChatModelDef | undefined {
  if (id !== "qwen3-local") return undefined;
  const local = getLocalAIStatus();
  return { id, label: local.model?.label ?? "Local AI", provider: "local", apiModel: local.model?.id ?? "", description: "Runs on this computer; no cloud inference" };
}
export function listAvailableModels(_env: ChatEnv): ChatModelDef[] {
  return getLocalAIStatus().state === "ready" ? [getChatModel("qwen3-local")!] : [];
}
