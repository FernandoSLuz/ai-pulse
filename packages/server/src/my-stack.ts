import { clearLatestBriefingUpgrade, getAllModels, getModelBySlug, getMyStack, saveMyStack, getNotifiedRoleGaps, setNotifiedRoleGaps } from "./db.js";
import type {
  ModelRecord,
  MyStackProfile,
  RoleGapSuggestion,
  StackArea,
  StackEntry,
  StackRole,
  UpgradeCandidate,
} from "./types.js";

const FREE_PRICE_MAX = 0.5;
const BETTER_MARGIN = 2; // quality points required to suggest a replacement
const ALL_ROLES: StackRole[] = ["primary", "secondary", "free"];

function isFreeOrOpen(model: ModelRecord): boolean {
  if (model.accessibilityScore >= 3) return true;
  if (model.accessibility.toLowerCase().includes("open")) return true;
  return model.priceBlended > 0 && model.priceBlended <= FREE_PRICE_MAX;
}

/**
 * Models you can wire into Cursor for free / unlimited use via a custom OpenAI-compatible
 * endpoint (Ollama, LM Studio, etc.) — open weights or near-free open APIs.
 * Not Cursor's built-in paid catalog.
 */
function isCursorFreeUnlimited(model: ModelRecord): boolean {
  const acc = model.accessibility.toLowerCase();
  if (model.accessibilityScore >= 3) return true; // Open / Gated weights
  if (acc.includes("open")) return true;
  // Near-free API that can still be pointed at via Override Base URL
  if (model.priceBlended > 0 && model.priceBlended <= FREE_PRICE_MAX) return true;
  return false;
}

/** Prefer free-unlimited Cursor-wireable models when the preference is on. */
function preferFreeUnlimitedPool(models: ModelRecord[], prefer: boolean): ModelRecord[] {
  if (!prefer) return models;
  const free = models.filter(isCursorFreeUnlimited);
  return free.length >= 3 ? free : models;
}

function areaScore(model: ModelRecord, area: StackArea): number {
  switch (area) {
    case "coding":
      return model.coding * 0.7 + model.intelligence * 0.3;
    case "writing":
      return model.intelligence * 0.8 + model.coding * 0.2;
    case "reasoning":
      return model.intelligence * 0.85 + model.coding * 0.15;
    case "general":
    default:
      return model.intelligence * 0.65 + model.coding * 0.35;
  }
}

/** Average quality across all selected areas for this entry. */
function entryScore(model: ModelRecord, areas: StackArea[]): number {
  const list = areas.length ? areas : (["coding"] as StackArea[]);
  return list.reduce((sum, area) => sum + areaScore(model, area), 0) / list.length;
}

function toCandidate(
  model: ModelRecord,
  current: ModelRecord | null,
  areas: StackArea[],
  reason: string,
): UpgradeCandidate {
  return {
    slug: model.slug,
    name: model.name,
    score: entryScore(model, areas),
    intelligenceDelta: current ? model.intelligence - current.intelligence : model.intelligence,
    priceDelta: current ? model.priceBlended - current.priceBlended : model.priceBlended,
    reason,
  };
}

function recommendForEntry(
  models: ModelRecord[],
  entry: StackEntry,
  preferFreeUnlimited: boolean,
): UpgradeCandidate | null {
  if (!entry.modelSlug) return null;

  const areas = entry.areas?.length ? entry.areas : (["coding"] as StackArea[]);
  const current =
    getModelBySlug(entry.modelSlug) ?? models.find((m) => m.slug === entry.modelSlug) ?? null;
  if (!current) return null;

  const currentScore = entryScore(current, areas);
  // Free-unlimited preference only shapes the Free role (local / custom endpoint in Cursor).
  let pool =
    entry.role === "free"
      ? preferFreeUnlimitedPool(models, preferFreeUnlimited)
      : models;
  pool = pool.filter((m) => m.slug !== current.slug);

  if (entry.role === "free") {
    pool = pool.filter(isFreeOrOpen);
  } else if (entry.role === "secondary") {
    const cap = current.priceBlended > 0 ? current.priceBlended * 0.85 : 5;
    pool = pool.filter((m) => m.priceBlended > 0 && m.priceBlended <= cap);
  }

  pool.sort((a, b) => entryScore(b, areas) - entryScore(a, areas));
  const best = pool[0];
  if (!best) return null;

  const bestScore = entryScore(best, areas);
  if (bestScore < currentScore + BETTER_MARGIN) return null;

  const roleLabel =
    entry.role === "primary" ? "primary" : entry.role === "secondary" ? "budget follow-up" : "free";
  const areaLabel = areas.join("+");
  return toCandidate(
    best,
    current,
    areas,
    `Better ${areaLabel} ${roleLabel}: ${current.name} → ${best.name}`,
  );
}

