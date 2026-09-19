import express from "express";
import { z } from "zod";

import { db, listArtists, slugify } from "../db.js";
import {
  verifyAdminPassword,
  requireAdminSession,
  issueCsrfToken,
  requireCsrf,
} from "../auth.js";
import { uploadArtistImage } from "../middleware/uploads.js";
import * as mail from "../mailer.js";

const router = express.Router();

// ── Login (mounted before auth) ────────────────────────────────
router.post("/login", async (req, res) => {
  const { password } = req.body || {};
  const ok = await verifyAdminPassword(password);
  if (!ok) return res.status(401).json({ error: "Invalid credentials" });

  req.session.isAdmin = true;
  res.json({ ok: true, csrf: issueCsrfToken(req) });
});

router.post("/logout", (req, res) => {
  req.session?.destroy(() => res.json({ ok: true }));
});

router.get("/me", (req, res) => {
  if (req.session?.isAdmin) {
    return res.json({ authenticated: true, csrf: issueCsrfToken(req) });
  }
  res.json({ authenticated: false });
});

// ── Everything below requires auth + CSRF ──────────────────────
router.use(requireAdminSession);
router.use((req, res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  return requireCsrf(req, res, next);
});

// ── Dashboard ──────────────────────────────────────────────────
router.get("/stats", (_req, res) => {
  const total    = db.prepare("SELECT COUNT(*) n FROM bookings").get().n;
  const pending  = db.prepare("SELECT COUNT(*) n FROM bookings WHERE status='pending'").get().n;
  const approved = db.prepare("SELECT COUNT(*) n FROM bookings WHERE status='approved'").get().n;
  const paid     = db.prepare("SELECT COUNT(*) n FROM bookings WHERE deposit_paid=1").get().n;
  const unpaid   = db.prepare("SELECT COUNT(*) n FROM bookings WHERE deposit_paid=0 AND deposit_amount>0").get().n;
  res.json({ total, pending, approved, paid, unpaid });
});

// ── Bookings list ──────────────────────────────────────────────
router.get("/bookings", (req, res) => {
  const { status, paid, q } = req.query;
  const where = [];
  const params = [];
  if (status) { where.push("status = ?"); params.push(status); }
  if (paid === "1") where.push("deposit_paid = 1");
  if (paid === "0") where.push("deposit_paid = 0");
  if (q) {
    where.push("(name LIKE ? OR email LIKE ? OR ref LIKE ? OR phone LIKE ?)");
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }

  const rows = db.prepare(`
    SELECT b.*, a.name AS artist_name
    FROM bookings b LEFT JOIN artists a ON a.id = b.artist_id
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY b.created_at DESC LIMIT 500
  `).all(...params);

  for (const r of rows) r.reference_urls = JSON.parse(r.reference_urls || "[]");
  res.json(rows);
});

router.get("/bookings/:id", (req, res) => {
  const b = db.prepare(`
    SELECT b.*, a.name AS artist_name
    FROM bookings b LEFT JOIN artists a ON a.id = b.artist_id
    WHERE b.id = ?
  `).get(req.params.id);
  if (!b) return res.status(404).json({ error: "Not found" });
  b.reference_urls = JSON.parse(b.reference_urls || "[]");
  res.json(b);
});

// ── Update booking ─────────────────────────────────────────────
const UpdateSchema = z.object({
  deposit_amount: z.coerce.number().min(0).max(100000).nullable().optional(),
  deposit_method: z.enum(["paypal", "cash", "card", "venmo"]).nullable().optional(),
  deposit_paid:   z.coerce.number().int().min(0).max(1).optional(),
  status:         z.enum(["pending","approved","scheduled","completed","cancelled"]).optional(),
  appointment_at: z.string().nullable().optional(),
  notes:          z.string().max(4000).nullable().optional(),
  artist_id:      z.coerce.number().int().positive().nullable().optional(),
});

