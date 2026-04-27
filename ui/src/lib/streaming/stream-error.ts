/**
 * Shared error type for stream adapters (custom + agui).
 *
 * Both adapters call POST /api/v1/chat/stream/start, which is gated by the
 * BFF's structured auth-error contract (see ui/src/lib/auth-error.ts and
 * ui/src/lib/api-middleware.ts). When the BFF rejects the stream with 401
 * or 403, we want the chat panel to know it was an auth failure (so it can
 * show a toast with a "Sign in" / "Contact admin" affordance) instead of
 * inlining `**Error:** HTTP error: 401 ...` into the assistant turn.
 *
 * The throw-site lives in each adapter's `_stream` method. The catch-site
 * lives in `DynamicAgentChatPanel.submitMessage`.
 */

import type { AuthFailureAction, AuthFailureReason } from "../auth-error";

export class StreamError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public reason?: AuthFailureReason,
    public action?: AuthFailureAction,
  ) {
    super(message);
    this.name = "StreamError";
  }

  /** True if this is a 401/403/503 with a known auth-failure reason. */
  isAuthError(): boolean {
    return (
      this.status === 401 ||
      this.status === 403 ||
      (this.status === 503 && this.reason === "pdp_unavailable")
    );
  }
}

/**
 * Build a {@link StreamError} from a non-OK fetch `Response`. Tries to
 * extract the BFF's structured `{error, code, reason, action}` body; falls
 * back to the response status text when the body is missing or non-JSON.
 *
 * Always consumes the response body.
 */
export async function buildStreamErrorFromResponse(
  response: Response,
): Promise<StreamError> {
  let body: {
    error?: string;
    code?: string;
    reason?: AuthFailureReason;
    action?: AuthFailureAction;
  } = {};
  let rawText = "";
  try {
    rawText = await response.text();
    body = JSON.parse(rawText);
  } catch {
    // Non-JSON body — keep rawText for diagnostics.
  }

  const message =
    body.error ||
    (rawText && rawText.length < 500 ? rawText : "") ||
    `HTTP ${response.status} ${response.statusText}`.trim();

  return new StreamError(
    message,
    response.status,
    body.code,
    body.reason,
    body.action,
  );
}
