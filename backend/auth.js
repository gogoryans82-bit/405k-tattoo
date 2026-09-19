// backend/auth.js
import bcrypt from "bcryptjs";

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();

let _hash = null;
function getHash() {
  if (_hash) return _hash;
  const h = (process.env.ADMIN_PASSWORD_HASH || "").trim();
  if (h) { _hash = h; return _hash; }
  // Dev-only convenience. Do NOT set ADMIN_PASSWORD in production.
  const p = process.env.ADMIN_PASSWORD || "";
  if (p) { _hash = bcrypt.hashSync(p, 12); return _hash; }
  return null;
}

export function adminConfigured() {
  return !!getHash() && !!ADMIN_EMAIL;
}

export function adminEmail() {
  return ADMIN_EMAIL;
}

export async function verifyAdmin(email, password) {
  const hash = getHash();
  if (!hash || !ADMIN_EMAIL) return false;

  const emailOk = String(email || "").trim().toLowerCase() === ADMIN_EMAIL;
  // Always run compare so timing doesn't leak which half failed.
  const passOk = await bcrypt.compare(String(password || ""), hash);
  return emailOk && passOk;
}

export function requireAdmin(req, res, next) {
  if (req.session?.admin) return next();
  res.status(401).json({ error: "Not authenticated" });
}
