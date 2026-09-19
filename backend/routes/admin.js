// backend/routes/admin.js
import express from "express";
import { z } from "zod";
import { pool } from "../db.js";
import { mail } from "../mailer.js";
import { verifyAdmin, adminConfigured, adminEmail, requireAdmin } from "../auth.js";
import {
  listPaymentMethods,
  getPaymentMethodByKey,
  getDefaultMinDeposit,
  validateDeposit,
} from "../paymentMethods.js";

const router = express.Router();

router.post("/login", async (req, res) => {
  if (!adminConfigured()) {
    return res.status(503).json({
      error: "Admin credentials are not configured on the server.",
    });
  }
  const { email, password } = req.body || {};
  if (!(await verifyAdmin(email, password))) {
    return res.status(401).json({ error: "Invalid email or password" });
  }
  req.session.admin = { email: adminEmail() };
  res.json({ ok: true, email: adminEmail() });
});

router.post("/logout", (req, res) => {
  req.session?.destroy?.(() => {});
  res.json({ ok: true });
});

router.get("/me", (req, res) => {
  if (!req.session?.admin) return res.status(401).json({ error: "Not authenticated" });
  res.json({ email: req.session.admin.email });
});

router.use(requireAdmin);

router.get("/bookings", async (req, res, next) => {
  try {
    const { status, q } = req.query;
    const where = [];
    const vals = [];
    if (status) { vals.push(status); where.push(`b.status = $${vals.length}`); }
    if (q) {
      vals.push(`%${q}%`);
      where.push(`(b.ref ILIKE $${vals.length} OR b.name ILIKE $${vals.length} OR b.email ILIKE $${vals.length})`);
    }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const { rows } = await pool.query(`
      SELECT b.*, a.name AS artist_name
      FROM bookings b
      LEFT JOIN artists a ON a.id = b.artist_id
      ${clause}
      ORDER BY b.created_at DESC
      LIMIT 200
    `, vals);
    res.json(rows);
  } catch (err) { next(err); }
});

router.get("/bookings/:id", async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT b.*, a.name AS artist_name, ca.name AS consultation_artist_name
      FROM bookings b
      LEFT JOIN artists a  ON a.id  = b.artist_id
      LEFT JOIN artists ca ON ca.id = b.consultation_artist_id
      WHERE b.id = $1
    `, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: "Not found" });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

router.get("/artists", async (_req, res, next) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM artists ORDER BY name`);
    res.json(rows);
  } catch (err) { next(err); }
});

const MethodSchema = z.object({
  key:          z.string().min(1).max(40).regex(/^[a-z0-9_]+$/, "lowercase letters, numbers, underscore"),
  label:        z.string().min(1).max(60),
  handle:       z.string().max(200).nullable().optional(),
  instructions: z.string().max(2000).nullable().optional(),
  enabled:      z.coerce.number().int().min(0).max(1).optional(),
  min_deposit:  z.coerce.number().min(0).max(100000).nullable().optional(),
  max_deposit:  z.coerce.number().min(0).max(100000).nullable().optional(),
  sort_order:   z.coerce.number().int().optional(),
});

router.get("/payment-methods", async (_req, res, next) => {
  try { res.json(await listPaymentMethods()); } catch (err) { next(err); }
});

router.post("/payment-methods", async (req, res, next) => {
  try {
    const p = MethodSchema.safeParse(req.body);
    if (!p.success) return res.status(400).json({ error: p.error.issues[0].message });
    const d = p.data;
    const { rows } = await pool.query(`
      INSERT INTO payment_methods
        (key, label, handle, instructions, enabled, min_deposit, max_deposit, sort_order)
      VALUES ($1,$2,$3,$4,$5,$6,$7, COALESCE($8,
        (SELECT COALESCE(MAX(sort_order),0)+1 FROM payment_methods)))
      RETURNING *
    `, [
      d.key, d.label, d.handle ?? null, d.instructions ?? null,
      d.enabled ?? 1, d.min_deposit ?? null, d.max_deposit ?? null,
      d.sort_order ?? null,
    ]);
    res.json(rows[0]);
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "A method with that key already exists" });
    next(err);
  }
});

