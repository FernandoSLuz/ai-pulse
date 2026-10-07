import type { Express, Request, Response } from "express";
import {
  deleteYouTubeUserChannel,
  deleteYouTubeVideos,
  getYouTubeUserChannels,
  saveYouTubeUserChannel,
} from "../db.js";
import {
  getConfiguredYouTubeChannels,
  resolveYouTubeChannel,
} from "../fetchers/youtube-channels.js";
import { upsertVideos } from "../db.js";

type Kind = "creator" | "company";
const MAX_USER_CHANNELS = 100;

function parseKind(value: unknown): Kind | null {
  return value === "company" ? "company" : value === "creator" ? "creator" : null;
}

function channelsFor(kind: Kind) {
  return getConfiguredYouTubeChannels(kind).map((channel) => ({
    channelId: channel.channelId,
    name: channel.name,
    handle: channel.handle,
    channelUrl: channel.channelUrl ?? `https://www.youtube.com/channel/${channel.channelId}`,
    kind,
    source: channel.source === "user" ? "user" : "default",
  }));
}

function sendError(res: Response, error: unknown): void {
  const message = error instanceof Error ? error.message : "Could not resolve the YouTube channel.";
  res.status(400).json({ error: message });
}

export function registerYouTubeChannelRoutes(app: Express): void {
  app.get("/api/videos/channels", (req, res) => {
    const queryKind = req.query.kind;
    if (queryKind !== undefined && !parseKind(queryKind)) {
      res.status(400).json({ error: "kind must be creator or company" });
      return;
    }
    const kinds: Kind[] = queryKind ? [parseKind(queryKind)!] : ["creator", "company"];
    res.json({ channels: kinds.flatMap(channelsFor) });
  });

  app.post("/api/videos/channels", async (req: Request, res: Response) => {
    const input = typeof req.body?.input === "string" ? req.body.input : "";
    const kind = parseKind(req.body?.kind);
    if (!kind || !input.trim()) {
      res.status(400).json({ error: "input and kind (creator or company) are required" });
      return;
    }
    if (getYouTubeUserChannels().length >= MAX_USER_CHANNELS) {
      res.status(409).json({ error: "The maximum number of followed YouTube channels has been reached." });
      return;
    }
    try {
      const resolved = await resolveYouTubeChannel(input, kind);
      const duplicate = ["creator", "company"]
        .flatMap((channelKind) => getConfiguredYouTubeChannels(channelKind as Kind))
        .some((channel) => channel.channelId === resolved.channelId);
      if (duplicate) {
        res.status(409).json({ error: "That YouTube channel is already followed.", channels: channelsFor(kind) });
        return;
      }
      if (getYouTubeUserChannels().length >= MAX_USER_CHANNELS) {
        res.status(409).json({ error: "The maximum number of followed YouTube channels has been reached." });
        return;
      }
      const { initialVideos, ...channelToSave } = resolved;
      const addedChannel = saveYouTubeUserChannel(channelToSave);
      try {
        const stillFollowed = getYouTubeUserChannels(kind).some((channel) => channel.channelId === resolved.channelId);
        if (stillFollowed) upsertVideos(initialVideos);
      } catch (error) {
        // The channel was already validated by RSS. A later transient fetch
        // failure should not discard the user's subscription.
        console.warn("[YouTube] Initial channel fetch failed:", (error as Error).message);
      }
      res.status(201).json({ channels: ["creator", "company"].flatMap((value) => channelsFor(value as Kind)), addedChannel });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.delete("/api/videos/channels/:channelId", (req, res) => {
    const kind = parseKind(req.query.kind);
    const channelId = req.params.channelId;
    if (!kind || !/^UC[A-Za-z0-9_-]{22}$/.test(channelId)) {
      res.status(400).json({ error: "A valid channelId and kind (creator or company) are required" });
      return;
    }
    const channel = getYouTubeUserChannels(kind).find((item) => item.channelId === channelId);
    if (!channel || !deleteYouTubeUserChannel(channelId, kind)) {
      res.status(404).json({ error: "User channel not found." });
      return;
    }
    const stillDefault = getConfiguredYouTubeChannels(kind).some((item) => item.channelId === channelId && item.source === "default");
    if (!stillDefault) deleteYouTubeVideos(channelId, channel.handle, kind);
    res.json({ channels: ["creator", "company"].flatMap((value) => channelsFor(value as Kind)), removedChannel: channel });
  });
}
