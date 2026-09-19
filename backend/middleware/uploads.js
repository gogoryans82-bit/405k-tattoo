import multer from "multer";
import path from "node:path";
import crypto from "node:crypto";
import { config } from "../config.js";

// ── Shared disk storage ─────────────────────────────────────────
function makeStorage(prefix) {
  return multer.diskStorage({
    destination: config.uploadsDir,
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase().slice(0, 6);
      cb(null, `${prefix}-${Date.now()}-${crypto.randomBytes(6).toString("hex")}${ext}`);
    },
  });
}

const imageFilter = (_req, file, cb) =>
  cb(null, /^image\/(jpe?g|png|webp|gif)$/i.test(file.mimetype));

const strictImageFilter = (_req, file, cb) =>
  cb(null, /^image\/(jpe?g|png|webp)$/i.test(file.mimetype));

// Reference images on the booking form
export const uploadReferences = multer({
  storage: makeStorage("ref"),
  limits: { fileSize: 8 * 1024 * 1024, files: 5 },
  fileFilter: imageFilter,
});

// Single artist avatar
export const uploadArtistImage = multer({
  storage: makeStorage("artist"),
  limits: { fileSize: 6 * 1024 * 1024, files: 1 },
  fileFilter: strictImageFilter,
}).single("image");
