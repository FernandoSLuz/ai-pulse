import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const restart = process.argv.includes("--restart");
const dir = restart ? process.env.AI_PULSE_DATA_DIR! : fs.mkdtempSync(path.join(os.tmpdir(), "ai-pulse-storage-"));
process.env.AI_PULSE_DATA_DIR = dir;
try {
  if (!restart) {
    const legacy = new Database(path.join(dir, "ai-pulse.db"));
    legacy.exec(`CREATE TABLE models (slug TEXT PRIMARY KEY, name TEXT, creator TEXT, intelligence REAL, coding REAL, math REAL,
      price_input REAL, price_output REAL, price_blended REAL, speed REAL, latency REAL, accessibility TEXT, accessibility_score REAL, fetched_at TEXT);
      INSERT INTO models VALUES ('legacy','Legacy','Vendor',10,10,10,0,0,0,10,1,'Open source',5,datetime('now'));
      CREATE TABLE news (id TEXT PRIMARY KEY, title TEXT, link TEXT, source TEXT, published_at TEXT, summary TEXT, relevance_score REAL,
        category TEXT, fetched_at TEXT, ai_pick INTEGER, ai_pick_reason TEXT, ai_pick_period TEXT, ai_curated_at TEXT);`);
    legacy.prepare("INSERT INTO news VALUES (?,?,?,?,?,?,?, ?,?,1,'legacy pick','today',?)").run(
      "old-id", "OpenAI announces GPT-6", "https://example.com/launch?utm_source=old", "Official", new Date().toISOString(), "New AI model", 100,
      "general", new Date().toISOString(), new Date().toISOString());
    legacy.close();
  }
  const db = await import("../src/db.js");
  const sql = db.getDb();
  if (restart) {
    assert.equal(db.getNews(10, "all", "today", "ai_pick").length, 0, "cleared picks cannot reappear after restart");
    assert.equal(db.getAllModels()[0].priceBlended, 0, "verified free price survives restart");
  } else {
    const model = db.getAllModels()[0];
    assert.equal(model.accessibility, "Unknown", "legacy inferred open-source label is invalidated");
    assert.equal(model.priceBlended, null, "legacy missing-price zero is not free");
    assert.equal(db.getNews(10, "all", "today", "ai_pick")[0].id, "old-id");
    assert.equal(db.getNews(10, "all", "week", "ai_pick").length, 0, "picks are scoped to a period");
    const item = db.getNews()[0];
    assert.equal(item.aiPick, false, "no legacy pick leaks into another period");
    const fresh = db.upsertNews([{ ...item, id: "new-hash", link: "https://example.com/launch?utm_medium=new" }]);
    assert.equal(fresh.length, 0, "upgrade canonicalization must not notify the same article again");
    assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM news").get().n, 1);
    for (const [id, published, title] of [["future", new Date(Date.now() + 86400000).toISOString(), "OpenAI announces GPT-8"], ["bad-date", "invalid", "OpenAI announces GPT-9"], ["unrelated", new Date().toISOString(), "Database API maintenance"]]) {
      db.upsertNews([{ ...item, id, link: `https://example.com/${id}`, title, summary: "", publishedAt: published }]);
    }
    assert.equal(db.getNews().length, 1, "future, invalid and unrelated cached stories stay out");
    db.clearAiPicksForPeriod("today");
    sql.prepare("UPDATE models SET price_blended=0, price_input=0, price_output=0, price_source_url=?").run("https://artificialanalysis.ai/models");
    db.upsertSocialProfiles([{ handle: "sama", name: "Sam Altman", profileUrl: "https://x.com/sama", enabled: true, source: "user" }]);
    sql.prepare("INSERT INTO social_profiles (handle,name,profile_url,source,enabled,updated_at) VALUES (?,?,?,?,?,?)").run("SAMA", "Duplicate", "https://x.com/sama", "user", 1, new Date().toISOString());
    assert.equal(db.getSocialProfiles().filter((p) => p.handle === "sama").length, 1, "case variants coalesce to one profile");
    db.replaceSocialPosts([{ id: "post", text: "AI news", createdAt: new Date().toISOString(), authorHandle: "sama", authorName: "Sam Altman", url: "https://x.com/sama/status/1", source: "x-api" }]);
    assert.equal(db.getSocialPosts().length, 1);
    db.deleteSocialProfile("SAMA");
    assert.equal(db.getSocialPosts().length, 0, "unfollow removes cached posts from the feed");
  }
  sql.close();
  if (!restart) execFileSync(process.execPath, ["--import", "tsx", fileURLToPath(import.meta.url), "--restart"], { env: process.env, stdio: "inherit" });
  console.log(`storage smoke regressions${restart ? " (restart)" : ""}: OK`);
} finally {
  if (!restart) fs.rmSync(dir, { recursive: true, force: true });
}
