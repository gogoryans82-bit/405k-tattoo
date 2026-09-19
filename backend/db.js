import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { config } from "./config.js";

fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(config.uploadsDir, { recursive: true });

export const db = new Database(path.join(config.dataDir, "app.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS artists (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    slug          TEXT UNIQUE NOT NULL,
    name          TEXT NOT NULL,
    specialty     TEXT,
    bio           TEXT,
    image_url     TEXT,
    portfolio_url TEXT,
    sort_order    INTEGER DEFAULT 0,
    active        INTEGER DEFAULT 1,
    created_at    TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS bookings (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    ref               TEXT UNIQUE NOT NULL,
    name              TEXT NOT NULL,
    email             TEXT NOT NULL,
    phone             TEXT NOT NULL,
    artist_id         INTEGER REFERENCES artists(id) ON DELETE SET NULL,
    artist_preference TEXT,
    placement         TEXT NOT NULL,
    size              TEXT NOT NULL,
    color_mode        TEXT NOT NULL CHECK (color_mode IN ('black','color')),
    description       TEXT,
    reference_urls    TEXT DEFAULT '[]',
    preferred_dates   TEXT,
    status            TEXT NOT NULL DEFAULT 'pending',
    deposit_amount    REAL,
    deposit_method    TEXT,
    deposit_paid      INTEGER DEFAULT 0,
    deposit_paid_at   TEXT,
    appointment_at    TEXT,
    notes             TEXT,
    created_at        TEXT DEFAULT (datetime('now')),
    updated_at        TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_bookings_status  ON bookings(status);
  CREATE INDEX IF NOT EXISTS idx_bookings_created ON bookings(created_at DESC);

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );
`);

// ── Helpers ─────────────────────────────────────────────────────

export function nextBookingRef() {
  const year = new Date().getFullYear();
  const row = db.prepare(`SELECT COUNT(*) AS n FROM bookings WHERE ref LIKE ?`)
                .get(`405-${year}-%`);
  return `405-${year}-${String((row?.n ?? 0) + 1).padStart(4, "0")}`;
}

export function listArtists({ activeOnly = false } = {}) {
  const sql = activeOnly
    ? `SELECT * FROM artists WHERE active = 1 ORDER BY sort_order, name`
    : `SELECT * FROM artists ORDER BY sort_order, name`;
  return db.prepare(sql).all();
}

export function slugify(s) {
  return (
    s.toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || crypto.randomBytes(4).toString("hex")
  );
}
