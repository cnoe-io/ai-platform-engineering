/**
 * Streaming adapter layer — barrel export.
 *
 * import { createStreamAdapter, type StreamCallbacks } from "@/lib/streaming";
 */

export { createStreamAdapter } from "./adapter";
export type { StreamAdapter, StreamAdapterConfig } from "./adapter";
export type { StreamCallbacks, StreamParams, RawStreamEvent } from "./callbacks";
export { parseSSEStream, type RawSSEEvent } from "./parse-sse";

// Protocol state machine (used by both browser client and server consumer)
export {
  processAGUIEvent,
  createAGUIProtocolState,
  resetProtocolState,
  AGUI,
} from "./protocols/agui";
export type { AGUIProtocolState } from "./protocols/agui";

// Stream event types (moved from components/dynamic-agents/sse-types.ts)
export type {
  StreamEvent,
  StreamEventType,
  ToolStartEventData,
  ToolEndEventData,
  WarningEventData,
  InputRequiredEventData,
  InputFieldDefinition,
  HITLMetadata,
  StreamBackendData,
} from "./types";
export {
  createStreamEvent,
  isToolStartData,
  isFileToolName,
  isTodoToolName,
  FILE_TOOL_NAMES,
  TODO_TOOL_NAME,
  SUBAGENT_TOOL_NAME,
  EMPTY_STREAM_EVENTS,
} from "./types";

// Browser consumers
export { AGUIStreamAdapter } from "./clients/browser-agui-consumer";
export { CustomStreamAdapter } from "./clients/browser-custom-consumer";
