const HOST_RE = /^[A-Za-z0-9._-]+(?::\d{1,5})?$/;

function configuredOrigin(name: "TOME_PUBLIC_ORIGIN" | "NEXTAUTH_URL"): string | null {
  const raw = process.env[name]?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

function forwardedValue(value: string | null): string | null {
  return value?.split(",")[0].trim() || null;
}

/** Resolve the public TOME origin used in downloadable presentation links. */
export function presentationPublicOrigin(request: Request): string {
  const fromConfig = configuredOrigin("TOME_PUBLIC_ORIGIN") ?? configuredOrigin("NEXTAUTH_URL");
  if (fromConfig) return fromConfig;

  const forwardedHost = forwardedValue(request.headers.get("x-forwarded-host"));
  const forwardedProto = forwardedValue(request.headers.get("x-forwarded-proto"))?.toLowerCase();
  if (
    forwardedHost
    && HOST_RE.test(forwardedHost)
    && (forwardedProto === "http" || forwardedProto === "https")
  ) {
    return `${forwardedProto}://${forwardedHost}`;
  }

  try {
    return new URL(request.url).origin;
  } catch {
    return "http://localhost:3000";
  }
}
