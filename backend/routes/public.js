// backend/routes/public.js
import express from "express";
import { pool } from "../db.js";
import { mail } from "../mailer.js";
import {
  listPaymentMethods,
  getPaymentMethodByKey,
  getDefaultMinDeposit,
} from "../paymentMethods.js";

const router = express.Router();

// ── Payment methods (public, enabled only) ──────────────────
router.get("/payment-methods", async (_req, res) => {
  const rows = await listPaymentMethods({ onlyEnabled: true });
  res.set("Cache-Control", "no-store, max-age=0");
  res.json(rows.map((m) => ({
    key:          m.key,
    label:        m.label,
    handle:       m.handle,
    instructions: m.instructions,
    min_deposit:  m.min_deposit,
    max_deposit:  m.max_deposit,
  })));
});

router.get("/deposit-info", async (_req, res) => {
  const enabled = await listPaymentMethods({ onlyEnabled: true });
  res.set("Cache-Control", "no-store, max-age=0");
  res.json({
    min_deposit_default: await getDefaultMinDeposit(),
    any_method_enabled:  enabled.length > 0,
  });
});

// ── Artists — simple list for the booking form dropdown ─────
router.get("/artists", async (_req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name FROM artists WHERE active = 1 ORDER BY name`
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// ── Artists — rich list for the /allartists page ────────────
router.get("/artists/public", async (_req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        id,
        name,
        COALESCE(specialty, '')  AS specialty,
        COALESCE(bio, '')        AS bio,
        COALESCE(image_url, '')  AS image_url,
        COALESCE(slug, '')       AS slug,
        COALESCE(instagram, '')  AS instagram
      FROM artists
      WHERE active = 1
      ORDER BY name
    `);

    const artists = rows.map(a => ({
      id:         a.id,
      name:       a.name,
      specialty:  a.specialty,
      bio:        a.bio,
      image_url:  a.image_url,
      slug:       a.slug,
      instagram:  a.instagram,
      booking_url: `/booking.html?artist=${encodeURIComponent(a.name)}`,
      profile_url: a.slug ? `/artist.html?slug=${encodeURIComponent(a.slug)}` : null,
    }));

    res.set("Cache-Control", "no-store, max-age=0");
    res.json(artists);
  } catch (err) { next(err); }
});

// ── Create booking ──────────────────────────────────────────
router.post("/bookings", async (req, res, next) => {
  try {
    const b = req.body || {};

    if (b.deposit_method) {
      const m = await getPaymentMethodByKey(b.deposit_method);
      if (!m || !m.enabled) {
        return res.status(400).json({
          error: "That payment method is no longer available. Please pick another.",
        });
      }
    }

    const year = new Date().getFullYear();
    const { rows: seqRows } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM bookings WHERE EXTRACT(YEAR FROM created_at) = $1`,
      [year]
    );
    const ref = `405-${year}-${String(seqRows[0].n + 1).padStart(4, "0")}`;

    const { rows } = await pool.query(`
      INSERT INTO bookings
        (ref, name, email, phone, placement, size, color_mode, description,
         artist_preference, status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending')
      RETURNING *
    `, [
      ref, b.name, b.email, b.phone || null,
      b.placement || null, b.size || null, b.color_mode || null,
      b.description || null, b.artist_preference || null,
    ]);

    const created = rows[0];

    mail.send({ to: created.email, ...mail.tplClientReceived(created) });
    if (process.env.ADMIN_EMAIL) {
      mail.send({ to: process.env.ADMIN_EMAIL, ...mail.tplAdminNewBooking(created) });
    }

    res.json({ ok: true, ref: created.ref });
  } catch (err) { next(err); }
});

// ── Upload receipt ──────────────────────────────────────────
router.post("/bookings/:ref/receipt", async (req, res, next) => {
  try {
    const { ref } = req.params;
    const email = String(req.query.email || "").toLowerCase();
    const { file_url } = req.body || {};
    if (!email || !file_url) {
      return res.status(400).json({ error: "email and file_url required" });
    }

    const { rows: bk } = await pool.query(
      `SELECT * FROM bookings WHERE ref = $1 AND lower(email) = $2`,
      [ref, email]
    );
    const booking = bk[0];
    if (!booking) return res.status(404).json({ error: "Booking not found" });

    await pool.query(`
      INSERT INTO receipts (booking_id, file_url, status)
      VALUES ($1, $2, 'pending')
    `, [booking.id, file_url]);

    mail.send({ to: booking.email, ...mail.tplClientReceiptReceived(booking) });
    if (process.env.ADMIN_EMAIL) {
      mail.send({ to: process.env.ADMIN_EMAIL, ...mail.tplAdminReceiptUploaded(booking) });
    }

    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── Full status of a booking ────────────────────────────────
router.get("/bookings/:ref/status", async (req, res, next) => {
  try {
    const { ref } = req.params;
    const email = String(req.query.email || "").toLowerCase();
    if (!email) return res.status(400).json({ error: "email query required" });

    const { rows } = await pool.query(`
      SELECT b.*,
             a.name  AS artist_name,
             ca.name AS consultation_artist_name
      FROM bookings b
      LEFT JOIN artists a  ON a.id  = b.artist_id
      LEFT JOIN artists ca ON ca.id = b.consultation_artist_id
      WHERE b.ref = $1 AND lower(b.email) = $2
    `, [ref, email]);

    const b = rows[0];
    if (!b) return res.status(404).json({ error: "Booking not found" });

    const { rows: rrows } = await pool.query(`
      SELECT file_url, status, submitted_at
      FROM receipts WHERE booking_id = $1
      ORDER BY (status='approved') DESC, submitted_at DESC
      LIMIT 1
    `, [b.id]);

    const chosenMethod = b.deposit_method
      ? await getPaymentMethodByKey(b.deposit_method)
      : null;

    res.set("Cache-Control", "no-store, max-age=0");
    res.json({
      ref: b.ref,
      name: b.name,
      status: b.status,
      placement: b.placement,
      size: b.size,
      color_mode: b.color_mode,
      description: b.description,
      artist_name: b.artist_name,
      artist_preference: b.artist_preference,

      deposit_amount: b.deposit_amount != null ? Number(b.deposit_amount) : null,
      deposit_method: b.deposit_method,
      deposit_method_label: chosenMethod?.label || b.deposit_method || null,
      deposit_paid: b.deposit_paid === 1,
      deposit_paid_at: b.deposit_paid_at,

      appointment_at: b.appointment_at,

      consultation_required: b.consultation_required === 1,
      consultation_done: b.consultation_done === 1,
      consultation_at: b.consultation_at,
      consultation_artist_name: b.consultation_artist_name,
      consultation_notes: b.consultation_notes,

      receipt_url: rrows[0]?.file_url || null,
      receipt_status: rrows[0]?.status || null,
      created_at: b.created_at,
    });
  } catch (err) { next(err); }
});

export default router;
