import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { config } from "./config.js";

// In-memory cache of slugs that already matched once.
// We never re-hash a slug we've already validated in this process.
const verifiedSlugs = new Set();

/** Is this request reaching the secret admin URL? */
export async function matchesAdminSlug(slug) {
  if (!slug || typeof slug !== "string") return false;
  if (verifiedSlugs.has(slug)) return true;

  // Shape guard so we never bcrypt arbitrary attacker strings
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(slug)) return false;
  if (!config.adminSlugHash) return false;

  try {
    const ok = await bcrypt.compare(slug, config.adminSlugHash);
    if (ok) verifiedSlugs.add(slug);
    return ok;
  } catch {
    return false;
  }
}

/** Verify the login password inside the admin panel. */
export async function verifyAdminPassword(password) {
  if (!password || typeof password !== "string") return false;
  if (!config.adminPasswordHash) return false;
  try {
    return await bcrypt.compare(password, config.adminPasswordHash);
  } catch {
    return false;
  }
}

/** Express middleware — requires a logged-in admin session. */
export function requireAdminSession(req, res, next) {
  if (req.session?.isAdmin === true) return next();
  return res.status(401).json({ error: "Not authenticated" });
}

/** CSRF token helper (double-submit pattern). */
export function issueCsrfToken(req) {
  if (!req.session) return null;
  if (!req.session.csrf) {
    req.session.csrf = crypto.randomBytes(32).toString("hex");
  }
  return req.session.csrf;
}

export function requireCsrf(req, res, next) {
  const token = req.get("x-csrf-token") || req.body?._csrf;
  if (!token || token !== req.session?.csrf) {
    return res.status(403).json({ error: "Invalid CSRF token" });
  }
  next();
}
