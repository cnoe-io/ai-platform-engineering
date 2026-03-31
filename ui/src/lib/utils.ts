import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { formatDistanceToNow } from "date-fns";

// Default reload interval in seconds (24 hours) - matches backend DEFAULT_RELOAD_INTERVAL
export const DEFAULT_RELOAD_INTERVAL = 86400;

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

/**
 * Format a date/timestamp as relative time (e.g., "2 hours ago", "in 3 days").
 * Handles Date objects, ISO strings, and Unix timestamps (in seconds).
 */
export function formatRelativeTime(date: Date | string | number): string {
  let d: Date;
  if (typeof date === "number") {
    // Unix timestamp in seconds
    d = new Date(date * 1000);
  } else if (typeof date === "string") {
    d = new Date(date);
  } else {
    d = date;
  }
  return formatDistanceToNow(d, { addSuffix: true });
}

/**
 * Format a date/timestamp as compact relative time (e.g., "30m ago", "3h ago", "2d ago").
 * Useful for UI elements with limited space.
 */
export function formatRelativeTimeCompact(date: Date | string | number): string {
  let d: Date;
  if (typeof date === "number") {
    // Unix timestamp in seconds
    d = new Date(date * 1000);
  } else if (typeof date === "string") {
    d = new Date(date);
  } else {
    d = date;
  }
  
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString();
}

/**
 * Format fresh_until timestamp as human-readable freshness status.
 * Shows "Fresh for X" if in future, "Stale X ago" if in past.
 * 
 * @param timestamp Unix timestamp in seconds
 */
export function formatFreshUntil(timestamp: number): string {
  const now = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000);

  if (timestamp > now) {
    // Future: data is still fresh
    return `Fresh for ${formatDistanceToNow(date)}`;
  } else {
    // Past: data is stale
    return `Stale ${formatDistanceToNow(date, { addSuffix: true })}`;
  }
}

/**
 * Calculate next reload time and format as relative string.
 * Shows "Reloads in X" if in future, "Overdue by X" if in past.
 * 
 * @param lastUpdated Unix timestamp of last update (seconds)
 * @param reloadInterval Reload interval in seconds
 */
export function formatNextReload(lastUpdated: number | null | undefined, reloadInterval: number): string {
  if (lastUpdated == null) {
    return "Never updated";
  }
  
  const nextReload = lastUpdated + reloadInterval;
  const now = Math.floor(Date.now() / 1000);
  const date = new Date(nextReload * 1000);

  if (nextReload > now) {
    return `Reloads in ${formatDistanceToNow(date)}`;
  } else {
    return `Refresh overdue by ${formatDistanceToNow(date)}`;
  }
}

/**
 * Check if a datasource refresh is overdue.
 * 
 * @param lastUpdated Unix timestamp of last update (seconds)
 * @param reloadInterval Reload interval in seconds
 * @returns true if refresh is overdue (past reload_interval)
 */
export function isRefreshOverdue(lastUpdated: number | null | undefined, reloadInterval: number): boolean {
  if (lastUpdated == null) {
    return false; // Never updated = not overdue (just new)
  }
  const now = Math.floor(Date.now() / 1000);
  return now > lastUpdated + reloadInterval;
}

/**
 * @deprecated Use isRefreshOverdue instead
 */
export function isDatasourceStale(lastUpdated: number | null | undefined, reloadInterval: number): boolean {
  return isRefreshOverdue(lastUpdated, reloadInterval);
}
