const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const DAY_ALIASES: Record<string, number> = {
  SUN: 0,
  MON: 1,
  TUE: 2,
  WED: 3,
  THU: 4,
  FRI: 5,
  SAT: 6,
};

const MONTH_ALIASES: Record<string, number> = {
  JAN: 1,
  FEB: 2,
  MAR: 3,
  APR: 4,
  MAY: 5,
  JUN: 6,
  JUL: 7,
  AUG: 8,
  SEP: 9,
  OCT: 10,
  NOV: 11,
  DEC: 12,
};

type ParsedField =
  | { kind: "any"; raw: string }
  | { kind: "every"; raw: string; step: number }
  | { kind: "values"; raw: string; values: number[] }
  | { kind: "complex"; raw: string };

function parseCronField(
  raw: string,
  min: number,
  max: number,
  aliases: Record<string, number> = {},
  normalize?: (value: number) => number
): ParsedField {
  const value = raw.trim().toUpperCase();
  if (value === "*") return { kind: "any", raw };

  const everyMatch = value.match(/^\*\/([1-9]\d*)$/);
  if (everyMatch) {
    const step = Number(everyMatch[1]);
    if (step <= max) return { kind: "every", raw, step };
  }

  const values: number[] = [];
  for (const part of value.split(",")) {
    if (!part || part.includes("/")) return { kind: "complex", raw };

    const rangeMatch = part.match(/^([A-Z]+|\d+)-([A-Z]+|\d+)$/);
    if (rangeMatch) {
      const start = parseCronValue(rangeMatch[1], aliases, normalize);
      const end = parseCronValue(rangeMatch[2], aliases, normalize);
      if (start === null || end === null || start > end) {
        return { kind: "complex", raw };
      }
      for (let number = start; number <= end; number += 1) {
        values.push(number);
      }
      continue;
    }

    const number = parseCronValue(part, aliases, normalize);
    if (number === null) return { kind: "complex", raw };
    values.push(number);
  }

  const unique = Array.from(new Set(values)).filter(
    (number) => number >= min && number <= max
  );
  if (unique.length === 0 || unique.length !== values.length) {
    return { kind: "complex", raw };
  }

  return { kind: "values", raw, values: unique.sort((a, b) => a - b) };
}

function parseCronValue(
  raw: string,
  aliases: Record<string, number>,
  normalize?: (value: number) => number
): number | null {
  const parsed = aliases[raw] ?? (/^\d+$/.test(raw) ? Number(raw) : null);
  if (parsed === null) return null;
  return normalize ? normalize(parsed) : parsed;
}

function singleValue(field: ParsedField): number | null {
  return field.kind === "values" && field.values.length === 1 ? field.values[0] : null;
}

function isAny(field: ParsedField): boolean {
  return field.kind === "any";
}

function formatTime(hour: number, minute: number): string {
  const period = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 || 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${period}`;
}

function formatList(items: string[]): string {
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function formatNumbers(values: number[]): string {
  return formatList(values.map(String));
}

function formatDays(values: number[]): string {
  return formatList(values.map((value) => DAY_NAMES[value]));
}

function formatMonths(values: number[]): string {
  return formatList(values.map((value) => MONTH_NAMES[value - 1]));
}

export function humanizeCron(cron: string): string | null {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return null;

  const minute = parseCronField(parts[0], 0, 59);
  const hour = parseCronField(parts[1], 0, 23);
  const dayOfMonth = parseCronField(parts[2], 1, 31);
  const month = parseCronField(parts[3], 1, 12, MONTH_ALIASES);
  const dayOfWeek = parseCronField(
    parts[4],
    0,
    6,
    DAY_ALIASES,
    (value) => (value === 7 ? 0 : value)
  );

  if (
    minute.kind === "every" &&
    isAny(hour) &&
    isAny(dayOfMonth) &&
    isAny(month) &&
    isAny(dayOfWeek)
  ) {
    return `Every ${minute.step} minute${minute.step === 1 ? "" : "s"}`;
  }

  if (
    isAny(minute) &&
    isAny(hour) &&
    isAny(dayOfMonth) &&
    isAny(month) &&
    isAny(dayOfWeek)
  ) {
    return "Every minute";
  }

  const minuteValue = singleValue(minute);
  const hourValue = singleValue(hour);
  if (minuteValue === null || hourValue === null) return null;

  const prefix = `At ${formatTime(hourValue, minuteValue)}`;

  if (isAny(dayOfMonth) && isAny(month) && isAny(dayOfWeek)) {
    return `${prefix} every day`;
  }

  if (isAny(dayOfMonth) && isAny(month) && dayOfWeek.kind === "values") {
    return `${prefix} on ${formatDays(dayOfWeek.values)}`;
  }

  if (dayOfMonth.kind === "values" && isAny(month) && isAny(dayOfWeek)) {
    return `${prefix} on day ${formatNumbers(dayOfMonth.values)} of every month`;
  }

  if (isAny(dayOfMonth) && month.kind === "values" && isAny(dayOfWeek)) {
    return `${prefix} every day in ${formatMonths(month.values)}`;
  }

  if (dayOfMonth.kind === "values" && month.kind === "values" && isAny(dayOfWeek)) {
    return `${prefix} on day ${formatNumbers(dayOfMonth.values)} in ${formatMonths(
      month.values
    )}`;
  }

  return null;
}
