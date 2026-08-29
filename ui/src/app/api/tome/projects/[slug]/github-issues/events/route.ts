/**
 * Live, project-scoped notifications for TOME's GitHub issue read model.
 *
 * The browser still receives SSE, but the server detects cache changes by
 * polling the small per-repository synchronization rows in shared MongoDB.
 * This deliberately avoids a process-local publisher: a webhook handled by
 * replica A is therefore visible to an SSE connection hosted by replica B.
 */

import { NextRequest } from "next/server";

import { ApiError, withErrorHandler } from "@/lib/api-middleware";
import {
  readableTomeRollupProjects,
  rollupGitHubRepos,
} from "@/lib/tome/github-issue-scope";
import { getTomeRepoSyncs } from "@/lib/tome/github-issue-cache";
import { loadTomeProject } from "@/lib/tome/tome-api";

export const dynamic = "force-dynamic";

const POLL_INTERVAL_MS = Math.max(
  500,
  Number(process.env.TOME_GITHUB_SSE_POLL_MS) || 2_000,
);
const HEARTBEAT_INTERVAL_MS = 25_000;
const MAX_STREAM_LIFETIME_MS = Math.max(
  60_000,
  Number(process.env.TOME_GITHUB_SSE_MAX_LIFETIME_MS) || 5 * 60_000,
);
const MAX_CONNECTIONS_PER_USER = 10;

const SSE_HEADERS: HeadersInit = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-store, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

type Ctx = { params: Promise<{ slug: string }> };

interface IssueSseConnectionState {
  userConnectionCount: Map<string, number>;
}

const globalIssueSse = globalThis as typeof globalThis & {
  __tomeGithubIssueSseConnections?: IssueSseConnectionState;
};
const connectionState = globalIssueSse.__tomeGithubIssueSseConnections ??= {
  userConnectionCount: new Map(),
};

function acquireConnection(userId: string): boolean {
  const current = connectionState.userConnectionCount.get(userId) ?? 0;
  if (current >= MAX_CONNECTIONS_PER_USER) return false;
  connectionState.userConnectionCount.set(userId, current + 1);
  return true;
}

function releaseConnection(userId: string): void {
  const next = (connectionState.userConnectionCount.get(userId) ?? 1) - 1;
  if (next <= 0) connectionState.userConnectionCount.delete(userId);
  else connectionState.userConnectionCount.set(userId, next);
}

function generationMap(
  repos: string[],
  rows: Awaited<ReturnType<typeof getTomeRepoSyncs>>,
): Map<string, number> {
  const byRepo = new Map(
    rows.map((row) => [row._id.toLowerCase(), row.cache_generation ?? 0]),
  );
  return new Map(
    repos.map((repo) => {
      const normalized = repo.toLowerCase();
      return [normalized, byRepo.get(normalized) ?? 0];
    }),
  );
}

function changedRepositories(
  previous: Map<string, number>,
  current: Map<string, number>,
): string[] {
  return [...current.entries()]
    .filter(([repo, generation]) => previous.get(repo) !== generation)
    .map(([repo]) => repo);
}

function frame(event: string, data: unknown, id?: string): string {
  const lines = [`event: ${event}`];
  if (id) lines.push(`id: ${id}`);
  lines.push(`data: ${JSON.stringify(data)}`);
  return `${lines.join("\n")}\n\n`;
}

export const GET = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  const { slug } = await ctx.params;
  const tctx = await loadTomeProject(request, slug);
  const rollup = await readableTomeRollupProjects(tctx);
  const scopedRepos = rollupGitHubRepos(rollup).map((repo) => repo.toLowerCase());
  const userId = tctx.user.email ?? `tome:${tctx.projectId}`;

  if (!acquireConnection(userId)) {
    throw new ApiError(
      "Too many live issue connections for this user",
      429,
      "SSE_CONNECTION_LIMIT",
    );
  }

  let previous: Map<string, number>;
  try {
    previous = generationMap(scopedRepos, await getTomeRepoSyncs(scopedRepos));
  } catch (error) {
    releaseConnection(userId);
    throw error;
  }

  const encoder = new TextEncoder();
  let closeStream = () => releaseConnection(userId);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let pollTimer: ReturnType<typeof setTimeout> | null = null;
      let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
      let lifetimeTimer: ReturnType<typeof setTimeout> | null = null;
      let consecutiveFailures = 0;

      const close = () => {
        if (closed) return;
        closed = true;
        if (pollTimer) clearTimeout(pollTimer);
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        if (lifetimeTimer) clearTimeout(lifetimeTimer);
        releaseConnection(userId);
        try {
          controller.close();
        } catch {
          // The browser may already have closed the stream.
        }
      };
      closeStream = close;

      const send = (event: string, data: unknown, id?: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(frame(event, data, id)));
        } catch {
          close();
        }
      };

      const schedulePoll = (delay: number) => {
        if (closed) return;
        pollTimer = setTimeout(() => void poll(), delay);
      };
      const poll = async () => {
        if (closed) return;
        try {
          const current = generationMap(
            scopedRepos,
            await getTomeRepoSyncs(scopedRepos),
          );
          const changed = changedRepositories(previous, current);
          previous = current;
          consecutiveFailures = 0;
          if (changed.length) {
            const generations = Object.fromEntries(
              changed.map((repo) => [repo, current.get(repo) ?? 0]),
            );
            send(
              "github_issue_updated",
              {
                repositories: changed,
                repository_full_name: changed[0] ?? null,
                generations,
              },
              `generation:${changed.map((repo) => `${repo}:${generations[repo]}`).join(",")}`,
            );
          }
          schedulePoll(POLL_INTERVAL_MS);
        } catch {
          consecutiveFailures += 1;
          const retryDelay = Math.min(
            30_000,
            POLL_INTERVAL_MS * 2 ** Math.min(consecutiveFailures, 4),
          );
          schedulePoll(retryDelay);
        }
      };

      send("connected", {
        project: slug,
        server_time: new Date().toISOString(),
        repositories: scopedRepos,
      });
      schedulePoll(POLL_INTERVAL_MS);
      heartbeatTimer = setInterval(
        () => send("heartbeat", { t: new Date().toISOString() }),
        HEARTBEAT_INTERVAL_MS,
      );
      lifetimeTimer = setTimeout(close, MAX_STREAM_LIFETIME_MS);

      if (request.signal.aborted) close();
      else request.signal.addEventListener("abort", close, { once: true });
    },
    cancel() {
      closeStream();
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
});

export function _resetIssueSseConnectionsForTest(): void {
  connectionState.userConnectionCount.clear();
}
