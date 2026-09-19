// backend/db.js
import pg from "pg";

const { Pool } = pg;

const url = process.env.DATABASE_URL || "";
const useSSL =
  url.includes("sslmode=require") ||
  url.includes("render.com") ||
  process.env.NODE_ENV === "production";

export const pool = new Pool({
  connectionString: url,
  ssl: useSSL ? { rejectUnauthorized: false } : false,
});

async function addColumnIfMissing(client, table, column, definition) {
  await client.query(`
    DO $$ BEGIN
      ALTER TABLE ${table} ADD COLUMN ${column} ${definition};
    EXCEPTION WHEN duplicate_column THEN NULL;
    END $$;
  `);
}

export async function initDb() {
  const client = await pool.connect();
  try {
    await client.query(`BEGIN`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS artists (
        id         SERIAL PRIMARY KEY,
        name       TEXT NOT NULL,
        active     INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS bookings (
        id                SERIAL PRIMARY KEY,
        ref               TEXT UNIQUE NOT NULL,
        name              TEXT NOT NULL,
        email             TEXT NOT NULL,
        phone             TEXT,
        placement         TEXT,
        size              TEXT,
        color_mode        TEXT,
        description       TEXT,
        artist_id         INTEGER REFERENCES artists(id) ON DELETE SET NULL,
        artist_preference TEXT,
        deposit_amount    NUMERIC(10,2),
        deposit_method    TEXT,
        deposit_paid      INTEGER NOT NULL DEFAULT 0,
        deposit_paid_at   TIMESTAMP,
        appointment_at    TIMESTAMP,
        status            TEXT NOT NULL DEFAULT 'pending',
        notes             TEXT,
        created_at        TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS receipts (
        id           SERIAL PRIMARY KEY,
        booking_id   INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
        file_url     TEXT NOT NULL,
        status       TEXT NOT NULL DEFAULT 'pending',
        reason       TEXT,
        submitted_at TIMESTAMP NOT NULL DEFAULT NOW(),
        reviewed_at  TIMESTAMP
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS settings (
        key   TEXT PRIMARY KEY,
        value TEXT
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS payment_methods (
        id           SERIAL PRIMARY KEY,
        key          TEXT UNIQUE NOT NULL,
        label        TEXT NOT NULL,
        handle       TEXT,
        instructions TEXT,
        enabled      INTEGER NOT NULL DEFAULT 1,
        min_deposit  NUMERIC(10,2),
        max_deposit  NUMERIC(10,2),
        sort_order   INTEGER NOT NULL DEFAULT 0,
        created_at   TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    await addColumnIfMissing(client, "bookings", "consultation_required",  "INTEGER NOT NULL DEFAULT 0");
    await addColumnIfMissing(client, "bookings", "consultation_done",      "INTEGER NOT NULL DEFAULT 0");
    await addColumnIfMissing(client, "bookings", "consultation_at",        "TIMESTAMP");
    await addColumnIfMissing(client, "bookings", "consultation_artist_id", "INTEGER REFERENCES artists(id) ON DELETE SET NULL");
    await addColumnIfMissing(client, "bookings", "consultation_notes",     "TEXT");

    const { rows: pmCount } = await client.query(
      `SELECT COUNT(*)::int AS n FROM payment_methods`
    );
    if (pmCount[0].n === 0) {
      await client.query(`
        INSERT INTO payment_methods (key, label, handle, instructions, enabled, sort_order) VALUES
          ('paypal', 'PayPal',      '', 'Send as Friends & Family to avoid fees.',      1, 1),
          ('cash',   'Cash in shop','', 'Drop by the studio during open hours.',         1, 2),
          ('card',   'Card in shop','', 'We accept card at the front desk.',             1, 3),
          ('venmo',  'Venmo',       '', 'Include your booking reference in the note.',  1, 4);
      `);
    }

    await client.query(`
      INSERT INTO settings (key, value) VALUES ('min_deposit_default', '50')
      ON CONFLICT (key) DO NOTHING;
    `);

    await client.query(`COMMIT`);
  } catch (err) {
    await client.query(`ROLLBACK`).catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
