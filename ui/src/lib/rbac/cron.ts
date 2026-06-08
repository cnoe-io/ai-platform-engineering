/**
 * Minimal, zero-dependency validator for standard 5-field cron expressions
 * used by the IdP directory sync schedule (Identity Sync admin tab).
 *
 * Fields (in order): minute hour day-of-month month day-of-week
 *
 *   ┌───────────── minute        (0–59)
 *   │ ┌───────────── hour         (0–23)
 *   │ │ ┌───────────── day-of-month (1–31)
 *   │ │ │ ┌───────────── month        (1–12)
 *   │ │ │ │ ┌───────────── day-of-week  (0–6, Sun=0)
 *   * * * * *
 *
 * Each field supports: `*`, a number, ranges (`a-b`), lists (`a,b,c`),
 * and steps (`* /n` or `a-b/n`). This validates shape and numeric bounds;
 * it does not attempt to compute next-run times.
 */

const FIELD_BOUNDS: ReadonlyArray<readonly [number, number]> = [
  [0, 59], // minute
  [0, 23], // hour
  [1, 31], // day of month
  [1, 12], // month
  [0, 6], // day of week
];

function isValidNumberInRange(value: string, min: number, max: number): boolean {
  if (!/^\d+$/.test(value)) return false;
  const n = Number(value);
  return n >= min && n <= max;
}

/** Validate a single cron field (already split out) against its bounds. */
function isValidField(field: string, min: number, max: number): boolean {
  if (field.length === 0) return false;

  // Comma-separated list — every element must independently validate.
  if (field.includes(",")) {
    return field.split(",").every((part) => isValidField(part, min, max));
  }

  // Step syntax: base/step (e.g. "*/5", "0-30/10").
  let base = field;
  if (field.includes("/")) {
    const [stepBase, stepRaw, ...rest] = field.split("/");
    if (rest.length > 0) return false;
    if (!/^\d+$/.test(stepRaw) || Number(stepRaw) <= 0) return false;
    base = stepBase;
  }

  if (base === "*") return true;

  // Range: a-b.
  if (base.includes("-")) {
    const [a, b, ...rest] = base.split("-");
    if (rest.length > 0) return false;
    if (!isValidNumberInRange(a, min, max) || !isValidNumberInRange(b, min, max)) {
      return false;
    }
    return Number(a) <= Number(b);
  }

  return isValidNumberInRange(base, min, max);
}

/**
 * Returns true when `expr` is a structurally valid standard 5-field cron
 * expression with in-range values. Whitespace-tolerant between fields.
 */
export function isValidCron(expr: string | undefined | null): boolean {
  if (!expr) return false;
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== FIELD_BOUNDS.length) return false;
  return fields.every((field, i) => isValidField(field, FIELD_BOUNDS[i][0], FIELD_BOUNDS[i][1]));
}
