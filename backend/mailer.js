// backend/mailer.js
import nodemailer from "nodemailer";

const config = {
  baseUrl: process.env.BASE_URL || "http://localhost:3000",
  from: process.env.MAIL_FROM || "405INK <no-reply@405ink.com>",
};

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: Number(process.env.SMTP_PORT) === 465,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

export function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    weekday: "long", month: "long", day: "numeric",
    year: "numeric", hour: "numeric", minute: "2-digit",
  });
}

export function fmtDay(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

function shell(title, body) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;background:#f4f4f2;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#111;">
  <div style="max-width:600px;margin:0 auto;padding:32px 24px;">
    <div style="background:#000;color:#fff;padding:20px 28px;font-weight:700;letter-spacing:.1em;">
      405INK TATTOO STUDIO
    </div>
    <div style="background:#fff;padding:32px 28px;border:1px solid rgba(0,0,0,.08);">
      ${body}
    </div>
    <div style="color:#888;font-size:.75rem;text-align:center;padding:20px;">
      405INK · 14900 S Western Ave #110, Oklahoma City, OK 73170 · (405) 430-4581
    </div>
  </div>
</body></html>`;
}

function statusButton(b) {
  const url = `${config.baseUrl}/status.html?ref=${encodeURIComponent(b.ref)}&email=${encodeURIComponent(b.email)}`;
  return `
    <p style="margin:0 0 20px;">
      <a href="${url}"
         style="display:inline-block;padding:12px 24px;background:#000;color:#fff;
                text-decoration:none;font-weight:700;font-size:.9rem;">
        View live booking status →
      </a>
    </p>`;
}

async function send({ to, subject, html }) {
  if (!process.env.SMTP_HOST) {
    console.warn("[mailer] SMTP not configured; skipping send to", to);
    return;
  }
  try {
    await transporter.sendMail({ from: config.from, to, subject, html });
  } catch (err) {
    console.error("[mailer] send failed:", err.message);
  }
}

export function tplClientReceived(b) {
  return {
    subject: `We received your booking — ${b.ref}`,
    html: shell("Booking received", `
      <h2 style="margin-top:0;">We got your booking request</h2>
      <p>Hi ${escapeHtml(b.name)},</p>
      <p>Your request <strong>${b.ref}</strong> is in. We'll review it and email you
         payment details shortly.</p>
      ${statusButton(b)}
      <p style="color:#666;font-size:.9rem;">Questions? Reply to this email or text
        <a href="sms:4054304581">(405) 430-4581</a>.</p>
    `),
  };
}

export function tplClientDepositDue(b, artistName, method) {
  const methodBlock = method ? `
    <div style="background:#f6f6f4;padding:20px;margin:20px 0;border-left:4px solid #000;">
      <p style="margin:0 0 8px;font-size:.75rem;text-transform:uppercase;letter-spacing:.1em;color:#666;">
        How to pay your $${b.deposit_amount} deposit
      </p>
      <p style="margin:0 0 6px;"><strong>${escapeHtml(method.label)}</strong></p>
      ${method.handle ? `<p style="margin:0 0 6px;font-family:monospace;font-size:1.05rem;">${escapeHtml(method.handle)}</p>` : ""}
      ${method.instructions ? `<p style="margin:8px 0 0;color:#444;">${escapeHtml(method.instructions)}</p>` : ""}
    </div>` : "";

  return {
    subject: `Deposit due — ${b.ref}`,
    html: shell("Deposit due", `
      <h2 style="margin-top:0;">Your booking is approved</h2>
      <p>Hi ${escapeHtml(b.name)},</p>
      <p>Your deposit of <strong>$${b.deposit_amount}</strong> secures your appointment.
         Artist: <strong>${escapeHtml(artistName || b.artist_preference || "To be assigned")}</strong>.</p>
      ${methodBlock}
      ${statusButton(b)}
      <p style="color:#666;font-size:.9rem;">Upload your receipt from the status page
        once you've paid.</p>
    `),
  };
}

export function tplClientReceiptReceived(b) {
  return {
    subject: `Receipt received — ${b.ref}`,
    html: shell("Receipt received", `
      <h2 style="margin-top:0;">We got your receipt</h2>
      <p>Hi ${escapeHtml(b.name)},</p>
      <p>We're reviewing your payment now. You'll hear from us shortly.</p>
      ${statusButton(b)}
    `),
  };
}

export function tplClientReceiptRejected(b, reason) {
  return {
    subject: `Receipt needs another look — ${b.ref}`,
    html: shell("Receipt rejected", `
      <h2 style="margin-top:0;">We couldn't verify your receipt</h2>
      <p>Hi ${escapeHtml(b.name)},</p>
      <p>${escapeHtml(reason || "Please re-upload a clearer receipt.")}</p>
      ${statusButton(b)}
    `),
  };
}

export function tplClientConfirmedFull(b, artistName) {
  return {
    subject: `Confirmed — ${b.ref}`,
    html: shell("Booking confirmed", `
      <h2 style="margin-top:0;">You're confirmed</h2>
      <p>Hi ${escapeHtml(b.name)},</p>
      <p>Deposit received. Your appointment is
         <strong>${b.appointment_at ? fmtDate(b.appointment_at) : "to be scheduled"}</strong>
         ${artistName ? `with <strong>${escapeHtml(artistName)}</strong>` : ""}.</p>
      ${statusButton(b)}
    `),
  };
}

export function tplClientStatusUpdate(b, artistName, consultationArtistName) {
  const statusLabel = {
    pending:   "Pending review",
    approved:  b.deposit_paid ? "Approved · deposit received" : "Approved · awaiting deposit",
    scheduled: "Scheduled",
    completed: "Completed",
    cancelled: "Cancelled",
  }[b.status] || b.status;

  const consultationBlock = b.consultation_required ? `
    <div style="background:#f6f6f4;padding:16px;border-left:4px solid #000;margin:20px 0;">
      <p style="margin:0 0 8px;font-size:.75rem;text-transform:uppercase;letter-spacing:.1em;color:#666;">
        Consultation
      </p>
      ${b.consultation_done
        ? `<p style="margin:0;"><strong>✓ Completed</strong>${b.consultation_at ? ` on ${fmtDate(b.consultation_at)}` : ""}
             ${consultationArtistName ? ` with ${escapeHtml(consultationArtistName)}` : ""}</p>
           ${b.consultation_notes ? `<p style="margin:8px 0 0;color:#444;">${escapeHtml(b.consultation_notes)}</p>` : ""}`
        : b.consultation_at
          ? `<p style="margin:0;"><strong>Scheduled</strong> for ${fmtDate(b.consultation_at)}
               ${consultationArtistName ? ` with ${escapeHtml(consultationArtistName)}` : ""}</p>`
          : `<p style="margin:0;">To be scheduled. We'll let you know soon.</p>`}
    </div>` : "";

  return {
    subject: `Your booking update — ${b.ref}`,
    html: shell("Booking update", `
      <h2 style="margin-top:0;">Your booking has been updated</h2>
      <p>Hi ${escapeHtml(b.name)},</p>
      ${statusButton(b)}

      <div style="background:#f6f6f4;padding:20px;margin:24px 0;border-left:4px solid #000;">
        <table style="width:100%;border-collapse:collapse;">
          <tr><td style="padding:6px 12px 6px 0;color:#666;">Reference</td>
              <td style="padding:6px 0;"><strong>${b.ref}</strong></td></tr>
          <tr><td style="padding:6px 12px 6px 0;color:#666;">Status</td>
              <td style="padding:6px 0;"><strong>${statusLabel}</strong></td></tr>
          <tr><td style="padding:6px 12px 6px 0;color:#666;">Artist</td>
              <td style="padding:6px 0;">${escapeHtml(artistName || b.artist_preference || "To be assigned")}</td></tr>
          <tr><td style="padding:6px 12px 6px 0;color:#666;">When</td>
              <td style="padding:6px 0;"><strong>${b.appointment_at ? fmtDate(b.appointment_at) : "Not yet scheduled"}</strong></td></tr>
          <tr><td style="padding:6px 12px 6px 0;color:#666;">Placement</td>
              <td style="padding:6px 0;">${escapeHtml(b.placement || "—")}</td></tr>
          <tr><td style="padding:6px 12px 6px 0;color:#666;">Size</td>
              <td style="padding:6px 0;">${escapeHtml(b.size || "—")}</td></tr>
          <tr><td style="padding:6px 12px 6px 0;color:#666;">Style</td>
              <td style="padding:6px 0;">${b.color_mode === "color" ? "Colour" : "Black / grey"}</td></tr>
          <tr><td style="padding:6px 12px 6px 0;color:#666;">Deposit</td>
              <td style="padding:6px 0;">$${b.deposit_amount ?? "—"} ${b.deposit_paid ? "(paid)" : "(awaiting payment)"}</td></tr>
        </table>
      </div>

      ${b.description ? `
        <div style="margin:20px 0;">
          <p style="margin:0 0 6px;font-size:.75rem;text-transform:uppercase;letter-spacing:.1em;color:#666;">
            Tattoo description
          </p>
          <p style="margin:0;white-space:pre-wrap;">${escapeHtml(b.description)}</p>
        </div>` : ""}

      ${consultationBlock}

      <p style="margin-top:24px;color:#666;font-size:.9rem;">
        Questions? Reply to this email or text <a href="sms:4054304581">(405) 430-4581</a>.
      </p>
    `),
  };
}

export function tplAdminNewBooking(b) {
  return {
    subject: `New booking — ${b.ref}`,
    html: shell("New booking", `
      <h2 style="margin-top:0;">New booking received</h2>
      <p><strong>${escapeHtml(b.name)}</strong> · ${escapeHtml(b.email)}</p>
      <p>Ref: <strong>${b.ref}</strong></p>
      <p>${escapeHtml(b.description || "")}</p>
    `),
  };
}

export function tplAdminReceiptUploaded(b) {
  return {
    subject: `Receipt uploaded — ${b.ref}`,
    html: shell("Receipt uploaded", `
      <h2 style="margin-top:0;">A receipt was uploaded</h2>
      <p>Ref: <strong>${b.ref}</strong></p>
    `),
  };
}

export const mail = {
  send,
  tplClientReceived,
  tplClientDepositDue,
  tplClientReceiptReceived,
  tplClientReceiptRejected,
  tplClientConfirmedFull,
  tplClientStatusUpdate,
  tplAdminNewBooking,
  tplAdminReceiptUploaded,
};

export { config };
