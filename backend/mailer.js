import nodemailer from "nodemailer";
import { config } from "./config.js";

// ═══════════════════════════════════════════════════════════════
// TRANSPORT LAYER  (SMTP · Brevo API · Resend API)
// ═══════════════════════════════════════════════════════════════

// ── Shared: parse "Name <email>" ──────────────────────────────
function parseFrom(str) {
  const m = String(str).match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1] || undefined, email: m[2] };
  return { email: String(str).trim() };
}

// ── Provider: SMTP ────────────────────────────────────────────
function makeSmtpTransport() {
  const t = nodemailer.createTransport({
    host:   config.smtp.host,
    port:   config.smtp.port,
    secure: config.smtp.secure,
    auth:   config.smtp.user
      ? { user: config.smtp.user, pass: config.smtp.pass }
      : undefined,
  });
  return {
    name: "smtp",
    async send({ from, to, subject, html }) {
      const info = await t.sendMail({ from, to, subject, html });
      return info.messageId;
    },
  };
}

// ── Provider: Brevo API ───────────────────────────────────────
async function makeBrevoTransport() {
  const { BrevoClient } = await import("@getbrevo/brevo");
  const brevo = new BrevoClient({
    apiKey: config.brevo.apiKey,
    timeoutInSeconds: 30,
    maxRetries: 2,
  });
  const sender = parseFrom(config.mailFrom);

  return {
    name: "brevo",
    async send({ from, to, subject, html }) {
      const s = parseFrom(from);
      const res = await brevo.transactionalEmails.sendTransacEmail({
        subject,
        htmlContent: html,
        sender:      { name: s.name || config.mailFromName, email: s.email },
        to:          [{ email: to }],
        ...(config.brevo.senderIP ? { headers: { "sender.ip": config.brevo.senderIP } } : {}),
      });
      return res?.messageId || res?.messageIds?.[0];
    },
  };
}

// ── Provider: Resend API ──────────────────────────────────────
async function makeResendTransport() {
  const { Resend } = await import("resend");
  const resend = new Resend(config.resend.apiKey);

  return {
    name: "resend",
    async send({ from, to, subject, html }) {
      const { data, error } = await resend.emails.send({
        from,
        to: [to],
        subject,
        html,
      });
      if (error) throw new Error(error.message || "Resend send failed");
      return data?.id;
    },
  };
}

// ── Factory ───────────────────────────────────────────────────
let _transportPromise = null;

function getTransport() {
  if (_transportPromise) return _transportPromise;

  _transportPromise = (async () => {
    switch (config.mailProvider) {
      case "brevo":
        return makeBrevoTransport();
      case "resend":
        return makeResendTransport();
      case "smtp":
      default:
        return makeSmtpTransport();
    }
  })();

  return _transportPromise;
}

// ═══════════════════════════════════════════════════════════════
// SHARED SHELL + HELPERS  (unchanged from previous version)
// ═══════════════════════════════════════════════════════════════

function shell(title, bodyHtml) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${title}</title></head>
<body style="margin:0;background:#f4f4f4;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111;">
  <div style="max-width:600px;margin:0 auto;padding:32px 16px;">
    <div style="background:#000;color:#fff;padding:24px;text-align:center;">
      <h1 style="margin:0;font-size:20px;letter-spacing:.15em;">405INK TATTOO STUDIO</h1>
    </div>
    <div style="background:#fff;padding:32px;line-height:1.6;">
      ${bodyHtml}
    </div>
    <div style="text-align:center;color:#888;font-size:12px;padding:24px;">
      <p>14900 S Western Ave #110, Oklahoma City, OK 73170</p>
      <p><a href="sms:4054304581" style="color:#888;">(405) 430-4581</a></p>
    </div>
  </div>
</body></html>`;
}

function fmtDate(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-US", {
      weekday: "long", year: "numeric", month: "long",
      day: "numeric", hour: "numeric", minute: "2-digit",
    });
  } catch { return iso; }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ═══════════════════════════════════════════════════════════════
// TEMPLATES  (identical to previous version — see full file)
// ═══════════════════════════════════════════════════════════════

export function tplAdminNewBooking(b) { /* ... unchanged ... */ }
export function tplClientReceived(b)   { /* ... unchanged ... */ }
export function tplClientDepositDue(b, artistName) { /* ... unchanged ... */ }
export function tplClientConfirmed(b, artistName)  { /* ... unchanged ... */ }

// ═══════════════════════════════════════════════════════════════
// SENDER  (the only public API used by your routes)
// ═══════════════════════════════════════════════════════════════

export async function send({ to, subject, html }) {
  if (!to) return;

  try {
    const transport = await getTransport();
    const id = await transport.send({
      from:    config.mailFrom,
      to,
      subject,
      html,
    });

    if (!config.isProd) {
      console.log(`[mail:${transport.name}] ${subject} → ${to} (${id ?? "no-id"})`);
    }
    return { ok: true, id };
  } catch (err) {
    console.error(`[mail:${config.mailProvider}] failed:`, err.message);
    // Do NOT throw — booking submission must not fail if email fails.
    return { ok: false, error: err.message };
  }
}

export const ADMIN = config.adminEmail;
