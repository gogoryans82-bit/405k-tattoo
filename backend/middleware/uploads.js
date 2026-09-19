// backend/middleware/uploads.js
import multer from "multer";
import multerS3 from "multer-s3";
import { S3Client } from "@aws-sdk/client-s3";
import crypto from "node:crypto";

const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: "auto", // Use the region your provider requires (e.g., "us-east-1")
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  },
  forcePathStyle: true, // Needed for some providers
});

const storage = multerS3({
  s3: s3,
  bucket: process.env.S3_BUCKET_NAME,
  acl: "public-read",
  key: (_req, file, cb) => {
    const ext = file.originalname.split(".").pop();
    cb(null, `uploads/${Date.now()}-${crypto.randomBytes(6).toString("hex")}.${ext}`);
  },
});

const imageFilter = (_req, file, cb) =>
  cb(null, /^image\/(jpe?g|png|webp|gif)$/i.test(file.mimetype));

export const uploadReferences = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024, files: 5 },
  fileFilter: imageFilter,
});

export const uploadArtistImage = multer({
  storage,
  limits: { fileSize: 6 * 1024 * 1024, files: 1 },
  fileFilter: imageFilter,
}).single("image");
