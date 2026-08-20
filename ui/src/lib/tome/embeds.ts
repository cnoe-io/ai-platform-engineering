import { parseVidcastEmbed } from "@/lib/tome/vidcast";

export type TomeEmbedProvider = "vidcast" | "youtube" | "arxiv";

export interface TomeEmbed {
  provider: TomeEmbedProvider;
  kind: "video" | "document";
  src: string;
  title: string;
  watchUrl: string;
  linkLabel: string;
}

export type TomeEmbedParseResult =
  | { ok: true; value: TomeEmbed }
  | { ok: false; error: string };

interface EmbedFields {
  url: string;
  title: string;
}

const YOUTUBE_VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const ARXIV_MODERN_ID_RE = /^\d{4}\.\d{4,5}(?:v\d+)?$/i;
const ARXIV_LEGACY_ID_RE = /^[A-Za-z][A-Za-z0-9.-]*\/\d{7}(?:v\d+)?$/i;
const MAX_TITLE_LENGTH = 200;

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

function parseEmbedFields(
  content: string,
  providerLabel: string,
  defaultTitle: string,
): { ok: true; value: EmbedFields } | { ok: false; error: string } {
  const body = content.trim();
  if (!body) return { ok: false, error: `${providerLabel} URL is required.` };

  let url = "";
  let title = defaultTitle;
  if (!body.includes("\n")) {
    url = body;
  } else {
    const values = new Map<string, string>();
    for (const rawLine of body.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      const field = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
      if (!field) {
        return {
          ok: false,
          error: `Use only url: and title: fields in a ${providerLabel} block.`,
        };
      }
      const key = field[1].toLowerCase();
      if ((key !== "url" && key !== "title") || values.has(key)) {
        return {
          ok: false,
          error: `Unsupported or duplicate ${providerLabel} field: ${field[1]}.`,
        };
      }
      values.set(key, unquote(field[2]));
    }
    url = values.get("url") ?? "";
    title = values.get("title") || title;
  }

  if (!url) return { ok: false, error: `${providerLabel} URL is required.` };
  if (title.length > MAX_TITLE_LENGTH) {
    return {
      ok: false,
      error: `${providerLabel} titles must be ${MAX_TITLE_LENGTH} characters or fewer.`,
    };
  }
  return { ok: true, value: { url, title } };
}

function parseTime(value: string | null): string | null {
  if (!value) return null;
  if (/^\d+$/.test(value)) return value;
  const match = value.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i);
  if (!match || !match.slice(1).some(Boolean)) return null;
  const seconds =
    Number(match[1] ?? 0) * 3600 +
    Number(match[2] ?? 0) * 60 +
    Number(match[3] ?? 0);
  return String(seconds);
}

/** Normalize common YouTube share, watch, shorts, and embed URLs. */
export function normalizeYouTubeUrl(value: string): {
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
    input.protocol !== "https:" ||
    input.username ||
    input.password ||
    input.port ||
    input.hash
  ) {
    return null;
  }

  const host = input.hostname.toLowerCase();
  let videoId = "";
  if (host === "youtu.be") {
    videoId = input.pathname.match(/^\/([^/]+)\/?$/)?.[1] ?? "";
  } else if (
    host === "youtube.com" ||
    host === "www.youtube.com" ||
    host === "m.youtube.com" ||
    host === "www.youtube-nocookie.com"
  ) {
    if (input.pathname === "/watch") videoId = input.searchParams.get("v") ?? "";
    else videoId = input.pathname.match(/^\/(?:embed|shorts)\/([^/]+)\/?$/)?.[1] ?? "";
  } else {
    return null;
  }
  if (!YOUTUBE_VIDEO_ID_RE.test(videoId)) return null;

  const start = parseTime(input.searchParams.get("start") ?? input.searchParams.get("t"));
  if ((input.searchParams.has("start") || input.searchParams.has("t")) && start === null) {
    return null;
  }

  const src = new URL(`https://www.youtube-nocookie.com/embed/${videoId}`);
  const watchUrl = new URL("https://www.youtube.com/watch");
  watchUrl.searchParams.set("v", videoId);
  if (start && start !== "0") {
    src.searchParams.set("start", start);
    watchUrl.searchParams.set("t", start);
  }
  for (const key of ["autoplay", "controls", "mute", "rel"] as const) {
    const parameter = input.searchParams.get(key);
    if (parameter !== null) {
      if (!/^[01]$/.test(parameter)) return null;
      src.searchParams.set(key, parameter);
    }
  }
  if (input.searchParams.has("cc_load_policy")) {
    if (input.searchParams.get("cc_load_policy") !== "1") return null;
    src.searchParams.set("cc_load_policy", "1");
  }

  return { src: src.toString(), watchUrl: watchUrl.toString() };
}

