/**
 * GET /api/agentic-sdlc/events
 * Server-Sent Events stream for top-level Agentic SDLC screens.
 */
import { requireAgenticSdlcReader } from "@/lib/agentic-sdlc/agentic-sdlc-auth";
import { withAgenticSdlcGate } from "@/lib/agentic-sdlc/guard";
import {
  portfolioTopic,
  subscribe,
  type SseMessage,
  type SseSubscriber,
} from "@/lib/agentic-sdlc/sse-bus";

const SSE_HEADERS: HeadersInit = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-store, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

function formatSseFrame(msg: SseMessage): string {
  const lines: string[] = [];
  lines.push(`event: ${msg.event}`);
  if (msg.id !== undefined) lines.push(`id: ${msg.id}`);
  lines.push(`data: ${JSON.stringify(msg.data)}`);
  return lines.join("\n") + "\n\n";
}

async function handle(req: Request): Promise<Response> {
  const reader = await requireAgenticSdlcReader(req);
  if (!reader) {
    return new Response("Unauthorized", { status: 401 });
  }

  const topic = portfolioTopic();
  const encoder = new TextEncoder();

  let dispose = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // controller may already be closed
        }
      };

      const sub: SseSubscriber = {
        id: `${reader.user.email}:${topic}:${Date.now()}`,
        userId: reader.user.email,
        send: (msg) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(formatSseFrame(msg)));
          } catch {
            // Stream may have been closed by the client mid-send.
          }
        },
        close: (reason) => {
          if (closed) return;
          if (reason) {
            try {
              controller.enqueue(
                encoder.encode(
                  formatSseFrame({
                    event: "error",
                    data: { code: reason, message: reason },
                  }),
                ),
              );
            } catch {
              // best-effort; fall through to close
            }
          }
          close();
        },
      };

      const result = subscribe(topic, sub);
      if (result.rejected) {
        sub.send({
          event: "error",
          data: {
            code: result.rejected,
            message: "Too many concurrent SSE connections.",
          },
        });
        close();
        return;
      }

      dispose = () => {
        result.dispose();
        close();
      };

      sub.send({
        event: "connected",
        data: {
          scope: "portfolio",
          server_time: new Date().toISOString(),
        },
      });

      const signal = req.signal;
      if (signal.aborted) {
        dispose();
      } else {
        signal.addEventListener("abort", () => dispose(), { once: true });
      }
    },
    cancel() {
      dispose();
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}

export const GET = withAgenticSdlcGate(handle);
