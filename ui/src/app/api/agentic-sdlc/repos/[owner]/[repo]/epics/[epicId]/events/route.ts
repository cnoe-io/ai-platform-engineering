/**
 * GET /api/agentic-sdlc/repos/{owner}/{repo}/epics/{epicId}/events
 * Server-Sent Events stream for live Epic updates.
 *
 * Wire format follows contracts/sse-channels.md:
 *   - First frame: event=connected with {epic_id, server_time}
 *   - Then: any of artifact_upserted | event_appended | stage_transition
 *           | webhook_health | heartbeat | error
 *   - Heartbeats every 25s are emitted by sse-bus itself.
 *
 * The route is a thin adapter between the in-process sse-bus and
 * a ReadableStream. We intentionally do not buffer state in this
 * handler -- the worker publishes the firehose and the client's
 * initial state comes from the GET /epics/{id} fetch they did just
 * before opening this stream.
 *
 * Closing semantics:
 *   - client disconnect -> req.signal.aborted -> dispose() -> stream
 *     controller.close(). This is the normal happy path.
 *   - server-side close (e.g. overflow) -> sub.close("overflow") is
 *     called from the bus, which writes a final `error` frame and
 *     then closes the stream.
 *   - feature toggled off mid-session is not handled here because
 *     withAgenticSdlcGate already 404s on entry; we don't poll the
 *     toggle on every frame to keep the path cheap. Operators who
 *     flip the toggle should restart the dev server.
 */

import { withAgenticSdlcGate } from "@/lib/agentic-sdlc/guard";
import {
  getAgenticSdlcArtifactsCollection,
  getAgenticSdlcReposCollection,
} from "@/lib/agentic-sdlc/mongo-collections";
import {
  epicTopic,
  subscribe,
  type SseMessage,
  type SseSubscriber,
} from "@/lib/agentic-sdlc/sse-bus";
import { requireAgenticSdlcReader } from "@/lib/agentic-sdlc/agentic-sdlc-auth";

const SSE_HEADERS: HeadersInit = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-store, no-transform",
  Connection: "keep-alive",
  // Belt-and-braces against intermediaries that buffer responses
  // until they see a content length. Mirrors the existing chat
  // streaming routes in this repo.
  "X-Accel-Buffering": "no",
};

function formatSseFrame(msg: SseMessage): string {
  const lines: string[] = [];
  lines.push(`event: ${msg.event}`);
  if (msg.id !== undefined) lines.push(`id: ${msg.id}`);
  // Stringified once; unbroken by newlines because data is JSON.
  lines.push(`data: ${JSON.stringify(msg.data)}`);
  return lines.join("\n") + "\n\n";
}

async function handle(
  req: Request,
  ctx: { params: Promise<{ owner: string; repo: string; epicId: string }> },
): Promise<Response> {
  const reader = await requireAgenticSdlcReader(req);
  if (!reader) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { owner, repo, epicId } = await ctx.params;
  const repos = await getAgenticSdlcReposCollection();
  const repoDoc = await repos.findOne(
    { owner, name: repo, offboarded_at: null },
    { projection: { repo_id: 1 } },
  );
  if (!repoDoc) {
    return new Response("Not found", { status: 404 });
  }

  // Verify the Epic exists before opening the long-lived stream so
  // typos / stale URLs fail fast instead of getting an empty stream
  // forever. One findOne with a projection -- cheap.
  const artifacts = await getAgenticSdlcArtifactsCollection();
  const epicExists = await artifacts.findOne(
    { repo_id: repoDoc.repo_id, kind: "epic", artifact_id: epicId },
    { projection: { _id: 1 } },
  );
  if (!epicExists) {
    return new Response("Not found", { status: 404 });
  }

  const topic = epicTopic(repoDoc.repo_id, epicId);
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

      // Initial handshake -- the contract says exactly:
      //   {epic_id, server_time}
      sub.send({
        event: "connected",
        data: {
          epic_id: epicId,
          server_time: new Date().toISOString(),
        },
      });

      // Hook the request abort so closing the browser tab tears down
      // the bus subscription. Without this we leak subscribers into
      // sse-bus.subscribers and trip the per-user 10-connection cap.
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
