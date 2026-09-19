// backend/db.js
import pg from "pg";
import { config } from "./config.js";
import crypto from "node:crypto";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.database.connectionString,
  // Required for Render's managed PostgreSQL
  ssl: {
    rejectUnauthorized: false,
  },
});

async function initDb() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS artists (
        id            SERIAL PRIMARY KEY,
        slug          TEXT UNIQUE NOT NULL,
        name          TEXT NOT NULL,
        specialty     TEXT,
        bio           TEXT,
        image_url     TEXT,
        portfolio_url TEXT,
        sort_order    INTEGER DEFAULT 0,
        active        INTEGER DEFAULT 1,
        created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS bookings (
        id                SERIAL PRIMARY KEY,
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
        deposit_paid_at   TIMESTAMP,
        appointment_at    TIMESTAMP,
        notes             TEXT,
        created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("Database tables initialized.");
  } finally {
    client.release();
  }
}

// Run this on startup
initDb().catch(err => {
  console.error("Failed to initialize database:", err);
  process.exit(1);
});

// ── Helper Functions (now async) ─────────────────────────────
export async function nextBookingRef() {
  const year = new Date().getFullYear();
  const result = await pool.query(
    "SELECT COUNT(*) AS n FROM bookings WHERE ref LIKE $1",
    [`405-${year}-%`]
  );
  const n = parseInt(result.rows[0].n, 10);
  return `405-${year}-${String(n + 1).padStart(4, "0")}`;
}

export async function listArtists({ activeOnly = false } = {}) {
  const sql = activeOnly
    ? "SELECT * FROM artists WHERE active = 1 ORDER BY sort_order, name"
    : "SELECT * FROM artists ORDER BY sort_order, name";
  const result = await pool.query(sql);
  return result.rows;
}

// Keep slugify as is (no DB interaction)
export function slugify(s) { /* ... unchanged ... */ }
