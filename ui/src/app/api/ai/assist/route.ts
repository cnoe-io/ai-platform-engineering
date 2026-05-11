/**
 * POST /api/ai/assist
 *
 * Generic AI Assist endpoint. Streams text via Server-Sent Events for any
 * registered task (description, SKILL.md, system prompt, code snippet, ...).
 *
 * Request body:
 *   {
 *     "task": "describe-skill" | "skill-md" | ...,
 *     "context": { instruction?, current_value?, name?, ... },
 *     "model"?: { id, provider }    // optional override
 *   }
 *
 * Response: text/event-stream
 *   data: { "type": "start", "task": "..." }
 *   data: { "type": "content", "text": "<chunk>" }
 *   ...
 *   data: { "type": "done" }
 *
 * On error:
 *   data: { "type": "error", "message": "..." }
 *
 * On rate-limit: HTTP 429 (no SSE body) with Retry-After header.
 */

import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/da-proxy";
import { fetchAssistantSuggest } from "@/lib/server/assistant-suggest-da";
import {
  getAiAssistTask,
  type AiAssistContext,
} from "@/lib/server/ai-assist-tasks";
import { consume } from "@/lib/server/ai-assist-rate-limit";
import { getCollection } from "@/lib/mongodb";

/**
 * Resolve a model the dynamic-agents service can actually serve. Tries the
 * caller-provided override first, then any `AI_ASSIST_MODEL_*` env defaults,
 * then falls back to the first model present in the `llm_models` MongoDB
 * collection (the same source the agent-builder picker uses). The final
 * fallback is the registry's static default.
 *
 * Returning a model that DA can't authenticate against produces an opaque
 * 500 ("Failed to generate suggestion. Please try again.") with no actionable
 * message, so it's worth one extra Mongo hit per call to avoid that footgun.
 */
async function resolveModel(
  override: { id?: string; provider?: string } | undefined,
  envDefault: { id: string; provider: string },
): Promise<{ id: string; provider: string }> {
  if (override?.id && override?.provider) {
    return { id: override.id, provider: override.provider };
  }
  // Honour env overrides whenever they're set so a deployment can pin a
  // specific model regardless of what's seeded in Mongo.
  if (
    process.env.AI_ASSIST_MODEL_ID ||
    process.env.AI_ASSIST_MODEL_PROVIDER ||
    process.env.SKILL_AI_MODEL_ID
  ) {
    return envDefault;
  }
  try {
    const col = await getCollection("llm_models");
    const first = await col.findOne({}, { sort: { name: 1 } });
    if (first?.model_id && first?.provider) {
      return { id: String(first.model_id), provider: String(first.provider) };
    }
  } catch {
    // Mongo unavailable or collection empty — fall through to env default.
  }
  return envDefault;
}

/**
 * Pull a stable per-user key from the base64-encoded X-User-Context header
 * that `authenticateRequest` builds. Using the header avoids a second JWT/JWKS
 * round-trip (which can time out if the SSO IdP is slow), and keeps the
 * rate-limit bucket consistent with the identity used downstream.
 */
function userKeyFromUserContext(header: string | undefined): string | undefined {
  if (!header) return undefined;
  try {
    const json = Buffer.from(header, "base64").toString("utf8");
    const ctx = JSON.parse(json) as { email?: string };
    return ctx.email || undefined;
  } catch {
    return undefined;
  }
}

export const dynamic = "force-dynamic";

interface AssistRequestBody {
  task?: string;
  context?: AiAssistContext;
  model?: { id?: string; provider?: string };
}

function sseEvent(type: string, payload: Record<string, unknown> = {}): string {
  return `data: ${JSON.stringify({ type, ...payload })}\n\n`;
}

/** Hard upper bound on input size to avoid pathological prompts. */
const MAX_CONTEXT_BYTES = 64 * 1024;

export async function POST(request: NextRequest) {
  // ---- Parse + validate ---------------------------------------------------
  let body: AssistRequestBody;
  try {
    body = (await request.json()) as AssistRequestBody;
  } catch {
    return jsonError(400, "Invalid JSON body");
  }

  const taskId = (body.task ?? "").trim();
  if (!taskId) return jsonError(400, "`task` is required");

  const task = getAiAssistTask(taskId);
  if (!task) return jsonError(400, `Unknown task: ${taskId}`);

  const context: AiAssistContext = body.context ?? {};
  const approxSize = JSON.stringify(context).length;
  if (approxSize > MAX_CONTEXT_BYTES) {
    return jsonError(
      413,
      `Context too large (${approxSize} bytes; max ${MAX_CONTEXT_BYTES})`,
    );
  }

  // ---- Auth ---------------------------------------------------------------
  const auth = await authenticateRequest(request);
  if (auth instanceof Response) return auth; // 401

  // Resolve a stable per-user key for rate limiting from the X-User-Context
  // header `authenticateRequest` already built — avoids re-running JWKS
  // validation (which can take seconds and previously caused a request-time
  // timeout when the IdP was slow).
  const userKey = userKeyFromUserContext(auth.userContextHeader);

  // ---- Rate limit ---------------------------------------------------------
  const decision = consume(userKey, task.id);
  if (!decision.allowed) {
    return new Response(
      JSON.stringify({
        success: false,
        error: `Rate limit exceeded for task "${task.id}". Try again in ${decision.retryAfterSec}s.`,
      }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(decision.retryAfterSec),
          "X-RateLimit-Limit": String(decision.limit),
          "X-RateLimit-Remaining": "0",
        },
      },
    );
  }

  // ---- Build prompt + call backend ---------------------------------------
  const userMessage = task.buildUserMessage(context);
  const model = await resolveModel(body.model, task.defaultModel(process.env));

  const headers: Record<string, string> = {};
  if (auth.userContextHeader) {
    headers["X-User-Context"] = auth.userContextHeader;
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (type: string, payload: Record<string, unknown> = {}) =>
        controller.enqueue(encoder.encode(sseEvent(type, payload)));

      try {
        send("start", {
          task: task.id,
          model: model.id,
          rate_limit: {
            limit: decision.limit,
            remaining: decision.remaining,
            window_ms: decision.windowMs,
          },
        });

        const result = await fetchAssistantSuggest(headers, {
          system_prompt: task.systemPrompt,
          user_message: userMessage,
          model,
        });

        if (result.ok !== true) {
          send("error", { message: result.detail });
          return;
        }

        const content = task.postProcess
          ? task.postProcess(result.content)
          : result.content;

        const CHUNK = 200;
        for (let i = 0; i < content.length; i += CHUNK) {
          send("content", { text: content.slice(i, i + CHUNK) });
        }
        send("done");
      } catch (err: unknown) {
        send("error", {
          message: err instanceof Error ? err.message : "Unknown error",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "X-RateLimit-Limit": String(decision.limit),
      "X-RateLimit-Remaining": String(decision.remaining),
    },
  });
}

function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ success: false, error }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