function pickSotaForRole(
  models: ModelRecord[],
  role: StackRole,
  areas: StackArea[],
  preferFreeUnlimited: boolean,
  excludeSlugs: Set<string>,
): ModelRecord | null {
  // Only the Free role uses the "wire into Cursor for free" pool.
  let pool =
    role === "free"
      ? preferFreeUnlimitedPool(models, preferFreeUnlimited)
      : models;
  pool = pool.filter((m) => !excludeSlugs.has(m.slug));

  if (role === "free") {
    pool = pool.filter(isFreeOrOpen);
  } else if (role === "secondary") {
    // Budget SOTA: strong models under a mid-tier price ceiling
    pool = pool.filter((m) => m.priceBlended > 0 && m.priceBlended <= 5);
  }

  pool.sort((a, b) => entryScore(b, areas) - entryScore(a, areas));
  return pool[0] ?? null;
}

/**
 * For any role the user hasn't configured, suggest the current SOTA for that role.
 * For Free, prefers open/local models you can run unlimited via Cursor's custom endpoint.
 */
export function findRoleGaps(
  models: ModelRecord[],
  profile: MyStackProfile,
): RoleGapSuggestion[] {
  const present = new Set(
    profile.entries.filter((e) => e.modelSlug).map((e) => e.role),
  );
  const dismissed = new Set(profile.dismissedRoleGaps ?? []);
  const usedSlugs = new Set(profile.entries.map((e) => e.modelSlug).filter(Boolean));

  // Infer areas from existing stack (default coding)
  const areasFromStack = [
    ...new Set(profile.entries.flatMap((e) => e.areas ?? [])),
  ] as StackArea[];
  const defaultAreas: StackArea[] = areasFromStack.length ? areasFromStack : ["coding"];

  const gaps: RoleGapSuggestion[] = [];
  for (const role of ALL_ROLES) {
    if (present.has(role) || dismissed.has(role)) continue;
    const preferFree = profile.preferCursorReady !== false;
    const pick = pickSotaForRole(models, role, defaultAreas, preferFree, usedSlugs);
    if (!pick) continue;
    usedSlugs.add(pick.slug);

    const isFreeWireable = role === "free" && preferFree && isCursorFreeUnlimited(pick);
    const providers = isFreeWireable ? ["Cursor (Ollama/custom)"] : ["Cursor"];
    gaps.push({
      role,
      modelSlug: pick.slug,
      modelName: pick.name,
      areas: defaultAreas,
      providers,
      reason:
        role === "free"
          ? `Missing Free option — try ${pick.name} (open/local, unlimited via Cursor custom endpoint)`
          : `Missing ${ROLE_LABELS[role]} — SOTA pick: ${pick.name}`,
    });
  }
  return gaps;
}

/** Evaluate entries + missing roles; only suggest when meaningfully better / gap exists. */
export function updateStackSuggestion(models: ModelRecord[]): {
  profile: MyStackProfile;
  newlySuggested: { entry: StackEntry; candidate: UpgradeCandidate }[];
  newRoleGaps: RoleGapSuggestion[];
} {
  const profile = getMyStack();
  const preferCursor = profile.preferCursorReady !== false;
  const newlySuggested: { entry: StackEntry; candidate: UpgradeCandidate }[] = [];
  const prevGaps = new Set(getNotifiedRoleGaps());

  const entries = profile.entries.map((entry) => {
    if (!entry.modelSlug) {
      return { ...entry, suggestedUpgradeSlug: null };
    }
    if (entry.suggestedUpgradeDismissed) {
      return entry;
    }

    const candidate = recommendForEntry(models, entry, preferCursor);
    if (!candidate) {
      return { ...entry, suggestedUpgradeSlug: null };
    }

    const prev = entry.suggestedUpgradeSlug;
    if (prev !== candidate.slug) {
      newlySuggested.push({ entry: { ...entry, suggestedUpgradeSlug: candidate.slug }, candidate });
    }
    return { ...entry, suggestedUpgradeSlug: candidate.slug, suggestedUpgradeDismissed: false };
  });

  // Clear dismissed gaps for roles the user has now added
  const presentRoles = new Set(entries.filter((e) => e.modelSlug).map((e) => e.role));
  const dismissedRoleGaps = (profile.dismissedRoleGaps ?? []).filter((r) => !presentRoles.has(r));

  const saved = saveMyStack({ entries, dismissedRoleGaps });
  const roleGaps = findRoleGaps(models, { ...saved, dismissedRoleGaps });
  const newRoleGaps = roleGaps.filter((g) => !prevGaps.has(`${g.role}:${g.modelSlug}`));
  if (newRoleGaps.length > 0) {
    const next = [...prevGaps, ...newRoleGaps.map((g) => `${g.role}:${g.modelSlug}`)];
    setNotifiedRoleGaps(next);
  }

  return {
    profile: { ...saved, roleGaps },
    newlySuggested,
    newRoleGaps,
  };
}

