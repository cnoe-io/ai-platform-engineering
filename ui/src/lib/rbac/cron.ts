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

/**
 * Expand a single (already validated) cron field into the explicit set of
 * values it matches. Mirrors `isValidField`'s grammar (`*`, number, range,
 * list, step). Returns null if any element is malformed, so callers can treat
 * an unparseable expression as "never matches" rather than throwing.
 */
function expandField(field: string, min: number, max: number): Set<number> | null {
  const values = new Set<number>();

  for (const part of field.split(",")) {
    if (part.length === 0) return null;

    // Step syntax: base/step (e.g. "*/5", "0-30/10"). Default step is 1.
    let base = part;
    let step = 1;
    if (part.includes("/")) {
      const [stepBase, stepRaw, ...rest] = part.split("/");
      if (rest.length > 0) return null;
      if (!/^\d+$/.test(stepRaw) || Number(stepRaw) <= 0) return null;
      base = stepBase;
      step = Number(stepRaw);
    }

    // Resolve the base into a [lo, hi] range: `*` is the full field range,
    // `a-b` is an explicit range, and a bare number is a single-value range.
    let lo: number;
    let hi: number;
    if (base === "*") {
      lo = min;
      hi = max;
    } else if (base.includes("-")) {
      const [a, b, ...rest] = base.split("-");
      if (rest.length > 0) return null;
      if (!isValidNumberInRange(a, min, max) || !isValidNumberInRange(b, min, max)) return null;
      lo = Number(a);
      hi = Number(b);
      if (lo > hi) return null;
    } else {
      if (!isValidNumberInRange(base, min, max)) return null;
      lo = Number(base);
      hi = lo;
    }

    for (let v = lo; v <= hi; v += step) values.add(v);
  }

  return values;
}

/**
 * Returns true when `date` (evaluated in UTC) satisfies the 5-field cron
 * expression `expr`. Invalid/unparseable expressions never match.
 *
 * Evaluated in UTC deliberately: server pods run UTC, so an operator entering
 * `0 2 * * *` gets 02:00 UTC. The Identity Sync UI labels the field as UTC.
 *
 * Day-of-month / day-of-week use the standard crontab OR-semantics: when BOTH
 * are restricted (neither is `*`), the day matches if EITHER field matches.
 * When only one is restricted, only that one constrains the day.
 */
export function cronMatches(expr: string | undefined | null, date: Date): boolean {
  if (!isValidCron(expr)) return false;
  const fields = expr!.trim().split(/\s+/);

  const sets = fields.map((field, i) => expandField(field, FIELD_BOUNDS[i][0], FIELD_BOUNDS[i][1]));
  if (sets.some((s) => s === null)) return false;
  const [minutes, hours, daysOfMonth, months, daysOfWeek] = sets as Set<number>[];

  if (!minutes.has(date.getUTCMinutes())) return false;
  if (!hours.has(date.getUTCHours())) return false;
  if (!months.has(date.getUTCMonth() + 1)) return false;

  // Crontab day-matching: if both DOM and DOW are restricted, OR them;
  // otherwise the restricted one (if any) constrains the day.
  const domRestricted = fields[2] !== "*";
  const dowRestricted = fields[4] !== "*";
  const domMatch = daysOfMonth.has(date.getUTCDate());
  const dowMatch = daysOfWeek.has(date.getUTCDay());
  if (domRestricted && dowRestricted) {
    if (!domMatch && !dowMatch) return false;
  } else if (domRestricted) {
    if (!domMatch) return false;
  } else if (dowRestricted) {
    if (!dowMatch) return false;
  }

  return true;
}
