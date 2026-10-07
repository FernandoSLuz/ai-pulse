import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { normalizeUrl, dedupeByCredibility, hasAiSubject, scoreRelevance } from "./fetchers/rss-aggregator.js";
import type {
  AnalystBriefing,
  ModelRecord,
  MyStackProfile,
  NewsItem,
  NewsPeriod,
  NotificationPrefs,
  StackArea,
  StackEntry,
  StackRole,
  VideoItem,
  SocialProfile,
  SocialPost,
} from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The desktop app runs the server from inside a read-only bundle, so the DB
// must live in a writable per-user data dir it passes via AI_PULSE_DATA_DIR.
// Running the server standalone falls back to packages/server/data.
const dataDir = process.env.AI_PULSE_DATA_DIR
  ? path.resolve(process.env.AI_PULSE_DATA_DIR)
  : path.join(__dirname, "..", "data");
const dbPath = path.join(dataDir, "ai-pulse.db");

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    fs.mkdirSync(dataDir, { recursive: true });
    db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("busy_timeout = 5000");
    initSchema(db);
  }
  return db;
}

function initSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS models (
      slug TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      creator TEXT,
      intelligence REAL,
      coding REAL,
      math REAL,
      price_input REAL,
      price_output REAL,
      price_blended REAL,
      speed REAL,
      latency REAL,
      accessibility TEXT,
      accessibility_score REAL,
      license TEXT,
      license_url TEXT,
      weights_url TEXT,
      price_source_url TEXT,
      fetched_at TEXT
    );

    CREATE TABLE IF NOT EXISTS news (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      link TEXT,
      source TEXT,
      published_at TEXT,
      summary TEXT,
      relevance_score REAL,
      category TEXT,
      fetched_at TEXT
    );

    CREATE TABLE IF NOT EXISTS news_ai_picks (
      news_id TEXT NOT NULL,
      period TEXT NOT NULL,
      reason TEXT NOT NULL,
      curated_at TEXT NOT NULL,
      PRIMARY KEY (news_id, period),
      FOREIGN KEY (news_id) REFERENCES news(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS user_stack (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      primary_model_slug TEXT,
      primary_model_name TEXT,
      provider TEXT,
      priority_coding INTEGER DEFAULT 40,
      priority_reasoning INTEGER DEFAULT 30,
      priority_speed INTEGER DEFAULT 20,
      priority_cost INTEGER DEFAULT 10,
      budget_tier TEXT DEFAULT 'mid',
      must_haves TEXT DEFAULT '[]',
      notes TEXT DEFAULT '',
      suggested_upgrade_slug TEXT,
      suggested_upgrade_dismissed INTEGER DEFAULT 0,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS analyst_briefings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      headline TEXT,
      breaking TEXT,
      watch_list TEXT,
      new_models TEXT,
      your_stack TEXT,
      upgrade_suggestion TEXT,
      upgrade_slug TEXT,
      analyst_source TEXT,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS notification_prefs (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      news INTEGER DEFAULT 1,
      rankings INTEGER DEFAULT 1,
      upgrades INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS notified_events (
      fingerprint TEXT PRIMARY KEY,
      notified_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS videos (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      link TEXT,
      channel TEXT,
      channel_handle TEXT,
      published_at TEXT,
      thumbnail TEXT,
      kind TEXT DEFAULT 'creator',
      fetched_at TEXT
    );

    CREATE TABLE IF NOT EXISTS social_profiles (
      handle TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      user_id TEXT,
      profile_url TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'user',
      enabled INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS social_posts (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL,
      author_handle TEXT NOT NULL,
      author_name TEXT NOT NULL,
      url TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'x-api',
      fetched_at TEXT NOT NULL
    );
  `);

  migrateNewsColumns(database);
  migrateVideoColumns(database);
  migrateModelColumns(database);

  const stack = database.prepare("SELECT id FROM user_stack WHERE id = 1").get();
  if (!stack) {
    database.prepare(`
      INSERT INTO user_stack (id, primary_model_slug, primary_model_name, provider, updated_at)
      VALUES (1, '', '', 'Cursor', datetime('now'))
    `).run();
  }

  const prefs = database.prepare("SELECT id FROM notification_prefs WHERE id = 1").get();
  if (!prefs) {
    database.prepare("INSERT INTO notification_prefs (id) VALUES (1)").run();
  }

  const stackCols = database.prepare("PRAGMA table_info(user_stack)").all() as { name: string }[];
  if (!stackCols.some((c) => c.name === "recommendation_mode")) {
    database.exec(`ALTER TABLE user_stack ADD COLUMN recommendation_mode TEXT DEFAULT 'best'`);
  }
  if (!stackCols.some((c) => c.name === "entries")) {
    database.exec(`ALTER TABLE user_stack ADD COLUMN entries TEXT DEFAULT '[]'`);
  }
  const stackCols2 = database.prepare("PRAGMA table_info(user_stack)").all() as { name: string }[];
  if (!stackCols2.some((c) => c.name === "prefer_cursor_ready")) {
    database.exec(`ALTER TABLE user_stack ADD COLUMN prefer_cursor_ready INTEGER DEFAULT 1`);
  }
  if (!stackCols2.some((c) => c.name === "dismissed_role_gaps")) {
    database.exec(`ALTER TABLE user_stack ADD COLUMN dismissed_role_gaps TEXT DEFAULT '[]'`);
  }
}

function migrateModelColumns(database: Database.Database): void {
  const cols = database.prepare("PRAGMA table_info(models)").all() as { name: string }[];
  const names = new Set(cols.map((c) => c.name));
  const add = (name: string, ddl: string) => { if (!names.has(name)) database.exec(`ALTER TABLE models ADD COLUMN ${ddl}`); };
  add("license", "license TEXT");
  add("license_url", "license_url TEXT");
  add("weights_url", "weights_url TEXT");
  add("price_source_url", "price_source_url TEXT");
  // Rows written before source provenance existed cannot safely retain a
  // zero-as-free or stale price. A fresh AA poll repopulates them.
  if (!database.prepare("SELECT value FROM meta WHERE key = 'model_evidence_v2'").get()) {
    database.transaction(() => {
      database.prepare("UPDATE models SET price_input = NULL, price_output = NULL, price_blended = NULL WHERE price_source_url IS NULL").run();
      // Older releases inferred access without retaining source evidence.
      // Fresh polls restore verified labels; unknown is safer while offline.
      database.prepare(`UPDATE models SET accessibility = 'Unknown', accessibility_score = 0,
        license = NULL, license_url = NULL, weights_url = NULL`).run();
      database.prepare("INSERT INTO meta(key,value) VALUES('model_evidence_v2',?)").run(new Date().toISOString());
    })();
  }
}

export function getSocialProfiles(includeDisabled = false): SocialProfile[] {
  coalesceSocialProfileHandles();
  const rows = getDb().prepare(`SELECT * FROM social_profiles ${includeDisabled ? "" : "WHERE enabled = 1"} ORDER BY source, name`).all() as Record<string, unknown>[];
  return rows.map((r) => ({
    handle: String(r.handle), name: String(r.name), description: (r.description as string) || undefined,
    userId: (r.user_id as string) || undefined, profileUrl: String(r.profile_url),
    source: r.source === "default" ? "default" : "user", enabled: Boolean(r.enabled),
  }));
}

function coalesceSocialProfileHandles(): void {
  const database = getDb();
  const rows = database.prepare("SELECT rowid, * FROM social_profiles ORDER BY enabled DESC, source DESC, updated_at DESC").all() as Array<Record<string, unknown> & { rowid: number }>;
  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = String(row.handle).trim().replace(/^@/, "").toLowerCase();
    if (!key) continue;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  const tx = database.transaction(() => {
    for (const [handle, group] of groups) {
      const winner = group[0];
      if (group.length === 1 && winner.handle === handle) continue;
      for (const duplicate of group.slice(1)) database.prepare("DELETE FROM social_profiles WHERE rowid = ?").run(duplicate.rowid);
      database.prepare(`UPDATE social_profiles SET handle = ?, name = ?, description = ?, user_id = ?, profile_url = ?, source = ?, enabled = ?, updated_at = ? WHERE rowid = ?`).run(
        handle,
        winner.name,
        winner.description ?? null,
        winner.user_id ?? null,
        winner.profile_url,
        winner.source,
        winner.enabled,
        winner.updated_at,
        winner.rowid,
      );
    }
  });
  tx();
}

export function upsertSocialProfiles(profiles: SocialProfile[]): void {
  coalesceSocialProfileHandles();
  const stmt = getDb().prepare(`INSERT INTO social_profiles (handle,name,description,user_id,profile_url,source,enabled,updated_at)
    VALUES (@handle,@name,@description,@userId,@profileUrl,@source,@enabled,@updatedAt)
    ON CONFLICT(handle) DO UPDATE SET name=excluded.name, description=excluded.description, user_id=excluded.user_id,
      profile_url=excluded.profile_url, source=excluded.source, enabled=excluded.enabled, updated_at=excluded.updated_at`);
  const now = new Date().toISOString();
  const tx = getDb().transaction((items: SocialProfile[]) => items.forEach((p) => {
    const handle = p.handle.trim().replace(/^@/, "").toLowerCase();
    const existing = getDb().prepare("SELECT rowid FROM social_profiles WHERE lower(handle) = ? LIMIT 1").get(handle) as { rowid: number } | undefined;
    if (existing) {
      getDb().prepare(`UPDATE social_profiles SET handle = ?, name = ?, description = ?, user_id = ?, profile_url = ?, source = ?, enabled = ?, updated_at = ? WHERE rowid = ?`).run(
        handle, p.name, p.description ?? null, p.userId ?? null, p.profileUrl, p.source, p.enabled ? 1 : 0, now, existing.rowid,
      );
    } else {
      stmt.run({ ...p, handle, description: p.description ?? null, userId: p.userId ?? null, enabled: p.enabled ? 1 : 0, updatedAt: now });
    }
  }));
  tx(profiles);
}

export function deleteSocialProfile(handle: string): boolean {
  return getDb().prepare("UPDATE social_profiles SET enabled = 0, updated_at = ? WHERE lower(handle) = lower(?)").run(new Date().toISOString(), handle.trim().replace(/^@/, "")).changes > 0;
}

export function getSocialPosts(limit = 100): SocialPost[] {
  const rows = getDb().prepare(`SELECT s.* FROM social_posts s JOIN social_profiles p
    ON lower(p.handle) = lower(s.author_handle) AND p.enabled = 1
    ORDER BY julianday(s.created_at) DESC LIMIT ?`).all(Math.min(200, Math.max(1, Math.floor(limit) || 100))) as Record<string, unknown>[];
  return rows.map((r) => ({ id: String(r.id), text: String(r.text), createdAt: String(r.created_at), authorHandle: String(r.author_handle), authorName: String(r.author_name), url: String(r.url), source: "x-api" }));
}

export function replaceSocialPosts(posts: SocialPost[], fetchedAt = new Date().toISOString()): void {
  const stmt = getDb().prepare(`INSERT INTO social_posts (id,text,created_at,author_handle,author_name,url,source,fetched_at)
    VALUES (@id,@text,@createdAt,@authorHandle,@authorName,@url,'x-api',@fetchedAt)
    ON CONFLICT(id) DO UPDATE SET text=excluded.text, created_at=excluded.created_at, author_handle=excluded.author_handle,
      author_name=excluded.author_name, url=excluded.url, fetched_at=excluded.fetched_at`);
  const tx = getDb().transaction((items: SocialPost[]) => items.forEach((p) => stmt.run({ ...p, authorHandle: p.authorHandle.trim().replace(/^@/, "").toLowerCase(), fetchedAt })));
  tx(posts);
  getDb().prepare("DELETE FROM social_posts WHERE julianday(fetched_at) < julianday('now','-30 days')").run();
}

function migrateNewsColumns(database: Database.Database): void {
  const cols = database.prepare("PRAGMA table_info(news)").all() as { name: string }[];
  const names = new Set(cols.map((c) => c.name));
  const add = (name: string, ddl: string) => {
    if (!names.has(name)) database.exec(`ALTER TABLE news ADD COLUMN ${ddl}`);
  };
  add("tier", "tier INTEGER DEFAULT 99");
  add("cluster_id", "cluster_id TEXT");
  add("ai_pick", "ai_pick INTEGER DEFAULT 0");
  add("ai_pick_reason", "ai_pick_reason TEXT");
  add("ai_pick_period", "ai_pick_period TEXT");
  add("ai_curated_at", "ai_curated_at TEXT");
  add("canonical_url", "canonical_url TEXT");
  const rows = database.prepare("SELECT id, link, canonical_url FROM news WHERE canonical_url IS NULL OR canonical_url = ''").all() as { id: string; link: string }[];
  const update = database.prepare("UPDATE news SET canonical_url = ? WHERE id = ?");
  for (const row of rows) {
    const canonical = canonicalNewsUrl(row.link);
    if (canonical) update.run(canonical, row.id);
  }
  if (!database.prepare("SELECT value FROM meta WHERE key = 'news_picks_v2'").get()) {
    database.exec(`INSERT OR IGNORE INTO news_ai_picks (news_id, period, reason, curated_at)
      SELECT id, COALESCE(ai_pick_period, 'all'), COALESCE(ai_pick_reason, ''), COALESCE(ai_curated_at, datetime('now'))
      FROM news WHERE ai_pick = 1`);
    database.prepare("INSERT INTO meta(key,value) VALUES('news_picks_v2','1')").run();
  }
}

function canonicalNewsUrl(value: string): string { return normalizeUrl(value); }

function canonicalNewsId(value: string): string {
  return createHash("sha256").update(canonicalNewsUrl(value)).digest("hex");
}

function migrateVideoColumns(database: Database.Database): void {
  const cols = database.prepare("PRAGMA table_info(videos)").all() as { name: string }[];
  const names = new Set(cols.map((c) => c.name));
  const add = (name: string, ddl: string) => {
    if (!names.has(name)) database.exec(`ALTER TABLE videos ADD COLUMN ${ddl}`);
  };
  add("kind", "kind TEXT DEFAULT 'creator'");
}

function periodSince(period?: NewsPeriod): string | null {
  if (!period || period === "all") return null;
  const now = Date.now();
  const ms =
    period === "hour"
      ? 60 * 60 * 1000
      : period === "12h"
        ? 12 * 60 * 60 * 1000
        : period === "today"
          ? 24 * 60 * 60 * 1000
          : period === "week"
            ? 7 * 24 * 60 * 60 * 1000
            : 30 * 24 * 60 * 60 * 1000;
  return new Date(now - ms).toISOString();
}

export function upsertModels(models: ModelRecord[]): string[] {
  const database = getDb();
  const existing = new Set(
    (database.prepare("SELECT slug FROM models").all() as { slug: string }[]).map((r) => r.slug)
  );
  const newSlugs: string[] = [];

  const stmt = database.prepare(`
    INSERT INTO models (slug, name, creator, intelligence, coding, math, price_input, price_output,
      price_blended, speed, latency, accessibility, accessibility_score, license, license_url, weights_url, price_source_url, fetched_at)
    VALUES (@slug, @name, @creator, @intelligence, @coding, @math, @priceInput, @priceOutput,
      @priceBlended, @speed, @latency, @accessibility, @accessibilityScore, @license, @licenseUrl, @weightsUrl, @priceSourceUrl, @fetchedAt)
    ON CONFLICT(slug) DO UPDATE SET
      name = excluded.name, creator = excluded.creator, intelligence = excluded.intelligence,
      coding = excluded.coding, math = excluded.math, price_input = excluded.price_input,
      price_output = excluded.price_output, price_blended = excluded.price_blended,
      speed = excluded.speed, latency = excluded.latency, accessibility = excluded.accessibility,
      accessibility_score = excluded.accessibility_score, license = excluded.license,
      license_url = excluded.license_url, weights_url = excluded.weights_url, fetched_at = excluded.fetched_at
      ,price_source_url = excluded.price_source_url
  `);

  const tx = database.transaction((items: ModelRecord[]) => {
    for (const m of items) {
      if (!existing.has(m.slug)) newSlugs.push(m.slug);
      stmt.run(m);
    }
  });
  tx(models);
  return newSlugs;
}

export function getAllModels(): ModelRecord[] {
  const rows = getDb().prepare("SELECT * FROM models ORDER BY intelligence DESC").all() as Record<string, unknown>[];
  return rows.map(rowToModel);
}

/**
 * Delete the given slugs, returning the ones that actually existed. Used to
 * clear rows a source stopped reporting (legacy demo data, retired models).
 */
export function deleteModelsBySlugs(slugs: string[]): string[] {
  if (slugs.length === 0) return [];
  const database = getDb();
  const stmt = database.prepare("DELETE FROM models WHERE slug = ?");
  const removed: string[] = [];
  const tx = database.transaction((items: string[]) => {
    for (const slug of items) {
      if (stmt.run(slug).changes > 0) removed.push(slug);
    }
  });
  tx(slugs);
  return removed;
}

/** Every slug currently persisted (used to compute what a full feed obsolete). */
export function listModelSlugs(): string[] {
  return (getDb().prepare("SELECT slug FROM models").all() as { slug: string }[]).map((r) => r.slug);
}

export function getModelBySlug(slug: string): ModelRecord | null {
  const row = getDb().prepare("SELECT * FROM models WHERE slug = ?").get(slug) as Record<string, unknown> | undefined;
  return row ? rowToModel(row) : null;
}

function rowToModel(row: Record<string, unknown>): ModelRecord {
  return {
    slug: row.slug as string,
    name: row.name as string,
    creator: (row.creator as string) ?? "",
    intelligence: (row.intelligence as number) ?? 0,
    coding: (row.coding as number) ?? 0,
    math: (row.math as number) ?? 0,
    priceInput: (row.price_input as number | null) ?? null,
    priceOutput: (row.price_output as number | null) ?? null,
    priceBlended: (row.price_blended as number | null) ?? null,
    speed: (row.speed as number) ?? 0,
    latency: (row.latency as number) ?? 0,
    accessibility: (row.accessibility as string) ?? "Unknown",
    accessibilityScore: (row.accessibility_score as number) ?? 0,
    license: (row.license as string) ?? null,
    licenseUrl: (row.license_url as string) ?? null,
    weightsUrl: (row.weights_url as string) ?? null,
    priceSourceUrl: (row.price_source_url as string) ?? null,
    fetchedAt: (row.fetched_at as string) ?? "",
  };
}

export function upsertNews(items: NewsItem[]): NewsItem[] {
  const database = getDb();
  const newItems: NewsItem[] = [];
  const stmt = database.prepare(`
    INSERT INTO news (id, title, link, source, published_at, summary, relevance_score, category, fetched_at, tier, cluster_id, canonical_url)
    VALUES (@id, @title, @link, @source, @publishedAt, @summary, @relevanceScore, @category, datetime('now'), @tier, @clusterId, @canonicalUrl)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      link = excluded.link,
      source = excluded.source,
      published_at = excluded.published_at,
      summary = excluded.summary,
      relevance_score = excluded.relevance_score,
      category = excluded.category,
      fetched_at = excluded.fetched_at,
      tier = excluded.tier,
      cluster_id = excluded.cluster_id,
      canonical_url = excluded.canonical_url
  `);

  const exists = database.prepare("SELECT id FROM news WHERE id = ?");
  const existingByCanonical = database.prepare("SELECT id FROM news WHERE canonical_url = ?");

  const tx = database.transaction((news: NewsItem[]) => {
    for (const item of news) {
      const canonicalUrl = canonicalNewsUrl(item.link) || null;
      const canonicalId = canonicalUrl ? canonicalNewsId(canonicalUrl) : item.id;
      const existingCanonical = canonicalUrl ? existingByCanonical.get(canonicalUrl) as { id: string } | undefined : undefined;
      const persistId = existingCanonical?.id ?? canonicalId;
      const isNew = !exists.get(persistId);
      stmt.run({
        id: persistId,
        title: item.title,
        link: item.link,
        source: item.source,
        publishedAt: item.publishedAt,
        summary: item.summary,
        relevanceScore: item.relevanceScore,
        category: item.category,
        tier: item.tier ?? 99,
        clusterId: item.clusterId ?? null,
        canonicalUrl,
      });
      if (isNew) newItems.push({ ...item, id: persistId });
    }
  });
  tx(items);
  return newItems;
}

export function getNews(
  limit = 50, category?: string, period?: NewsPeriod, view?: "all" | "ai_pick",
): NewsItem[] {
  const database = getDb();
  const targetPeriod = period && period !== "all" ? period : "all";
  const since = periodSince(period) ?? new Date(Date.now() - 90 * 86400_000).toISOString();
  const rows = database.prepare(`
    SELECT n.*, p.reason AS pick_reason, p.curated_at AS pick_curated_at
    FROM news n LEFT JOIN news_ai_picks p ON p.news_id = n.id AND p.period = ?
    WHERE julianday(n.published_at) >= julianday(?)
      AND julianday(n.published_at) <= julianday('now', '+5 minutes')
      ${view === "ai_pick" ? "AND p.news_id IS NOT NULL" : ""}
    ORDER BY julianday(n.published_at) DESC LIMIT 2000
  `).all(targetPeriod, since) as Record<string, unknown>[];
  const items = rows.map((row) => {
    const item = rowToNews(row);
    const scored = scoreRelevance(item.title, item.summary);
    return {
      ...item, relevanceScore: scored.score, category: scored.category,
      aiPick: row.pick_curated_at != null,
      aiPickReason: row.pick_reason == null ? null : String(row.pick_reason),
      aiPickPeriod: row.pick_curated_at == null ? null : targetPeriod,
      aiCuratedAt: row.pick_curated_at == null ? null : String(row.pick_curated_at),
    } as NewsItem;
  }).filter((item) => normalizeUrl(item.link) && hasAiSubject(item.title, item.summary)
    && (!category || category === "all" || item.category === category));
  return dedupeByCredibility(items).slice(0, Math.min(200, Math.max(1, Math.floor(limit) || 50)));
}

export function clearAiPicksForPeriod(period: NewsPeriod): void {
  const database = getDb();
  database.prepare("DELETE FROM news_ai_picks WHERE period = ?").run(period);
  database.prepare("UPDATE news SET ai_pick = 0, ai_pick_reason = NULL, ai_pick_period = NULL, ai_curated_at = NULL WHERE NOT EXISTS (SELECT 1 FROM news_ai_picks p WHERE p.news_id = news.id)").run();
}

export function setAiPicks(
  picks: { id: string; reason: string; period: NewsPeriod }[],
): void {
  const database = getDb();
  const stmt = database.prepare(`INSERT INTO news_ai_picks (news_id, period, reason, curated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(news_id, period) DO UPDATE SET reason = excluded.reason, curated_at = excluded.curated_at`);
  const now = new Date().toISOString();
  const tx = database.transaction(() => {
    for (const p of picks) {
      stmt.run(p.id, p.period, p.reason, now);
    }
  });
  tx();
}

function rowToNews(row: Record<string, unknown>): NewsItem {
  return {
    id: row.id as string,
    title: row.title as string,
    link: row.link as string,
    source: row.source as string,
    publishedAt: row.published_at as string,
    summary: (row.summary as string) ?? "",
    relevanceScore: (row.relevance_score as number) ?? 0,
    category: (row.category as string) ?? "general",
    tier: (row.tier as number) ?? 99,
    clusterId: (row.cluster_id as string) ?? null,
    aiPick: Boolean(row.ai_pick),
    aiPickReason: (row.ai_pick_reason as string) ?? null,
    aiPickPeriod: (row.ai_pick_period as string) ?? null,
    aiCuratedAt: (row.ai_curated_at as string) ?? null,
  };
}

export function upsertVideos(items: VideoItem[]): VideoItem[] {
  const database = getDb();
  const newItems: VideoItem[] = [];
  const exists = database.prepare("SELECT id FROM videos WHERE id = ?");
  const stmt = database.prepare(`
    INSERT INTO videos (id, title, link, channel, channel_handle, published_at, thumbnail, kind, fetched_at)
    VALUES (@id, @title, @link, @channel, @channelHandle, @publishedAt, @thumbnail, @kind, @fetchedAt)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      link = excluded.link,
      channel = excluded.channel,
      channel_handle = excluded.channel_handle,
      published_at = excluded.published_at,
      thumbnail = excluded.thumbnail,
      kind = excluded.kind,
      fetched_at = excluded.fetched_at
  `);

  const tx = database.transaction((videos: VideoItem[]) => {
    for (const v of videos) {
      const isNew = !exists.get(v.id);
      stmt.run({ ...v, kind: v.kind ?? "creator" });
      if (isNew) newItems.push(v);
    }
  });
  tx(items);
  return newItems;
}

export function getVideos(limit = 40, kind: "creator" | "company" | "all" = "creator"): VideoItem[] {
  const database = getDb();
  const rows =
    kind === "all"
      ? (database
          .prepare("SELECT * FROM videos ORDER BY published_at DESC LIMIT ?")
          .all(limit) as Record<string, unknown>[])
      : (database
          .prepare("SELECT * FROM videos WHERE kind = ? ORDER BY published_at DESC LIMIT ?")
          .all(kind, limit) as Record<string, unknown>[]);
  return rows.map((row) => ({
    id: row.id as string,
    title: row.title as string,
    link: row.link as string,
    channel: (row.channel as string) ?? "",
    channelHandle: (row.channel_handle as string) ?? "",
    publishedAt: (row.published_at as string) ?? "",
    thumbnail: (row.thumbnail as string) ?? "",
    fetchedAt: (row.fetched_at as string) ?? "",
    kind: (row.kind as VideoItem["kind"]) ?? "creator",
  }));
}

const NOTIFY_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

export function wasNotified(fingerprint: string, cooldownMs = NOTIFY_COOLDOWN_MS): boolean {
  const row = getDb()
    .prepare("SELECT notified_at FROM notified_events WHERE fingerprint = ?")
    .get(fingerprint) as { notified_at: string } | undefined;
  if (!row) return false;
  const age = Date.now() - new Date(row.notified_at).getTime();
  return age < cooldownMs;
}

export function markNotified(fingerprint: string): void {
  getDb()
    .prepare(
      `INSERT INTO notified_events (fingerprint, notified_at) VALUES (?, ?)
       ON CONFLICT(fingerprint) DO UPDATE SET notified_at = excluded.notified_at`,
    )
    .run(fingerprint, new Date().toISOString());
}

export function getNotifiedRoleGaps(): string[] {
  try {
    return JSON.parse(getMeta("notified_role_gaps") ?? "[]") as string[];
  } catch {
    return [];
  }
}

export function setNotifiedRoleGaps(keys: string[]): void {
  setMeta("notified_role_gaps", JSON.stringify(keys));
}

function newEntryId(): string {
  return `e_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function parseRole(value: unknown): StackRole {
  if (value === "secondary" || value === "free" || value === "primary") return value;
  return "primary";
}

function parseArea(value: unknown): StackArea {
  if (value === "writing" || value === "reasoning" || value === "general" || value === "coding") return value;
  return "coding";
}

function parseAreas(value: unknown, legacyArea?: unknown): StackArea[] {
  if (Array.isArray(value) && value.length > 0) {
    const areas = [...new Set(value.map(parseArea))];
    return areas.length ? areas : ["coding"];
  }
  if (typeof value === "string" && value.includes(",")) {
    return parseAreas(value.split(",").map((s) => s.trim()));
  }
  return [parseArea(value ?? legacyArea ?? "coding")];
}

function parseProviders(value: unknown, legacyProvider?: unknown): string[] {
  if (Array.isArray(value) && value.length > 0) {
    const providers = [...new Set(value.map((p) => String(p || "").trim()).filter(Boolean))];
    return providers.length ? providers : ["Cursor"];
  }
  if (typeof value === "string" && value.includes(",")) {
    return parseProviders(value.split(",").map((s) => s.trim()));
  }
  const single = String(value || legacyProvider || "Cursor").trim();
  return [single || "Cursor"];
}

function parseEntries(raw: unknown, fallback: Partial<MyStackProfile>): StackEntry[] {
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw || "[]") : raw;
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed.map((e: Record<string, unknown>) => ({
        id: String(e.id || newEntryId()),
        modelSlug: String(e.modelSlug || ""),
        modelName: String(e.modelName || ""),
        role: parseRole(e.role),
        areas: parseAreas(e.areas, e.area),
        providers: parseProviders(e.providers, e.provider),
        suggestedUpgradeSlug: (e.suggestedUpgradeSlug as string) || null,
        suggestedUpgradeDismissed: Boolean(e.suggestedUpgradeDismissed),
      }));
    }
  } catch {
    /* fall through */
  }

  // Migrate legacy single-model profile into one row.
  if (fallback.primaryModelSlug) {
    const role: StackRole =
      fallback.recommendationMode === "followup"
        ? "secondary"
        : fallback.recommendationMode === "free"
          ? "free"
          : "primary";
    return [
      {
        id: newEntryId(),
        modelSlug: fallback.primaryModelSlug,
        modelName: fallback.primaryModelName || fallback.primaryModelSlug,
        role,
        areas: ["coding"],
        providers: [fallback.provider || "Cursor"],
        suggestedUpgradeSlug: fallback.suggestedUpgradeSlug ?? null,
        suggestedUpgradeDismissed: Boolean(fallback.suggestedUpgradeDismissed),
      },
    ];
  }
  return [];
}

function derivePrimary(entries: StackEntry[]): { slug: string; name: string; provider: string } {
  const primary = entries.find((e) => e.role === "primary" && e.modelSlug) ?? entries.find((e) => e.modelSlug);
  return {
    slug: primary?.modelSlug ?? "",
    name: primary?.modelName ?? "",
    provider: primary?.providers?.[0] ?? "Cursor",
  };
}

function parseRecommendationMode(value: unknown): MyStackProfile["recommendationMode"] {
  if (value === "followup" || value === "free" || value === "best") return value;
  return "best";
}

export function getMyStack(): MyStackProfile {
  const row = getDb().prepare("SELECT * FROM user_stack WHERE id = 1").get() as Record<string, unknown>;
  const legacy = {
    primaryModelSlug: (row.primary_model_slug as string) ?? "",
    primaryModelName: (row.primary_model_name as string) ?? "",
    provider: (row.provider as string) ?? "Cursor",
    recommendationMode: parseRecommendationMode(row.recommendation_mode),
    suggestedUpgradeSlug: (row.suggested_upgrade_slug as string) ?? null,
    suggestedUpgradeDismissed: Boolean(row.suggested_upgrade_dismissed),
  };
  const entries = parseEntries(row.entries, legacy);
  const derived = derivePrimary(entries);

  // Persist migrated entries once.
  if ((!row.entries || row.entries === "[]") && entries.length > 0) {
    getDb()
      .prepare("UPDATE user_stack SET entries = ? WHERE id = 1")
      .run(JSON.stringify(entries));
  }

  let dismissedRoleGaps: StackRole[] = [];
  try {
    const raw = JSON.parse((row.dismissed_role_gaps as string) ?? "[]") as unknown;
    if (Array.isArray(raw)) {
      dismissedRoleGaps = raw.filter((r): r is StackRole =>
        r === "primary" || r === "secondary" || r === "free",
      );
    }
  } catch {
    dismissedRoleGaps = [];
  }

  return {
    entries,
    primaryModelSlug: derived.slug || legacy.primaryModelSlug,
    primaryModelName: derived.name || legacy.primaryModelName,
    provider: derived.provider || legacy.provider,
    recommendationMode: parseRecommendationMode(row.recommendation_mode),
    preferCursorReady: row.prefer_cursor_ready === undefined ? true : Boolean(row.prefer_cursor_ready),
    dismissedRoleGaps,
    roleGaps: [],
    priorityCoding: (row.priority_coding as number) ?? 40,
    priorityReasoning: (row.priority_reasoning as number) ?? 30,
    prioritySpeed: (row.priority_speed as number) ?? 20,
    priorityCost: (row.priority_cost as number) ?? 10,
    budgetTier: (row.budget_tier as MyStackProfile["budgetTier"]) ?? "mid",
    mustHaves: JSON.parse((row.must_haves as string) ?? "[]") as string[],
    notes: (row.notes as string) ?? "",
    suggestedUpgradeSlug:
      entries.find((e) => e.suggestedUpgradeSlug && !e.suggestedUpgradeDismissed)?.suggestedUpgradeSlug ??
      null,
    suggestedUpgradeDismissed: entries.every(
      (e) => !e.suggestedUpgradeSlug || e.suggestedUpgradeDismissed,
    ),
    updatedAt: (row.updated_at as string) ?? "",
  };
}

export function saveMyStack(profile: Partial<MyStackProfile>): MyStackProfile {
  const current = getMyStack();
  const entries = profile.entries ?? current.entries;
  const derived = derivePrimary(entries);
  const merged: MyStackProfile = {
    ...current,
    ...profile,
    entries,
    primaryModelSlug: derived.slug,
    primaryModelName: derived.name,
    provider: derived.provider,
    suggestedUpgradeSlug:
      entries.find((e) => e.suggestedUpgradeSlug && !e.suggestedUpgradeDismissed)?.suggestedUpgradeSlug ??
      null,
    suggestedUpgradeDismissed: entries.every(
      (e) => !e.suggestedUpgradeSlug || e.suggestedUpgradeDismissed,
    ),
    updatedAt: new Date().toISOString(),
  };

  getDb()
    .prepare(
      `
    UPDATE user_stack SET
      primary_model_slug = ?, primary_model_name = ?, provider = ?,
      recommendation_mode = ?,
      prefer_cursor_ready = ?,
      dismissed_role_gaps = ?,
      priority_coding = ?, priority_reasoning = ?, priority_speed = ?, priority_cost = ?,
      budget_tier = ?, must_haves = ?, notes = ?,
      suggested_upgrade_slug = ?, suggested_upgrade_dismissed = ?,
      entries = ?, updated_at = ?
    WHERE id = 1
  `,
    )
    .run(
      merged.primaryModelSlug,
      merged.primaryModelName,
      merged.provider,
      merged.recommendationMode,
      merged.preferCursorReady ? 1 : 0,
      JSON.stringify(merged.dismissedRoleGaps ?? []),
      merged.priorityCoding,
      merged.priorityReasoning,
      merged.prioritySpeed,
      merged.priorityCost,
      merged.budgetTier,
      JSON.stringify(merged.mustHaves),
      merged.notes,
      merged.suggestedUpgradeSlug,
      merged.suggestedUpgradeDismissed ? 1 : 0,
      JSON.stringify(merged.entries),
      merged.updatedAt,
    );
  // roleGaps are computed at read/evaluate time, not persisted
  return { ...merged, roleGaps: current.roleGaps ?? [] };
}

export function clearLatestBriefingUpgrade(): AnalystBriefing | null {
  const latest = getLatestBriefing();
  if (!latest) return null;
  getDb()
    .prepare(
      `UPDATE analyst_briefings SET upgrade_suggestion = NULL, upgrade_slug = NULL WHERE id = ?`,
    )
    .run(latest.id);
  return { ...latest, upgradeSuggestion: null, upgradeSlug: null };
}

export function saveBriefing(briefing: Omit<AnalystBriefing, "id">): AnalystBriefing {
  const result = getDb().prepare(`
    INSERT INTO analyst_briefings (headline, breaking, watch_list, new_models, your_stack,
      upgrade_suggestion, upgrade_slug, analyst_source, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    briefing.headline,
    JSON.stringify(briefing.breaking),
    JSON.stringify(briefing.watchList),
    JSON.stringify(briefing.newModels),
    briefing.yourStack,
    briefing.upgradeSuggestion,
    briefing.upgradeSlug,
    briefing.analystSource,
    briefing.createdAt
  );

  return { ...briefing, id: Number(result.lastInsertRowid) };
}

export function getLatestBriefing(): AnalystBriefing | null {
  const row = getDb().prepare(
    `SELECT * FROM analyst_briefings
     WHERE julianday(created_at) >= julianday(COALESCE((SELECT value FROM meta WHERE key='model_evidence_v2'), '1970-01-01'))
     ORDER BY id DESC LIMIT 1`
  ).get() as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: row.id as number,
    headline: row.headline as string,
    breaking: JSON.parse((row.breaking as string) ?? "[]") as string[],
    watchList: JSON.parse((row.watch_list as string) ?? "[]") as string[],
    newModels: JSON.parse((row.new_models as string) ?? "[]") as string[],
    yourStack: (row.your_stack as string) ?? "",
    upgradeSuggestion: (row.upgrade_suggestion as string) ?? null,
    upgradeSlug: (row.upgrade_slug as string) ?? null,
    analystSource: (row.analyst_source as AnalystBriefing["analystSource"]) ?? "rules",
    createdAt: (row.created_at as string) ?? "",
  };
}

export function getMeta(key: string): string | null {
  const row = getDb().prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setMeta(key: string, value: string): void {
  getDb().prepare(`
    INSERT INTO meta (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value);
}

export function getNotificationPrefs(): NotificationPrefs {
  const row = getDb().prepare("SELECT * FROM notification_prefs WHERE id = 1").get() as Record<string, unknown>;
  return {
    news: Boolean(row.news ?? 1),
    rankings: Boolean(row.rankings ?? 1),
    upgrades: Boolean(row.upgrades ?? 1),
  };
}

export function saveNotificationPrefs(prefs: Partial<NotificationPrefs>): NotificationPrefs {
  const current = getNotificationPrefs();
  const merged = { ...current, ...prefs };
  getDb().prepare(`
    UPDATE notification_prefs SET news = ?, rankings = ?, upgrades = ? WHERE id = 1
  `).run(merged.news ? 1 : 0, merged.rankings ? 1 : 0, merged.upgrades ? 1 : 0);
  return merged;
}

export function clearAllModels(): void {
  getDb().prepare("DELETE FROM models").run();
}

export function clearNewsWithHtml(): number {
  const result = getDb().prepare(`
    DELETE FROM news WHERE title LIKE '%<%' OR summary LIKE '%<%' OR title LIKE '%&lt;%'
  `).run();
  return result.changes;
}
