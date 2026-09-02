import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import notifier from "node-notifier";
import { getNotificationPrefs, wasNotified, markNotified } from "./db.js";
import type { ChangeEvent } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// AI_PULSE_RESOURCE_DIR points at the server root (config/, assets/) in the
// packaged app; falls back to the source layout when running from dist.
const RESOURCE_DIR = process.env.AI_PULSE_RESOURCE_DIR ?? path.join(__dirname, "..");
// RGBA glyph with a transparent background (see packages/widget/scripts/make-icons.mjs).
// Must stay an absolute path: Omarchy's notification daemon treats anything
// that does not start with "/" as a theme icon name.
const ICON_PATH = path.join(RESOURCE_DIR, "assets", "notification-icon-128.png");
const APP_NAME = "AI Pulse";
const LINUX_TIMEOUT_MS = 8000;

type Urgency = "low" | "normal" | "critical";

function urgencyFor(eventType: ChangeEvent["type"]): Urgency {
  return eventType === "new_video" ? "low" : "normal";
}

/** Remove control characters and collapse whitespace; titles come from remote feeds. */
function plainText(text: string, max: number): string {
  return text
    .replace(/[\x00-\x1f\x7f-\x9f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** The notification body is Pango markup on freedesktop daemons — escape it. */
function escapeMarkup(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Deliver one desktop notification. Linux calls notify-send directly through
 * execFile (no shell, so a feed title cannot inject commands; "--" stops it
 * from being parsed as an option). Other platforms keep node-notifier.
 */
function deliver(title: string, message: string, urgency: Urgency): Promise<void> {
  if (process.platform === "linux") {
    return new Promise((resolve, reject) => {
      execFile(
        "notify-send",
        ["-a", APP_NAME, "-i", ICON_PATH, "-u", urgency, "-t", String(LINUX_TIMEOUT_MS), "--", title, escapeMarkup(message)],
        { timeout: 5000 },
        (err) => (err ? reject(err) : resolve()),
      );
    });
  }
  return new Promise((resolve, reject) => {
    notifier.notify({ title, message, icon: ICON_PATH, sound: false, wait: false }, (err) =>
      err ? reject(err instanceof Error ? err : new Error(String(err))) : resolve(),
    );
  });
}

// Fingerprints with a delivery in flight, so a burst of identical events
// can't double-notify before the first one is recorded.
const inFlight = new Set<string>();

export function sendNotification(title: string, message: string, eventType: ChangeEvent["type"], fingerprint?: string): void {
  const prefs = getNotificationPrefs();

  if (eventType === "high_news" && !prefs.news) return;
  if (eventType === "leader_change" && !prefs.rankings) return;
  if (eventType === "new_model" && !prefs.rankings) return;
  if (eventType === "upgrade_suggestion" && !prefs.upgrades) return;
  if (eventType === "new_video" && !prefs.news) return;

  const fp = fingerprint ?? `${eventType}:${title}:${message.slice(0, 80)}`;
  if (wasNotified(fp) || inFlight.has(fp)) return;
  inFlight.add(fp);

  const summary = plainText(`${APP_NAME} — ${title}`, 120);
  const body = plainText(message, 200);

  // Only record the fingerprint once the notification actually went out, so a
  // missing notify-send or a dead daemon doesn't silently swallow it forever.
  deliver(summary, body, urgencyFor(eventType))
    .then(() => markNotified(fp))
    .catch((err: Error) => console.warn(`[Notify] delivery failed (${eventType}): ${err.message}`))
    .finally(() => inFlight.delete(fp));
}

export function notifyFromEvent(event: ChangeEvent, models?: { name: string; slug: string }[]): void {
  switch (event.type) {
    case "new_model": {
      const slugs = (event.details.slugs as string[]) ?? [];
      for (const slug of slugs.slice(0, 3)) {
        const name = models?.find((m) => m.slug === slug)?.name ?? slug;
        sendNotification("New Model", `New model detected: ${name}`, event.type, `new_model:${slug}`);
      }
      break;
    }
    case "leader_change": {
      const changes = (event.details.changes as string[]) ?? [];
      const key = `leader_change:${changes.join("|")}`;
      sendNotification("Leader Change", changes.join("; "), event.type, key);
      break;
    }
    case "high_news": {
      const title = (event.details.title as string) ?? "Breaking AI news";
      const source = (event.details.source as string) ?? "";
      const id = (event.details.id as string) ?? title;
      sendNotification("Breaking News", `${title} (${source})`, event.type, `high_news:${id}`);
      break;
    }
    case "upgrade_suggestion": {
      const msg = (event.details.message as string) ?? "A better model match was found for your stack.";
      const key = (event.details.fingerprint as string) ?? `upgrade:${msg.slice(0, 100)}`;
      sendNotification("Upgrade Suggestion", msg, event.type, key);
      break;
    }
    case "new_video": {
      const title = (event.details.title as string) ?? "New video";
      const channel = (event.details.channel as string) ?? "";
      const id = (event.details.id as string) ?? title;
      sendNotification("Creator Update", `${channel}: ${title}`, event.type, `new_video:${id}`);
      break;
    }
  }
}
