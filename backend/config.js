export const config = {
  // ... existing fields ...

  // ── Mail ────────────────────────────────────────────────────
  mailProvider: (process.env.MAIL_PROVIDER || "smtp").toLowerCase(),

  mailFrom:     process.env.MAIL_FROM     || "405INK <noreply@localhost>",
  mailFromName: process.env.MAIL_FROM_NAME || "405INK Studio",
  adminEmail:   process.env.ADMIN_EMAIL,
  paypalEmail:  process.env.PAYPAL_EMAIL || "",

  smtp: {
    host:   process.env.SMTP_HOST,
    port:   Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    user:   process.env.SMTP_USER,
    pass:   process.env.SMTP_PASS,
  },

  brevo: {
    apiKey:   process.env.BREVO_API_KEY,
    senderIP: process.env.BREVO_SENDER_IP || undefined,
  },

  resend: {
    apiKey: process.env.RESEND_API_KEY,
  },
};

// ── Fail-fast validation ──────────────────────────────────────
const PROVIDERS = ["smtp", "brevo", "resend"];
if (!PROVIDERS.includes(config.mailProvider)) {
  throw new Error(
    `MAIL_PROVIDER must be one of: ${PROVIDERS.join(", ")} (got "${config.mailProvider}")`
  );
}

if (config.isProd) {
  const missing = {
    smtp:   () => !config.smtp.host || !config.smtp.user,
    brevo:  () => !config.brevo.apiKey,
    resend: () => !config.resend.apiKey,
  }[config.mailProvider];

  if (missing()) {
    throw new Error(
      `MAIL_PROVIDER="${config.mailProvider}" but its required env vars are missing.`
    );
  }
}
