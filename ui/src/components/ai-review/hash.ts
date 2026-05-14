/**
 * Browser-side SHA-256 helper for the AI Review cache key.
 *
 * The review hook hashes the current content and the last-passing content,
 * then compares the two to decide whether a cached pass is still valid.
 * Using `crypto.subtle.digest` keeps the implementation dependency-free
 * and matches what the backend expects for `content_hash` in
 * `POST /api/ai/review`.
 */

/**
 * Compute the lowercase hex SHA-256 of a string. Returns a 64-char string.
 *
 * Implementation notes:
 *  - `TextEncoder` produces a UTF-8 byte view of the input.
 *  - `crypto.subtle.digest` requires a secure context (https or localhost),
 *    which Next.js dev / production satisfies.
 */
export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const view = new Uint8Array(digest);
  let out = "";
  for (let i = 0; i < view.length; i++) {
    out += view[i].toString(16).padStart(2, "0");
  }
  return out;
}
