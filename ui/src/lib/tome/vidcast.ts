const VIDCAST_ORIGIN = "https://app.vidcast.io";
const VIDCAST_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VIDCAST_PATH_RE = /^\/share\/(?:embed\/)?([^/]+)\/?$/i;
const BOOLEAN_PARAMS = new Set([
  "autoplay",
  "cc",
  "mute",
  "disableCopyDropdown",
  "disableAMA",
]);
const ALLOWED_PARAMS = new Set([...BOOLEAN_PARAMS, "t"]);
const MAX_TITLE_LENGTH = 200;

export interface VidcastEmbed {
  src: string;
  title: string;
  watchUrl: string;
}

export type VidcastParseResult =
  | { ok: true; value: VidcastEmbed }
  | { ok: false; error: string };

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1).trim();
    }
  }
  return trimmed;
}

/** Convert a public Vidcast share URL into the canonical, safe embed URL. */
export function normalizeVidcastUrl(value: string): {
  src: string;
  watchUrl: string;
} | null {
  let input: URL;
  try {
    input = new URL(value.trim());
  } catch {
    return null;
  }

  if (
    input.origin !== VIDCAST_ORIGIN ||
    input.username ||
    input.password ||
    input.port ||
    input.hash
  ) {
    return null;
  }

  const path = input.pathname.match(VIDCAST_PATH_RE);
  const id = path?.[1];
  if (!id || !VIDCAST_ID_RE.test(id)) return null;

  const seen = new Set<string>();
  for (const [key, parameter] of input.searchParams) {
    if (!ALLOWED_PARAMS.has(key) || seen.has(key)) return null;
    seen.add(key);
    if (BOOLEAN_PARAMS.has(key) && !/^[01]$/.test(parameter)) return null;
    if (key === "t" && !/^\d+$/.test(parameter)) return null;
  }

  const canonicalId = id.toLowerCase();
  const src = new URL(`${VIDCAST_ORIGIN}/share/embed/${canonicalId}`);
  const watchUrl = new URL(`${VIDCAST_ORIGIN}/share/${canonicalId}`);
  for (const [key, parameter] of input.searchParams) {
    src.searchParams.set(key, parameter);
    watchUrl.searchParams.set(key, parameter);
  }

  return { src: src.toString(), watchUrl: watchUrl.toString() };
}

/**
 * Parse a `vidcast` fenced block.
 *
 * The block may contain a URL by itself, or `url:` and optional `title:`
 * fields. This intentionally is not general YAML: keeping the accepted shape
 * tiny makes the iframe boundary easy to audit.
 */
export function parseVidcastEmbed(content: string): VidcastParseResult {
  const body = content.trim();
  if (!body) return { ok: false, error: "Vidcast URL is required." };

  let rawUrl = "";
  let title = "Vidcast video";

  if (!body.includes("\n") && /^https:\/\//i.test(body)) {
    rawUrl = body;
  } else {
    const values = new Map<string, string>();
    for (const rawLine of body.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      const field = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
      if (!field) {
        return { ok: false, error: "Use only url: and title: fields in a Vidcast block." };
      }
      const key = field[1].toLowerCase();
      if ((key !== "url" && key !== "title") || values.has(key)) {
        return { ok: false, error: `Unsupported or duplicate Vidcast field: ${field[1]}.` };
      }
      values.set(key, unquote(field[2]));
    }
    rawUrl = values.get("url") ?? "";
    title = values.get("title") || title;
  }

  if (!rawUrl) return { ok: false, error: "Vidcast URL is required." };
  if (title.length > MAX_TITLE_LENGTH) {
    return { ok: false, error: `Vidcast titles must be ${MAX_TITLE_LENGTH} characters or fewer.` };
  }

  const normalized = normalizeVidcastUrl(rawUrl);
  if (!normalized) {
    return {
      ok: false,
      error: "Use an HTTPS app.vidcast.io share URL with only supported playback options.",
    };
  }

  return { ok: true, value: { ...normalized, title } };
}
