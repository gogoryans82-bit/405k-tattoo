// backend/server.js
import express from "express";
import session from "express-session";
import path from "path";
import { fileURLToPath } from "url";
import { initDb } from "./db.js";
import publicRouter from "./routes/public.js";
import adminRouter from "./routes/admin.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.set("trust proxy", 1);
app.use(express.json({ limit: "8mb" }));
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || "dev-secret-change-me",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 1000 * 60 * 60 * 12,
  },
}));

app.use("/api/admin", adminRouter);
app.use("/api", publicRouter);

const pub = path.join(__dirname, "..", "frontend", "public");
app.use(express.static(pub));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Server error" });
});

const port = Number(process.env.PORT || 3000);

await initDb();
app.listen(port, () => console.log(`405INK listening on :${port}`));
