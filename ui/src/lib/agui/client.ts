/**
 * AG-UI HTTP Agent wrapper for CAIPE.
 *
 * Creates an HttpAgent from @ag-ui/client configured with:
 *   - CAIPE-specific auth headers (Bearer token)
 *   - A stable endpoint URL (passed in, not read from env directly, because
 *     this module runs on the client where process.env is unavailable)
 *   - An AbortController so the caller can cancel an in-flight stream
 *
 * Usage:
 *   const agent = createCAIPEAgent({ endpoint, accessToken, threadId });
 *   // subscribe via agent.run(input) which returns an Observable<BaseEvent>
 *   // or use the higher-level useAGUIStream hook.
 */

import { HttpAgent } from "@ag-ui/client";
import type { CAIPEAgentConfig } from "./types";

/**
 * Create an HttpAgent pre-configured for a CAIPE streaming endpoint.
 *
 * @param config - Endpoint URL, optional Bearer token, and conversation threadId.
 * @returns A configured HttpAgent instance.
 */
export function createCAIPEAgent(config: CAIPEAgentConfig): HttpAgent {
  const { endpoint, accessToken, threadId } = config;

  console.log(`[AG-UI Client] Creating agent with endpoint: ${endpoint}, threadId: ${threadId}`);

  const headers: Record<string, string> = {
    "X-Client-Source": "caipe-ui",
  };

  if (accessToken) {
    headers["Authorization"] = `Bearer ${accessToken}`;
  }

  return new HttpAgent({
    url: endpoint,
    headers,
    threadId,
  });
}

/**
 * Minimal abort-only wrapper around an HttpAgent.
 * Satisfies the AbortableClient interface used by the chat store's
 * StreamingState without exposing the full agent API.
 */
export class AGUIAbortableClient {
  private agent: HttpAgent;

  constructor(agent: HttpAgent) {
    this.agent = agent;
  }

  abort(): void {
    this.agent.abortRun();
  }
}
