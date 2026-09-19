import express from "express";
import helmet from "helmet";
import session from "express-session";
import cookieParser from "cookie-parser";
import fs from "node:fs";

import { config } from "./config.js";
import { matchesAdminSlug } from "./auth.js";
import publicRoutes from "./routes/public.js";
import adminRoutes  from "./routes/admin.js";
import { notFound, errorHandler } from "./middleware/errors.js";

// Ensure runtime dirs exist
fs.mkdirSync(config.dataDir,    { recursive: true });
fs.mkdirSync(config.uploadsDir, { recursive: true });

const app = express();

app.set("trust proxy", 1);

// ── Security headers ──────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false,       // adjust if you add CDNs
  crossOriginEmbedderPolicy: false,
}));

// ── Parsers ───────────────────────────────────────────────────
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.use(cookieParser());

// ── Session ───────────────────────────────────────────────────
app.use(session({
  name: "sqsp_sid",
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: config.isProd,
    sameSite: "strict",
    maxAge: 1000 * 60 * 60 * 24,     // 24h
  },
}));

// ── Static frontend ───────────────────────────────────────────
app.use(express.static(config.publicDir, {
  index: false,
  setHeaders(res, filePath) {
    if (filePath.endsWith(".html")) res.setHeader("Cache-Control", "no-cache");
    else res.setHeader("Cache-Control", "public, max-age=3600");
  },
}));

// ── Public API ────────────────────────────────────────────────
app.use("/api", publicRoutes);

// ── Root → booking page ───────────────────────────────────────
app.get("/", (_req, res) =>
  res.sendFile("index.html", { root: config.publicDir })
);

// ─────────────────────────────────────────────────────────────
// ADMIN — served from /<secret-slug>, verified by bcrypt
// ─────────────────────────────────────────────────────────────
app.use("/:slug", async (req, res, next) => {
  const { slug } = req.params;
  if (!slug || slug.length < 20 || slug.length > 80) return next();

  const isAdmin = await matchesAdminSlug(slug);
  if (!isAdmin) return next();

  if (req.path === "/" || req.path === "") {
    return res.sendFile("admin.html", { root: config.publicDir });
  }
  next();
});

app.use("/:slug/api/admin", adminRoutes);

// ── Fallthroughs ──────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

// ── Boot ──────────────────────────────────────────────────────
app.listen(config.port, () => {
  console.log(`\n  405INK server → http://localhost:${config.port}`);
  if (!config.adminSlugHash) {
    console.warn("  ⚠  ADMIN_SLUG_HASH not set — admin panel disabled.");
  }
});
