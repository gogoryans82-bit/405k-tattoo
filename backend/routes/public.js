import express from "express";
import { z } from "zod";

import { db, nextBookingRef, listArtists } from "../db.js";
import * as mail from "../mailer.js";
import { bookingLimiter, uploadLimiter } from "../middleware/rateLimit.js";
import { uploadReferences } from "../middleware/uploads.js";

const router = express.Router();

// ── Public: list active artists ────────────────────────────────
router.get("/artists", (_req, res) => {
  res.json(listArtists({ activeOnly: true }));
});

// ── Public: upload reference images ────────────────────────────
router.post(
  "/uploads",
  uploadLimiter,
  uploadReferences.array("files", 5),
  (req, res) => {
    const urls = (req.files || []).map(f => `/uploads/${f.filename}`);
    res.json({ urls });
  }
);

// ── Public: submit booking ─────────────────────────────────────
const BookingSchema = z.object({
  name:        z.string().min(2).max(120),
  email:       z.string().email(),
  phone:       z.string().min(7).max(40),
  artist_id:   z.coerce.number().int().positive().nullable().optional(),
  artist_preference: z.string().max(120).optional().default(""),
  placement:   z.string().min(1).max(120),
  size:        z.string().min(1).max(60),
  color_mode:  z.enum(["black", "color"]),
  description: z.string().max(4000).optional().default(""),
  preferred_dates: z.string().max(400).optional().default(""),
  reference_urls:  z.array(z.string().max(300)).max(5).optional().default([]),
});

router.post("/bookings", bookingLimiter, async (req, res) => {
  const parsed = BookingSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid submission",
      details: parsed.error.flatten().fieldErrors,
    });
  }
  const data = parsed.data;

  let artist = null;
  if (data.artist_id) {
    artist = db.prepare(
      "SELECT id, name FROM artists WHERE id = ? AND active = 1"
    ).get(data.artist_id);
  }

  const ref = nextBookingRef();

  const info = db.prepare(`
    INSERT INTO bookings
      (ref, name, email, phone, artist_id, artist_preference,
       placement, size, color_mode, description, preferred_dates,
       reference_urls, status)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'pending')
  `).run(
    ref, data.name, data.email, data.phone,
    artist?.id ?? null,
    data.artist_preference || artist?.name || "",
    data.placement, data.size, data.color_mode,
    data.description, data.preferred_dates,
    JSON.stringify(data.reference_urls || [])
  );

  const booking = db.prepare("SELECT * FROM bookings WHERE id = ?")
                    .get(info.lastInsertRowid);
  booking.reference_urls = JSON.parse(booking.reference_urls || "[]");

  // Fire-and-forget emails
  mail.send({ to: mail.ADMIN,        ...mail.tplAdminNewBooking(booking) });
  mail.send({ to: booking.email,     ...mail.tplClientReceived(booking) });

  res.status(201).json({
    ok: true,
    ref: booking.ref,
    message: "Booking received. Check your email for next steps.",
  });
});

// ── Public: lookup by ref + email ──────────────────────────────
router.get("/bookings/:ref", (req, res) => {
  const { ref } = req.params;
  const email = String(req.query.email || "").toLowerCase();
  if (!email) return res.status(400).json({ error: "email query required" });

  const b = db.prepare(`
    SELECT ref, name, status, deposit_amount, deposit_method,
           deposit_paid, appointment_at, artist_preference, created_at
    FROM bookings WHERE ref = ? AND lower(email) = ?
  `).get(ref, email);

  if (!b) return res.status(404).json({ error: "Not found" });
  res.json(b);
});

export default router;