function normalizeArxivId(value: string): string | null {
  const candidate = value.replace(/^arxiv:/i, "").replace(/\.pdf$/i, "").trim();
  if (!ARXIV_MODERN_ID_RE.test(candidate) && !ARXIV_LEGACY_ID_RE.test(candidate)) return null;
  return candidate;
}

/** Normalize an arXiv identifier or abs, HTML, or PDF URL to its PDF. */
export function normalizeArxivUrl(value: string): {
  src: string;
  watchUrl: string;
} | null {
  const directId = normalizeArxivId(value);
  if (directId) {
    return {
      src: `https://arxiv.org/pdf/${directId}`,
      watchUrl: `https://arxiv.org/abs/${directId}`,
    };
  }

  let input: URL;
  try {
    input = new URL(value.trim());
  } catch {
    return null;
  }
  if (
    input.protocol !== "https:" ||
    (input.hostname !== "arxiv.org" && input.hostname !== "www.arxiv.org") ||
    input.username ||
    input.password ||
    input.port ||
    input.search ||
    input.hash
  ) {
    return null;
  }

  const path = input.pathname.match(/^\/(?:abs|pdf|html)\/(.+?)\/?$/i);
  let decodedPath = "";
  try {
    decodedPath = path ? decodeURIComponent(path[1]) : "";
  } catch {
    return null;
  }
  const id = normalizeArxivId(decodedPath);
  if (!id) return null;
  return {
    src: `https://arxiv.org/pdf/${id}`,
    watchUrl: `https://arxiv.org/abs/${id}`,
  };
}

export function parseTomeEmbed(
  language: string,
  content: string,
): TomeEmbedParseResult | null {
  const provider = language.trim().toLowerCase() as TomeEmbedProvider;
  if (provider === "vidcast") {
    const parsed = parseVidcastEmbed(content);
    if (parsed.ok === false) return parsed;
    return {
      ok: true,
      value: {
        ...parsed.value,
        provider,
        kind: "video",
        linkLabel: "Watch on Vidcast",
      },
    };
  }

  if (provider !== "youtube" && provider !== "arxiv") return null;
  const label = provider === "youtube" ? "YouTube" : "arXiv";
  const fields = parseEmbedFields(
    content,
    label,
    provider === "youtube" ? "YouTube video" : "arXiv paper",
  );
  if (fields.ok === false) return fields;
  const normalized =
    provider === "youtube"
      ? normalizeYouTubeUrl(fields.value.url)
      : normalizeArxivUrl(fields.value.url);
  if (!normalized) {
    return {
      ok: false,
      error:
        provider === "youtube"
          ? "Use a valid HTTPS YouTube video URL with supported playback options."
          : "Use a valid arXiv identifier or HTTPS abs, HTML, or PDF URL.",
    };
  }

  return {
    ok: true,
    value: {
      ...normalized,
      provider,
      kind: provider === "youtube" ? "video" : "document",
      title: fields.value.title,
      linkLabel: provider === "youtube" ? "Watch on YouTube" : "Open on arXiv",
    },
  };
}
