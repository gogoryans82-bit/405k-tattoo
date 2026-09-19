// backend/paymentMethods.js
import { pool } from "./db.js";

export async function listPaymentMethods({ onlyEnabled = false } = {}) {
  const where = onlyEnabled ? "WHERE enabled = 1" : "";
  const { rows } = await pool.query(
    `SELECT * FROM payment_methods ${where} ORDER BY sort_order, id`
  );
  return rows;
}

export async function getPaymentMethodByKey(key) {
  if (!key) return null;
  const { rows } = await pool.query(
    `SELECT * FROM payment_methods WHERE key = $1`,
    [key]
  );
  return rows[0] || null;
}

export async function getDefaultMinDeposit() {
  const { rows } = await pool.query(
    `SELECT value FROM settings WHERE key = 'min_deposit_default'`
  );
  const n = Number(rows[0]?.value);
  return Number.isFinite(n) ? n : 50;
}

/**
 * Validate a deposit against the global minimum + the method's min/max.
 * Returns { ok, error?, min?, max? }.
 */
export async function validateDeposit(methodKey, amount) {
  if (amount == null || amount === "") return { ok: true };

  const n = Number(amount);
  if (!Number.isFinite(n) || n < 0) {
    return { ok: false, error: "Invalid deposit amount" };
  }

  const globalMin = await getDefaultMinDeposit();
  let min = globalMin;
  let max = null;

  if (methodKey) {
    const m = await getPaymentMethodByKey(methodKey);
    if (!m)         return { ok: false, error: "Unknown payment method" };
    if (!m.enabled) return { ok: false, error: "That payment method is disabled" };
    if (m.min_deposit != null) min = Number(m.min_deposit);
    if (m.max_deposit != null) max = Number(m.max_deposit);
  }

  if (n < min) return { ok: false, error: `Minimum deposit is $${min}`, min, max };
  if (max != null && n > max) {
    return { ok: false, error: `Maximum deposit is $${max}`, min, max };
  }
  return { ok: true, min, max };
}
