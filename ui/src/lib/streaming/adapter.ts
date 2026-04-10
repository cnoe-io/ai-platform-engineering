/**
 * StreamAdapter — protocol-agnostic interface for consuming SSE streams.
 *
 * Mirror of the backend StreamEncoder ABC. Components call adapter methods
 * and receive semantic callbacks — they never see wire events.
 *
 * The factory creates the appropriate adapter based on the protocol config.
 *
 * Routes:
 *   POST /api/chat/conversations/:id/stream/start   → streamMessage
 *   POST /api/chat/conversations/:id/stream/resume   → resumeStream
 *   POST /api/chat/conversations/:id/stream/cancel   → cancelStream
 */

import type { StreamCallbacks, StreamParams } from "./callbacks";
import { CustomStreamAdapter } from "./custom-adapter";
import { AGUIStreamAdapter } from "./agui-adapter";

// ═══════════════════════════════════════════════════════════════
// Adapter interface
// ═══════════════════════════════════════════════════════════════

export interface StreamAdapter {
  /** Stream events for a new user message */
  streamMessage(params: StreamParams, callbacks: StreamCallbacks): Promise<void>;

  /** Resume streaming after HITL form submission */
  resumeStream(params: StreamParams, callbacks: StreamCallbacks): Promise<void>;

  /** Cancel the stream on the backend */
  cancelStream(conversationId: string, agentId: string): Promise<boolean>;

  /** Abort the client-side HTTP connection */
  abort(): void;
}

// ═══════════════════════════════════════════════════════════════
// Factory
// ═══════════════════════════════════════════════════════════════

export interface StreamAdapterConfig {
  /** Wire protocol: "custom" for legacy SSE, "agui" for AG-UI */
  protocol: "custom" | "agui";
  /** JWT access token for Bearer authentication */
  accessToken?: string;
}

/**
 * Create a protocol-specific stream adapter.
 *
 * The adapter owns the HTTP lifecycle (fetch, abort, error handling).
 * Callers just provide StreamCallbacks.
 *
 * Routes are derived from the conversationId in StreamParams:
 *   /api/chat/conversations/{conversationId}/stream/start
 *   /api/chat/conversations/{conversationId}/stream/resume
 *   /api/chat/conversations/{conversationId}/stream/cancel
 */
export function createStreamAdapter(config: StreamAdapterConfig): StreamAdapter {
  switch (config.protocol) {
    case "agui":
      return new AGUIStreamAdapter(config.accessToken);
    case "custom":
    default:
      return new CustomStreamAdapter(config.accessToken);
  }
}
