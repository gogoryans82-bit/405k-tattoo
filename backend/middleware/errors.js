import path from "node:path";
import { config } from "../config.js";

export function notFound(req, res, next) {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ error: "Not found" });
  }
  res.status(404).sendFile(
    path.join(config.publicDir, "404.html"),
    err => { if (err) res.type("text").send("Not found"); }
  );
}

export function errorHandler(err, _req, res, _next) {
  console.error("[error]", err);
  res.status(err.status || 500).json({
    error: err.expose ? err.message : "Server error",
  });
}