router.patch("/payment-methods/:id", async (req, res, next) => {
  try {
    const p = MethodSchema.partial().safeParse(req.body);
    if (!p.success) return res.status(400).json({ error: p.error.issues[0].message });

    const allowed = ["key","label","handle","instructions","enabled","min_deposit","max_deposit","sort_order"];
    const sets = [], vals = [];
    for (const [k, v] of Object.entries(p.data)) {
      if (!allowed.includes(k)) continue;
      vals.push(v); sets.push(`${k} = $${vals.length}`);
    }
    if (!sets.length) return res.json({ ok: true });

    vals.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE payment_methods SET ${sets.join(", ")} WHERE id = $${vals.length} RETURNING *`,
      vals
    );
    if (!rows[0]) return res.status(404).json({ error: "Not found" });
    res.json(rows[0]);
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "Duplicate key" });
    next(err);
  }
});

router.delete("/payment-methods/:id", async (req, res, next) => {
  try {
    await pool.query(`DELETE FROM payment_methods WHERE id = $1`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post("/payment-methods/reorder", async (req, res, next) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isFinite) : null;
  if (!ids?.length) return res.status(400).json({ error: "ids array required" });
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    for (let i = 0; i < ids.length; i++) {
      await c.query(`UPDATE payment_methods SET sort_order = $1 WHERE id = $2`, [i + 1, ids[i]]);
    }
    await c.query("COMMIT");
    res.json({ ok: true });
  } catch (err) {
    await c.query("ROLLBACK").catch(() => {});
    next(err);
  } finally { c.release(); }
});

router.get("/settings/min-deposit", async (_req, res, next) => {
  try { res.json({ min_deposit_default: await getDefaultMinDeposit() }); }
  catch (err) { next(err); }
});

router.put("/settings/min-deposit", async (req, res, next) => {
  try {
    const n = Number(req.body?.min_deposit_default);
    if (!Number.isFinite(n) || n < 0) return res.status(400).json({ error: "Invalid amount" });
    await pool.query(`
      INSERT INTO settings (key, value) VALUES ('min_deposit_default', $1)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
    `, [String(n)]);
    res.json({ min_deposit_default: n });
  } catch (err) { next(err); }
});

const UpdateSchema = z.object({
  deposit_amount: z.coerce.number().min(0).max(100000).nullable().optional(),
  deposit_method: z.string().max(40).nullable().optional(),
  deposit_paid:   z.coerce.number().int().min(0).max(1).optional(),
  status:         z.enum(["pending","approved","scheduled","completed","cancelled"]).optional(),
  appointment_at: z.string().nullable().optional(),
  notes:          z.string().max(4000).nullable().optional(),
  artist_id:      z.coerce.number().int().positive().nullable().optional(),

  consultation_required:  z.coerce.number().int().min(0).max(1).optional(),
  consultation_done:      z.coerce.number().int().min(0).max(1).optional(),
  consultation_at:        z.string().nullable().optional(),
  consultation_artist_id: z.coerce.number().int().positive().nullable().optional(),
  consultation_notes:     z.string().max(4000).nullable().optional(),
});

router.patch("/bookings/:id", async (req, res, next) => {
  try {
    const p = UpdateSchema.safeParse(req.body);
    if (!p.success) return res.status(400).json({ error: p.error.issues[0].message });

    const { rows: beforeRows } = await pool.query(
      `SELECT * FROM bookings WHERE id = $1`, [req.params.id]
    );
    const before = beforeRows[0];
    if (!before) return res.status(404).json({ error: "Not found" });

    const d = p.data;

    const check = await validateDeposit(
      d.deposit_method !== undefined ? d.deposit_method : before.deposit_method,
      d.deposit_amount !== undefined ? d.deposit_amount : before.deposit_amount
    );
    if (!check.ok) return res.status(400).json({ error: check.error });

    const allowed = [
      "deposit_amount","deposit_method","deposit_paid","status",
      "appointment_at","notes","artist_id",
      "consultation_required","consultation_done","consultation_at",
      "consultation_artist_id","consultation_notes",
    ];
    const sets = [], vals = [];
    for (const k of allowed) {
      if (d[k] === undefined) continue;
      vals.push(d[k]);
      sets.push(`${k} = $${vals.length}`);
    }
    if (!sets.length) return res.json({ ok: true });

    vals.push(req.params.id);
    await pool.query(
      `UPDATE bookings SET ${sets.join(", ")} WHERE id = $${vals.length}`,
      vals
    );

    const { rows: afterRows } = await pool.query(`
      SELECT b.*, a.name AS artist_name, ca.name AS consultation_artist_name
      FROM bookings b
      LEFT JOIN artists a  ON a.id  = b.artist_id
      LEFT JOIN artists ca ON ca.id = b.consultation_artist_id
      WHERE b.id = $1
    `, [req.params.id]);
    const after = afterRows[0];

    const wasPaid = before.deposit_paid === 1;
    const isPaid  = after.deposit_paid === 1;

    if (!isPaid && after.deposit_amount > 0 &&
        (!before.deposit_amount || Number(before.deposit_amount) === 0)) {
      const method = await getPaymentMethodByKey(after.deposit_method);
      mail.send({
        to: after.email,
        ...mail.tplClientDepositDue(after, after.artist_name, method),
      });
    }

    const consultationChanged =
      after.consultation_at !== before.consultation_at ||
      after.consultation_artist_id !== before.consultation_artist_id ||
      after.consultation_required !== before.consultation_required;
    if (consultationChanged && after.consultation_required === 1 && after.consultation_at) {
      mail.send({
        to: after.email,
        ...mail.tplClientStatusUpdate(after, after.artist_name, after.consultation_artist_name),
      });
    }

    if (before.consultation_done !== 1 && after.consultation_done === 1) {
      mail.send({
        to: after.email,
        ...mail.tplClientStatusUpdate(after, after.artist_name, after.consultation_artist_name),
      });
    }

    if (after.appointment_at && after.appointment_at !== before.appointment_at && wasPaid) {
      mail.send({
        to: after.email,
        ...mail.tplClientStatusUpdate(after, after.artist_name, after.consultation_artist_name),
      });
    }

    res.json(after);
  } catch (err) { next(err); }
});

router.post("/receipts/:id/approve", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM receipts WHERE id = $1`, [req.params.id]
    );
    const r = rows[0];
    if (!r) return res.status(404).json({ error: "Not found" });

    await pool.query(
      `UPDATE receipts SET status='approved', reviewed_at=NOW() WHERE id=$1`,
      [r.id]
    );
    await pool.query(
      `UPDATE bookings SET deposit_paid=1, deposit_paid_at=NOW(), status='approved' WHERE id=$1`,
      [r.booking_id]
    );

    const { rows: bk } = await pool.query(`
      SELECT b.*, a.name AS artist_name
      FROM bookings b LEFT JOIN artists a ON a.id = b.artist_id
      WHERE b.id = $1
    `, [r.booking_id]);
    if (bk[0]) {
      mail.send({ to: bk[0].email, ...mail.tplClientConfirmedFull(bk[0], bk[0].artist_name) });
    }

    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post("/receipts/:id/reject", async (req, res, next) => {
  try {
    const reason = String(req.body?.reason || "").slice(0, 500);
    const { rows } = await pool.query(
      `SELECT * FROM receipts WHERE id = $1`, [req.params.id]
    );
    const r = rows[0];
    if (!r) return res.status(404).json({ error: "Not found" });

    await pool.query(
      `UPDATE receipts SET status='rejected', reason=$1, reviewed_at=NOW() WHERE id=$2`,
      [reason, r.id]
    );

    const { rows: bk } = await pool.query(`SELECT * FROM bookings WHERE id = $1`, [r.booking_id]);
    if (bk[0]) {
      mail.send({ to: bk[0].email, ...mail.tplClientReceiptRejected(bk[0], reason) });
    }

    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
