import { NextRequest } from "next/server";

import { ApiError, withErrorHandler } from "@/lib/api-middleware";
import { loadOwnedChatRun } from "@/lib/tome/chat-run-store";
import { loadTomeProject } from "@/lib/tome/tome-api";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string; runId: string }> };

const POLL_INTERVAL_MS = 250;
const userIdOf = (email?: string): string => email ?? "anonymous";

function requestedCursor(request: NextRequest): number {
  const raw =
    request.headers.get("last-event-id") ??
    request.nextUrl.searchParams.get("after") ??
    "0";
  const parsed = Number.parseInt(raw, 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Replay and follow a server-owned TOME chat run. Every upstream frame gets a
 * monotonic SSE id, so reconnecting clients can resume with Last-Event-ID.
 */
export const GET = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  const { slug, runId } = await ctx.params;
  const tctx = await loadTomeProject(request, slug);
  const userId = userIdOf(tctx.user.email);
  const initial = await loadOwnedChatRun(runId, tctx.projectId, userId);
  if (!initial) {
    throw new ApiError("Chat run not found", 404, "RUN_NOT_FOUND");
  }

  let cursor = requestedCursor(request);
  let cancelled = false;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      void (async () => {
        try {
          for (;;) {
            if (cancelled || request.signal.aborted) break;
            const run = await loadOwnedChatRun(
              runId,
              tctx.projectId,
              userId,
            );
            if (!run) break;

            for (const event of run.events) {
              if (event.id <= cursor) continue;
              controller.enqueue(
                encoder.encode(`id: ${event.id}\n${event.frame}\n\n`),
              );
              cursor = event.id;
            }

            if (run.status === "completed" || run.status === "failed") {
              const hasUpstreamError = run.events.some((event) =>
                event.frame.split("\n").some((line) => line.trim() === "event: error"),
              );
              if (run.status === "failed" && run.error && !hasUpstreamError) {
                controller.enqueue(
                  encoder.encode(
                    `event: error\ndata: ${JSON.stringify({ message: run.error })}\n\n`,
                  ),
                );
              }
              break;
            }
            await wait(POLL_INTERVAL_MS);
          }
          if (!cancelled) controller.close();
        } catch (error) {
          if (!cancelled) controller.error(error);
        }
      })();
    },
    cancel() {
      cancelled = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
});
