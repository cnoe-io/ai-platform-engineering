/**
 * Safe response-body parsers for fetch() callers in the UI.
 *
 * The default ``await response.json()`` pattern fails opaquely when an
 * upstream returns HTML — typically a load-balancer / WAF interstitial
 * (nginx 504, Cloudflare 524, corporate SSO challenge) on a long-running
 * route. The browser surfaces it as
 *
 *   SyntaxError: Unexpected token '<', "<!DOCTYPE "... is not valid JSON
 *
 * which is correct but useless: the user has no idea the call ever left
 * the box, and the dev has no idea which proxy/timeout is at fault.
 *
 * ``readJson`` and ``readJsonOrError`` wrap the parse and:
 *
 *   1. Inspect ``Content-Type`` first. If it isn't JSON-shaped we trust
 *      the server's own labelling and surface a deliberately scoped
 *      error including HTTP status, the content-type the server
 *      claimed, and the first ~200 chars of the body so an operator
 *      can immediately tell "oh, that's an nginx 504 page" without
 *      digging through devtools.
 *
 *   2. If the content-type IS JSON-shaped but the body is non-JSON
 *      anyway (server lying about its labels — happens), throw with
 *      the same shape so callers see a consistent error message.
 *
 * Only used on client-side fetch() calls. Server-to-server calls go
 * through the existing ``api-middleware`` helpers which already
 * normalise upstream failures to ApiError.
 *
 * assisted-by Cursor Composer-Sonnet-4.7
 */

const HTML_PREVIEW_LIMIT = 200;

/**
 * Hint to the caller about what went wrong. Used to keep error
 * messages stable for matching/grepping in browser logs.
 */
export class NonJsonResponseError extends Error {
  readonly status: number;
  readonly contentType: string;
  readonly bodyPreview: string;

  constructor(
    status: number,
    contentType: string,
    bodyPreview: string,
    actionHint?: string,
  ) {
    const headline =
      `Server returned non-JSON response (HTTP ${status}, ` +
      `Content-Type: ${contentType || "unset"}).`;
    const preview =
      bodyPreview.length > 0
        ? ` Body starts with: ${JSON.stringify(bodyPreview)}.`
        : "";
    const hint = actionHint ? ` ${actionHint}` : "";
    super(`${headline}${preview}${hint}`);
    this.name = "NonJsonResponseError";
    this.status = status;
    this.contentType = contentType;
    this.bodyPreview = bodyPreview;
  }
}

function looksJson(contentType: string): boolean {
  // ``application/json``, ``application/problem+json``, ``application/foo+json`` …
  // are all acceptable. Match suffix loosely so we don't refuse a
  // legitimate vendor-specific JSON content type.
  const ct = contentType.toLowerCase().split(";")[0].trim();
  return ct === "application/json" || ct.endsWith("+json");
}

/**
 * Parse a JSON body from a fetch response, throwing a
 * ``NonJsonResponseError`` if the server didn't return JSON.
 *
 * Use this when ``response.ok`` was already verified by the caller,
 * but the server might still respond with HTML (e.g. an LB
 * interstitial that managed to set status 200 anyway).
 *
 * If the parse fails, throws ``NonJsonResponseError`` carrying the
 * status, content-type, and a preview of the body so the eventual
 * toast / log message is actionable.
 */
export async function readJson<T = unknown>(response: Response): Promise<T> {
  const ct = response.headers.get("content-type") ?? "";
  if (!looksJson(ct)) {
    const preview = await safeText(response);
    throw new NonJsonResponseError(response.status, ct, preview);
  }
  try {
    return (await response.json()) as T;
  } catch (err) {
    // Server lied about its content-type. Take a second look at the
    // body so the error message is still useful. Note: we already
    // consumed the body above on the .json() call, so we can't
    // safely call .text() again — surface what the parser said.
    throw new NonJsonResponseError(
      response.status,
      ct,
      err instanceof Error ? err.message : String(err),
      "(server claimed JSON but body was not parseable)",
    );
  }
}

/**
 * Parse JSON body but tolerate a non-JSON error response. Returns
 * ``{ ok: true, data }`` for parseable JSON, and
 * ``{ ok: false, error }`` for any non-JSON / parse failure. Useful
 * inside ``if (!response.ok)`` branches where the caller wants to
 * fall back to a status-only error message rather than throw.
 */
export async function readJsonOrError<T = unknown>(
  response: Response,
): Promise<
  | { ok: true; data: T }
  | { ok: false; status: number; error: string; preview: string }
> {
  const ct = response.headers.get("content-type") ?? "";
  if (!looksJson(ct)) {
    const preview = await safeText(response);
    return {
      ok: false,
      status: response.status,
      error: `Server returned non-JSON response (HTTP ${response.status}).`,
      preview,
    };
  }
  try {
    const data = (await response.json()) as T;
    return { ok: true, data };
  } catch (err) {
    return {
      ok: false,
      status: response.status,
      error: `JSON parse failed: ${err instanceof Error ? err.message : String(err)}`,
      preview: "",
    };
  }
}

/**
 * Safely read up to ``HTML_PREVIEW_LIMIT`` chars from a response
 * body for inclusion in error messages. Wrapped in try/catch
 * because some response types (already-consumed bodies, opaque
 * cross-origin responses) throw on .text().
 */
async function safeText(response: Response): Promise<string> {
  try {
    const text = await response.text();
    if (text.length <= HTML_PREVIEW_LIMIT) return text;
    return text.slice(0, HTML_PREVIEW_LIMIT) + "…";
  } catch {
    return "";
  }
}
