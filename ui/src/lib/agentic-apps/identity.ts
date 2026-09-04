import { createHash } from "node:crypto";

/** Stable CAS subject: prefer the IdP subject and never use a raw email fallback. */
export function deriveAgenticAppSubjectId(session: Record<string, unknown>): string | null;
export function deriveAgenticAppSubjectId(
  session: Record<string, unknown>,
  email: string,
): string;
export function deriveAgenticAppSubjectId(
  session: Record<string, unknown>,
  email?: string,
): string | null {
  const sub = typeof session.sub === "string" ? session.sub.trim() : "";
  return sub || (email ? hashAgenticAppIdentifier(email) : null);
}

/** One-way identifier used by token and decision audit records. */
export function hashAgenticAppIdentifier(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
