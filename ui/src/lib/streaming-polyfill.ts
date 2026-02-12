/**
 * Safari Streaming Compatibility
 *
 * The @a2a-js/sdk uses `response.body.pipeThrough(new TextDecoderStream())`
 * in its SSE stream parser (`parseSseStream`). Safari has a known issue where
 * `response.body` from `fetch()` is a `ReadableByteStream` that does NOT
 * have a working `pipeThrough` method. Additionally, `response.body` is a
 * getter that returns a new object each time, so monkey-patching doesn't work,
 * and `new Response(stream)` produces the same broken body type.
 *
 * The only reliable fix: detect Safari and provide our own SSE parser that
 * uses `getReader()` + `TextDecoder` instead of `pipeThrough(TextDecoderStream)`.
 */

/**
 * Detect if we're running in Safari.
 */
let safariDetected: boolean | null = null;

export function isSafariBrowser(): boolean {
  if (safariDetected !== null) return safariDetected;
  if (typeof navigator === "undefined") {
    safariDetected = false;
    return false;
  }
  const ua = navigator.userAgent;
  safariDetected =
    ua.includes("Safari") && !ua.includes("Chrome") && !ua.includes("Chromium");
  if (safariDetected) {
    console.log("[Safari Compat] Safari browser detected — using reader-based SSE parsing");
  }
  return safariDetected;
}

/**
 * SSE event structure matching what the SDK's parseSseStream yields.
 */
export interface SseEvent {
  type: string;
  data: string;
}

/**
 * Safari-compatible SSE stream parser.
 *
 * Uses `response.body.getReader()` and `TextDecoder` instead of
 * `response.body.pipeThrough(new TextDecoderStream())`.
 *
 * This is a drop-in replacement for the SDK's `parseSseStream`.
 */
export async function* parseSseStreamSafari(response: Response): AsyncGenerator<SseEvent, void, undefined> {
  if (!response.body) {
    throw new Error("SSE response body is undefined. Cannot read stream.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventType = "message";
  let eventData = "";

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        // Yield any remaining buffered event
        if (eventData) {
          yield { type: eventType, data: eventData };
        }
        break;
      }

      // Decode the chunk and append to buffer
      buffer += decoder.decode(value, { stream: true });

      // Process complete lines
      let lineEndIndex: number;
      while ((lineEndIndex = buffer.indexOf("\n")) >= 0) {
        const line = buffer.substring(0, lineEndIndex).trim();
        buffer = buffer.substring(lineEndIndex + 1);

        if (line === "") {
          // Empty line = end of event
          if (eventData) {
            yield { type: eventType, data: eventData };
            eventData = "";
            eventType = "message";
          }
        } else if (line.startsWith("event:")) {
          eventType = line.substring("event:".length).trim();
        } else if (line.startsWith("data:")) {
          eventData = line.substring("data:".length).trim();
        }
        // Ignore other lines (comments starting with ':', etc.)
      }
    }
  } finally {
    reader.releaseLock();
  }
}
