import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatTimestamp(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export function generateId(): string {
  // Generate a proper UUID v4 (required by A2A protocol for context_id)
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for older environments
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + "...";
}

export function parseSSELine(line: string): { event?: string; data?: string } | null {
  if (!line || line.startsWith(":")) return null;

  if (line.startsWith("event:")) {
    return { event: line.slice(6).trim() };
  }

  if (line.startsWith("data:")) {
    return { data: line.slice(5).trim() };
  }

  return null;
}

/**
 * Deduplicate an array of items by a key property, keeping the first occurrence.
 *
 * This is used to prevent React duplicate key warnings when localStorage cache
 * and MongoDB sync race conditions produce duplicate entries (e.g., messages
 * with the same ID appearing twice in a conversation).
 *
 * @param items Array of items to deduplicate
 * @param keyFn Function to extract the unique key from each item
 * @returns New array with duplicates removed (first occurrence kept)
 */
export function deduplicateByKey<T>(items: T[], keyFn: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = keyFn(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
