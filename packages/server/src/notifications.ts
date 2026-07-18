import notifier from "node-notifier";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getNotificationPrefs, wasNotified, markNotified } from "./db.js";
import type { ChangeEvent } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// AI_PULSE_RESOURCE_DIR points at the server root (config/, assets/) in the
// packaged app; falls back to the source layout when running from dist.
const RESOURCE_DIR = process.env.AI_PULSE_RESOURCE_DIR ?? path.join(__dirname, "..");
const ICON_PATH = path.join(RESOURCE_DIR, "assets", "notification-icon.png");

export function sendNotification(title: string, message: string, eventType: ChangeEvent["type"], fingerprint?: string): void {
  const prefs = getNotificationPrefs();

  if (eventType === "high_news" && !prefs.news) return;
  if (eventType === "leader_change" && !prefs.rankings) return;
  if (eventType === "new_model" && !prefs.rankings) return;
  if (eventType === "upgrade_suggestion" && !prefs.upgrades) return;
  if (eventType === "new_video" && !prefs.news) return;

  const fp = fingerprint ?? `${eventType}:${title}:${message.slice(0, 80)}`;
  if (wasNotified(fp)) return;
  markNotified(fp);

  notifier.notify({
    title: `AI Pulse — ${title}`,
    message: message.slice(0, 200),
    icon: ICON_PATH,
    sound: false,
    wait: false,
  });
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