router.patch("/bookings/:id", async (req, res) => {
  const parsed = UpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid", details: parsed.error.flatten() });
  }

  const before = db.prepare("SELECT * FROM bookings WHERE id = ?").get(req.params.id);
  if (!before) return res.status(404).json({ error: "Not found" });

  const patch = parsed.data;
  const fields = [];
  const values = [];
  for (const [k, v] of Object.entries(patch)) {
    fields.push(`${k} = ?`);
    values.push(v === "" ? null : v);
  }
  if (!fields.length) return res.json(before);

  const wasPaid = !!before.deposit_paid;
  const nowPaid = patch.deposit_paid === 1;
  if (!wasPaid && nowPaid) fields.push(`deposit_paid_at = datetime('now')`);
  if (wasPaid  && patch.deposit_paid === 0) fields.push(`deposit_paid_at = NULL`);

  fields.push(`updated_at = datetime('now')`);
  db.prepare(`UPDATE bookings SET ${fields.join(", ")} WHERE id = ?`)
    .run(...values, req.params.id);

  const after = db.prepare(`
    SELECT b.*, a.name AS artist_name
    FROM bookings b LEFT JOIN artists a ON a.id = b.artist_id
    WHERE b.id = ?
  `).get(req.params.id);
  after.reference_urls = JSON.parse(after.reference_urls || "[]");

  // ── Auto-emails on state changes ──────────────────────────
  if (!wasPaid && after.deposit_amount > 0 &&
      (!before.deposit_amount || before.deposit_amount === 0)) {
    mail.send({ to: after.email, ...mail.tplClientDepositDue(after, after.artist_name) });
  }
  if (!wasPaid && nowPaid) {
    mail.send({ to: after.email, ...mail.tplClientConfirmed(after, after.artist_name) });
  }
  if (after.appointment_at && after.appointment_at !== before.appointment_at && wasPaid) {
    mail.send({ to: after.email, ...mail.tplClientConfirmed(after, after.artist_name) });
  }

  res.json(after);
});

router.delete("/bookings/:id", (req, res) => {
  db.prepare("DELETE FROM bookings WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// ── Artists ────────────────────────────────────────────────────
router.get("/artists", (_req, res) => res.json(listArtists()));

const ArtistSchema = z.object({
  name:          z.string().min(1).max(80),
  specialty:     z.string().max(200).optional().default(""),
  bio:           z.string().max(4000).optional().default(""),
  portfolio_url: z.string().max(300).optional().default(""),
  sort_order:    z.coerce.number().int().min(0).max(999).optional().default(0),
  active:        z.coerce.number().int().min(0).max(1).optional().default(1),
  image_url:     z.string().max(300).nullable().optional(),
});

router.post("/artists", (req, res) => {
  const parsed = ArtistSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const data = parsed.data;
  const slug = slugify(data.name);

  const info = db.prepare(`
    INSERT INTO artists (slug, name, specialty, bio, portfolio_url, sort_order, active, image_url)
    VALUES (?,?,?,?,?,?,?,?)
  `).run(
    slug, data.name, data.specialty, data.bio,
    data.portfolio_url, data.sort_order, data.active, data.image_url || null
  );

  res.status(201).json(db.prepare("SELECT * FROM artists WHERE id = ?")
                          .get(info.lastInsertRowid));
});

router.patch("/artists/:id", (req, res) => {
  const parsed = ArtistSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const fields = [];
  const values = [];
  for (const [k, v] of Object.entries(parsed.data)) {
    fields.push(`${k} = ?`);
    values.push(v === "" ? null : v);
  }
  if (!fields.length) return res.json({ ok: true });
  db.prepare(`UPDATE artists SET ${fields.join(", ")} WHERE id = ?`)
    .run(...values, req.params.id);
  res.json(db.prepare("SELECT * FROM artists WHERE id = ?").get(req.params.id));
});

router.delete("/artists/:id", (req, res) => {
  db.prepare("DELETE FROM artists WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

router.post("/artists/:id/image", uploadArtistImage, (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file" });
  const url = `/uploads/${req.file.filename}`;
  db.prepare("UPDATE artists SET image_url = ? WHERE id = ?").run(url, req.params.id);
  res.json({ url });
});

export default router;