export function addRoleGapToStack(role: StackRole, models: ModelRecord[]): MyStackProfile {
  const profile = getMyStack();
  const gaps = findRoleGaps(models, profile);
  const gap = gaps.find((g) => g.role === role);
  if (!gap) return { ...profile, roleGaps: gaps };

  const entry: StackEntry = {
    id: `e_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    modelSlug: gap.modelSlug,
    modelName: gap.modelName,
    role: gap.role,
    areas: gap.areas,
    providers: gap.providers,
    suggestedUpgradeSlug: null,
    suggestedUpgradeDismissed: false,
  };
  const entries = [...profile.entries, entry];
  const dismissedRoleGaps = (profile.dismissedRoleGaps ?? []).filter((r) => r !== role);
  const saved = saveMyStack({ entries, dismissedRoleGaps });
  return { ...saved, roleGaps: findRoleGaps(models, saved) };
}

export function dismissRoleGap(role: StackRole, models: ModelRecord[]): MyStackProfile {
  const profile = getMyStack();
  const dismissedRoleGaps = [...new Set([...(profile.dismissedRoleGaps ?? []), role])];
  const saved = saveMyStack({ dismissedRoleGaps });
  return { ...saved, roleGaps: findRoleGaps(models, saved) };
}

export function applyEntrySuggestion(entryId: string): MyStackProfile {
  const profile = getMyStack();
  const entries = profile.entries.map((e) => {
    if (e.id !== entryId || !e.suggestedUpgradeSlug) return e;
    const model = getModelBySlug(e.suggestedUpgradeSlug);
    return {
      ...e,
      modelSlug: e.suggestedUpgradeSlug,
      modelName: model?.name ?? e.suggestedUpgradeSlug,
      suggestedUpgradeSlug: null,
      suggestedUpgradeDismissed: false,
    };
  });
  clearLatestBriefingUpgrade();
  const saved = saveMyStack({ entries });
  return { ...saved, roleGaps: findRoleGaps(getAllModels(), saved) };
}

export function dismissEntrySuggestion(entryId: string): MyStackProfile {
  const profile = getMyStack();
  const entries = profile.entries.map((e) =>
    e.id === entryId
      ? { ...e, suggestedUpgradeSlug: null, suggestedUpgradeDismissed: true }
      : e,
  );
  clearLatestBriefingUpgrade();
  const saved = saveMyStack({ entries });
  return { ...saved, roleGaps: findRoleGaps(getAllModels(), saved) };
}

/** Legacy: apply first pending suggestion (briefing banner). */
export function applyUpgradeSuggestion(): MyStackProfile {
  const profile = getMyStack();
  const pending = profile.entries.find((e) => e.suggestedUpgradeSlug && !e.suggestedUpgradeDismissed);
  if (!pending) {
    clearLatestBriefingUpgrade();
    return profile;
  }
  return applyEntrySuggestion(pending.id);
}

export function dismissUpgradeSuggestion(): MyStackProfile {
  const profile = getMyStack();
  const pending = profile.entries.find((e) => e.suggestedUpgradeSlug && !e.suggestedUpgradeDismissed);
  clearLatestBriefingUpgrade();
  if (!pending) return saveMyStack({ entries: profile.entries });
  return dismissEntrySuggestion(pending.id);
}

/** Analyst helper — upgrades + missing-role SOTA fills. */
export function findUpgradeCandidates(
  models: ModelRecord[],
  profile: MyStackProfile,
): UpgradeCandidate[] {
  const preferCursor = profile.preferCursorReady !== false;
  const out: UpgradeCandidate[] = [];
  for (const entry of profile.entries) {
    if (!entry.modelSlug || entry.suggestedUpgradeDismissed) continue;
    const c = recommendForEntry(models, entry, preferCursor);
    if (c) out.push(c);
  }
  for (const gap of findRoleGaps(models, profile)) {
    out.push({
      slug: gap.modelSlug,
      name: gap.modelName,
      score: 0,
      intelligenceDelta: 0,
      priceDelta: 0,
      reason: gap.reason,
    });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 5);
}

export function createEmptyEntry(): StackEntry {
  return {
    id: `e_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    modelSlug: "",
    modelName: "",
    role: "primary",
    areas: ["coding"],
    providers: ["Cursor"],
    suggestedUpgradeSlug: null,
    suggestedUpgradeDismissed: false,
  };
}

export const ROLE_LABELS: Record<StackRole, string> = {
  primary: "Primary hard tasks",
  secondary: "Secondary budget hard tasks",
  free: "Free option",
};

export const AREA_LABELS: Record<StackArea, string> = {
  coding: "Coding",
  writing: "Writing",
  reasoning: "Reasoning",
  general: "General",
};
