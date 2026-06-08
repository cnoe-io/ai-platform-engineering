/**
 * Resolve the public-facing origin (`https://host`) for URLs we hand back
 * to clients.
 *
 * Inside a Next.js route handler running behind an ingress, `request.url`
 * can be the internal listen address (for example `http://0.0.0.0:3000`)
 * instead of the public hostname the user actually called.
 */

const HOST_RE = /^[A-Za-z0-9.\-_]+(?::\d{1,5})?$/;

function sanitizeProto(raw: string | null | undefined): "http" | "https" | null {
  if (!raw) return null;
  const v = raw.split(",")[0].trim().toLowerCase();
  return v === "http" || v === "https" ? v : null;
}

function sanitizeHost(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const v = raw.split(",")[0].trim();
  return v && HOST_RE.test(v) ? v : null;
}

function originFromNextAuthUrl(): string | null {
  const raw = process.env.NEXTAUTH_URL?.trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.origin;
  } catch {
    return null;
  }
}

export function getRequestOrigin(request: Request): string {
  const fromEnv = originFromNextAuthUrl();
  if (fromEnv) return fromEnv;

  const headers = request.headers;
  const xfProto = sanitizeProto(headers.get("x-forwarded-proto"));
  const xfHost = sanitizeHost(headers.get("x-forwarded-host"));
  if (xfProto && xfHost) return `${xfProto}://${xfHost}`;

  try {
    return new URL(request.url).origin;
  } catch {
    return "http://localhost:3000";
  }
}
