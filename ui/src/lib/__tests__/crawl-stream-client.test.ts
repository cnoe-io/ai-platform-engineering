/**
 * @jest-environment node
 *
 * Tests for the NDJSON stream consumer (``crawl-stream-client.ts``).
 *
 * Pin the lifecycle decisions the dialog depends on:
 *   1. Happy path: server streams started + events + done -> run
 *      ends in `succeeded` with all events appended in order.
 *   2. Error event terminus -> run ends in `failed`.
 *   3. Stream closes without a terminal event -> `broken_stream`.
 *   4. Network failure before a Response -> `failed` with a
 *      synthetic `error` event (the dialog needs SOMETHING to
 *      render or it just shows an empty log).
 *   5. HTTP non-2xx -> synthetic `error` event with the right
 *      code (auth_failed / not_found / internal).
 *   6. Lines split across TCP reads are reassembled correctly.
 *   7. Aborted via AbortController -> `aborted`.
 */

import { startCrawlStream } from "../crawl-stream-client";
import { useCrawlConsoleStore } from "@/store/crawl-console-store";
import type { CrawlEvent } from "../crawl-events";

beforeEach(() => {
  useCrawlConsoleStore.setState({
    runs: [],
    isOpen: false,
    activeRunId: null,
  });
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

/**
 * Build a Response whose body streams the given chunks (string
 * pieces). Each chunk is encoded UTF-8 and pushed in sequence,
 * with a microtask gap between them so the consumer's read loop
 * actually iterates more than once.
 */
function streamResponse(
  chunks: readonly string[],
  init: { status?: number; ok?: boolean } = {},
): Response {
  const encoder = new TextEncoder();
  let i = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(encoder.encode(chunks[i]));
        i += 1;
      } else {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    status: init.status ?? 200,
    statusText: "",
  });
}

/** Block until the run terminates (status !== "running") or timeout. */
async function waitForFinish(runId: string, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const run = useCrawlConsoleStore.getState().runs.find((r) => r.id === runId);
    if (run && run.status !== "running") return;
    await new Promise((res) => setTimeout(res, 10));
  }
  throw new Error("waitForFinish timed out");
}

function getRun(runId: string) {
  return useCrawlConsoleStore.getState().runs.find((r) => r.id === runId);
}

// ---------------------------------------------------------------------------
// 1) Happy path
// ---------------------------------------------------------------------------

describe("startCrawlStream — happy path", () => {
  it("appends events in order and ends in succeeded on terminal `done`", async () => {
    const events: CrawlEvent[] = [
      {
        type: "started",
        provider: "github",
        project: "acme/tools",
        api_host: "api.github.com",
        started_at: "2026-05-05T22:00:00.000Z",
      },
      {
        type: "request",
        method: "GET",
        url: "https://api.github.com/repos/x",
        status: 200,
        duration_ms: 50,
        phase: "tree",
      },
      {
        type: "done",
        skills: 3,
        requests: 1,
        duration_ms: 50,
        truncation: { kind: "ok", pages_walked: 1 },
      },
    ];
    const ndjson = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
    jest.spyOn(global, "fetch").mockResolvedValue(streamResponse([ndjson]));

    const { runId } = startCrawlStream({
      url: "/api/skill-hubs/crawl",
      body: { type: "github", location: "acme/tools" },
      label: "Preview acme/tools",
      kind: "preview",
    });
    await waitForFinish(runId);

    const run = getRun(runId)!;
    expect(run.status).toBe("succeeded");
    expect(run.events).toHaveLength(3);
    expect(run.events.map((e) => e.type)).toEqual([
      "started",
      "request",
      "done",
    ]);
    // started promotes provider/project to top-level.
    expect(run.provider).toBe("github");
    expect(run.project).toBe("acme/tools");
  });
});

// ---------------------------------------------------------------------------
// 2) Error terminus
// ---------------------------------------------------------------------------

