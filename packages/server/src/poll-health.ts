import { getMeta, setMeta } from "./db.js";

const HISTORY_KEY = "poll_interval_history_ms";
const LAST_POLL_KEY = "last_benchmark_poll_at";
const MAX_SAMPLES = 12;
/** Warn when age exceeds this multiple of the rolling average interval. */
const STALE_MULTIPLIER = 2;
/** Floor: never warn before this multiple of the configured poll interval. */
const CONFIG_FLOOR_MULTIPLIER = 1.5;

export interface PollHealth {
  lastPollAt: string | null;
  ageMs: number | null;
  averageIntervalMs: number | null;
  expectedIntervalMs: number;
  staleThresholdMs: number;
  stale: boolean;
  warning: string | null;
}

function parseHistory(raw: string | null): number[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr.filter((n): n is number => typeof n === "number" && n > 0).slice(-MAX_SAMPLES);
  } catch {
    return [];
  }
}

function average(nums: number[]): number | null {
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function formatDuration(ms: number): string {
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem ? `${hrs}h ${rem}m` : `${hrs}h`;
}

/**
 * Record a successful benchmark poll. Updates last-poll timestamp and
 * rolling average of intervals between successful polls.
 */
export function recordSuccessfulPoll(now = new Date()): string {
  const iso = now.toISOString();
  const prev = getMeta(LAST_POLL_KEY);
  if (prev) {
    const gap = now.getTime() - new Date(prev).getTime();
    if (gap > 0) {
      const history = parseHistory(getMeta(HISTORY_KEY));
      history.push(gap);
      setMeta(HISTORY_KEY, JSON.stringify(history.slice(-MAX_SAMPLES)));
    }
  }
  setMeta(LAST_POLL_KEY, iso);
  return iso;
}

export function getLastPollAt(): string | null {
  return getMeta(LAST_POLL_KEY);
}

/**
 * Evaluate freshness against the rolling average poll interval (fallback: configured interval).
 */
export function evaluatePollHealth(configuredPollMs: number, now = new Date()): PollHealth {
  const lastPollAt = getLastPollAt();
  const history = parseHistory(getMeta(HISTORY_KEY));
  const averageIntervalMs = average(history);
  const expectedIntervalMs = averageIntervalMs ?? configuredPollMs;
  const staleThresholdMs = Math.max(
    expectedIntervalMs * STALE_MULTIPLIER,
    configuredPollMs * CONFIG_FLOOR_MULTIPLIER,
  );

  if (!lastPollAt) {
    return {
      lastPollAt: null,
      ageMs: null,
      averageIntervalMs,
      expectedIntervalMs,
      staleThresholdMs,
      stale: false,
      warning: null,
    };
  }

  const ageMs = Math.max(0, now.getTime() - new Date(lastPollAt).getTime());
  const stale = ageMs > staleThresholdMs;
  const warning = stale
    ? `Benchmarks look stale — last update ${formatDuration(ageMs)} ago (usual cadence ~${formatDuration(expectedIntervalMs)})`
    : null;

  return {
    lastPollAt,
    ageMs,
    averageIntervalMs,
    expectedIntervalMs,
    staleThresholdMs,
    stale,
    warning,
  };
}
