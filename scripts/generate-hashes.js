import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";

const COST = 12;

const slug = `studio-${crypto.randomBytes(32).toString("base64url")}`;

const rl = readline.createInterface({ input: stdin, output: stdout });
const password = await rl.question("Choose an admin password (min 12 chars): ");
rl.close();

if (password.length < 12) {
  console.error("Password must be at least 12 characters.");
  process.exit(1);
}

const slugHash = await bcrypt.hash(slug, COST);
const passHash = await bcrypt.hash(password, COST);

console.log("\n── Paste into .env ──────────────────────────────");
console.log(`ADMIN_SLUG_HASH=${slugHash}`);
console.log(`ADMIN_PASSWORD_HASH=${passHash}`);
console.log("\n── Your secret admin URL ────────────────────────");
console.log(`  /${slug}`);
console.log("  Full URL: https://yourdomain.com/" + slug);
console.log("\nSave that URL — it will not be shown again.");
