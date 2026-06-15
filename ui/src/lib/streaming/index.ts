/**
 * Streaming adapter layer — barrel export.
 *
 * import { createStreamAdapter, type StreamCallbacks } from "@/lib/streaming";
 */

export { createStreamAdapter } from "./adapter";
export type { StreamAdapter,StreamAdapterConfig } from "./adapter";
export type { RawStreamEvent,StreamCallbacks,StreamParams } from "./callbacks";
export { parseSSEStream,type RawSSEEvent } from "./parse-sse";
export { StreamError,buildStreamErrorFromResponse } from "./stream-error";