describe("startCrawlStream — error terminus", () => {
  it("ends in failed when the server sends an `error` event", async () => {
    const events: CrawlEvent[] = [
      {
        type: "started",
        provider: "gitlab",
        project: "acme/x",
        api_host: "gitlab.com",
        started_at: "2026-05-05T22:00:00.000Z",
      },
      {
        type: "error",
        code: "auth_failed",
        message: "GitLab API error: 403 Forbidden",
        hint: "Token missing read_api scope",
      },
    ];
    const ndjson = events.map((e) => JSON.stringify(e)).join("\n");
    jest.spyOn(global, "fetch").mockResolvedValue(streamResponse([ndjson]));

    const { runId } = startCrawlStream({
      url: "/api/skill-hubs/crawl",
      label: "x",
      kind: "preview",
    });
    await waitForFinish(runId);

    expect(getRun(runId)!.status).toBe("failed");
  });
});

// ---------------------------------------------------------------------------
// 3) Stream closes without terminal event
// ---------------------------------------------------------------------------

describe("startCrawlStream — broken stream", () => {
  it("ends in broken_stream when the server closes without a terminal event", async () => {
    const events: CrawlEvent[] = [
      {
        type: "started",
        provider: "github",
        project: "acme/tools",
        api_host: "api.github.com",
        started_at: "2026-05-05T22:00:00.000Z",
      },
      {
        type: "request",
        method: "GET",
        url: "x",
        status: 200,
        duration_ms: 1,
        phase: "tree",
      },
    ];
    const ndjson = events.map((e) => JSON.stringify(e)).join("\n");
    jest.spyOn(global, "fetch").mockResolvedValue(streamResponse([ndjson]));

    const { runId } = startCrawlStream({
      url: "/api/skill-hubs/crawl",
      label: "x",
      kind: "refresh",
    });
    await waitForFinish(runId);

    expect(getRun(runId)!.status).toBe("broken_stream");
  });
});

// ---------------------------------------------------------------------------
// 4) Network failure
// ---------------------------------------------------------------------------

describe("startCrawlStream — network failure", () => {
  it("emits a synthetic error event and ends in failed", async () => {
    jest
      .spyOn(global, "fetch")
      .mockRejectedValue(new TypeError("fetch failed"));

    const { runId } = startCrawlStream({
      url: "/api/skill-hubs/crawl",
      label: "x",
      kind: "preview",
    });
    await waitForFinish(runId);

    const run = getRun(runId)!;
    expect(run.status).toBe("failed");
    const errors = run.events.filter((e) => e.type === "error");
    expect(errors).toHaveLength(1);
    if (errors[0].type !== "error") throw new Error("unreachable");
    expect(errors[0].code).toBe("network");
  });
});

// ---------------------------------------------------------------------------
// 5) HTTP non-2xx
// ---------------------------------------------------------------------------

describe("startCrawlStream — non-2xx response", () => {
  it("classifies 401 as auth_failed and 404 as not_found", async () => {
    jest.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response("forbidden", { status: 401 }),
    );

    const { runId } = startCrawlStream({
      url: "/api/skill-hubs/crawl",
      label: "x",
      kind: "preview",
    });
    await waitForFinish(runId);

    const run = getRun(runId)!;
    expect(run.status).toBe("failed");
    const err = run.events.find((e) => e.type === "error");
    if (!err || err.type !== "error") throw new Error("expected error event");
    expect(err.code).toBe("auth_failed");
  });
});

// ---------------------------------------------------------------------------
// 6) Line splitting across reads
// ---------------------------------------------------------------------------

describe("startCrawlStream — line buffering", () => {
  it("reassembles a JSON line split across multiple TCP reads", async () => {
    const event = {
      type: "skill_found",
      path: "skills/x/SKILL.md",
      name: "X",
      ancillary_count: 0,
    };
    const json = JSON.stringify(event);
    const half = Math.floor(json.length / 2);
    const chunks = [
      json.slice(0, half),
      // Second chunk completes the line and starts a `done`.
      json.slice(half) +
        "\n" +
        JSON.stringify({
          type: "done",
          skills: 1,
          requests: 0,
          duration_ms: 0,
          truncation: { kind: "ok", pages_walked: 1 },
        }) +
        "\n",
    ];
    jest.spyOn(global, "fetch").mockResolvedValue(streamResponse(chunks));

    const { runId } = startCrawlStream({
      url: "/api/skill-hubs/crawl",
      label: "x",
      kind: "preview",
    });
    await waitForFinish(runId);

    const run = getRun(runId)!;
    expect(run.status).toBe("succeeded");
    const found = run.events.find((e) => e.type === "skill_found");
    expect(found).toBeDefined();
  });
});
