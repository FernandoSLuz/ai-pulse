export interface ModelRecord {
  slug: string;
  name: string;
  creator: string;
  intelligence: number;
  coding: number;
  math: number;
  priceInput: number;
  priceOutput: number;
  priceBlended: number;
  speed: number;
  latency: number;
  accessibility: string;
  accessibilityScore: number;
  fetchedAt: string;
  url?: string | null;
}

export interface NewsItem {
  id: string;
  title: string;
  link: string;
  source: string;
  publishedAt: string;
  summary: string;
  relevanceScore: number;
  category: string;
  tier?: number;
  clusterId?: string | null;
  aiPick?: boolean;
  aiPickReason?: string | null;
  aiPickPeriod?: string | null;
  aiCuratedAt?: string | null;
}

export type NewsPeriod = "hour" | "12h" | "today" | "week" | "month" | "all";

export const NEWS_PERIODS: NewsPeriod[] = ["hour", "12h", "today", "week", "month", "all"];

export function isNewsPeriod(value: string): value is NewsPeriod {
  return (NEWS_PERIODS as string[]).includes(value);
}

export interface VideoItem {
  id: string;
  title: string;
  link: string;
  channel: string;
  channelHandle: string;
  publishedAt: string;
  thumbnail: string;
  fetchedAt: string;
}

export interface CategoryWinners {
  overall: string;
  coding: string;
  math: string;
  price: string;
  speed: string;
  accessibility: string;
}

export interface RankingsSnapshot {
  models: ModelRecord[];
  winners: CategoryWinners;
  updatedAt: string;
  health?: {
    stale: boolean;
    warning: string | null;
    averageIntervalMs: number | null;
    ageMs: number | null;
  };
}

export type StackRole = "primary" | "secondary" | "free";
export type StackArea = "coding" | "writing" | "reasoning" | "general";

export interface StackEntry {
  id: string;
  modelSlug: string;
  modelName: string;
  role: StackRole;
  /** One or more use areas (e.g. coding + writing). */
  areas: StackArea[];
  /** One or more places you use this model (e.g. Cursor + Claude Code). */
  providers: string[];
  suggestedUpgradeSlug: string | null;
  suggestedUpgradeDismissed: boolean;
}

/** @deprecated Kept for migration / derived fields */
export type RecommendationMode = "best" | "followup" | "free";

export interface RoleGapSuggestion {
  role: StackRole;
  modelSlug: string;
  modelName: string;
  reason: string;
  /** Suggested default areas/providers when adding this gap fill. */
  areas: StackArea[];
  providers: string[];
}

export interface MyStackProfile {
  entries: StackEntry[];
  /** Derived from first primary entry (or first row) for widget/analyst. */
  primaryModelSlug: string;
  primaryModelName: string;
  provider: string;
  recommendationMode: RecommendationMode;
  /**
   * Prefer open/free models you can wire into Cursor for unlimited use
   * (Ollama / LM Studio / Override OpenAI Base URL) when filling the Free role.
   * DB column remains prefer_cursor_ready.
   */
  preferCursorReady: boolean;
  /** Roles the user dismissed as gap suggestions (until they add that role themselves). */
  dismissedRoleGaps: StackRole[];
  /** Computed: SOTA picks for roles missing from the stack. */
  roleGaps: RoleGapSuggestion[];
  priorityCoding: number;
  priorityReasoning: number;
  prioritySpeed: number;
  priorityCost: number;
  budgetTier: "free" | "mid" | "premium" | "unlimited";
  mustHaves: string[];
  notes: string;
  suggestedUpgradeSlug: string | null;
  suggestedUpgradeDismissed: boolean;
  updatedAt: string;
}

export interface UpgradeCandidate {
  slug: string;
  name: string;
  score: number;
  intelligenceDelta: number;
  priceDelta: number;
  reason: string;
}

export interface AnalystBriefing {
  id: number;
  headline: string;
  breaking: string[];
  watchList: string[];
  newModels: string[];
  yourStack: string;
  upgradeSuggestion: string | null;
  upgradeSlug: string | null;
  analystSource: "gemini" | "groq" | "cerebras" | "openrouter" | "ollama" | "rules";
  createdAt: string;
}

export interface ChangeEvent {
  type: "new_model" | "leader_change" | "high_news" | "upgrade_suggestion" | "manual" | "new_video";
  details: Record<string, unknown>;
}

export interface NotificationPrefs {
  news: boolean;
  rankings: boolean;
  upgrades: boolean;
}

export interface WsMessage {
  type: "rankings" | "news" | "briefing" | "stack" | "status" | "videos" | "ai_picks";
  payload: unknown;
}
