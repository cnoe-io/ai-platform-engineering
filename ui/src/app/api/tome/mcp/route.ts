// Tome MCP server — exposes Tome projects to MCP clients (Claude Code, Cursor,
// etc.) over the Streamable-HTTP transport (JSON-RPC 2.0 on a single POST).
//
//   POST /api/tome/mcp   { jsonrpc, id, method, params }
//
// Auth: standard caipe-ui auth (`getAuthFromBearerOrSession`) — a session
// cookie OR an `Authorization: Bearer <token>` header. Programmatic MCP clients
// use a *local skills API token* minted at POST /api/skills/token (surfaced in
// the Tome header's "Connect" dialog). Every tool re-enters the existing
// authenticated `/api/...` routes with the caller's credentials forwarded, so
// per-user RBAC is identical to the web UI — this route adds no new data path,
// only an MCP shell over the routes that already exist.
//
// Hand-rolled rather than pulling in @modelcontextprotocol/sdk: the wire
// protocol is plain JSON-RPC and we only implement initialize / tools/list /
// tools/call, so a dependency (and lockfile churn) isn't justified.

import { NextRequest, NextResponse } from "next/server";

import { getAuthFromBearerOrSession } from "@/lib/api-middleware";
import { isTomeServerEnabled } from "@/lib/tome/guard";

export const dynamic = "force-dynamic";

const PROTOCOL_VERSION = "2024-11-05";
const SERVER_INFO = { name: "tome", version: "0.1.0" };

// --- JSON-RPC helpers -------------------------------------------------------

interface RpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

function rpcResult(id: RpcRequest["id"], result: unknown) {
  return { jsonrpc: "2.0" as const, id: id ?? null, result };
}

function rpcError(id: RpcRequest["id"], code: number, message: string) {
  return { jsonrpc: "2.0" as const, id: id ?? null, error: { code, message } };
}

/** A tool result is a single text block (optionally flagged as an error). */
function toolText(text: string, isError = false) {
  return { content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) };
}

// --- internal route forwarding ----------------------------------------------

/** Origin to reach our own API routes from inside the route handler. Defaults
 *  to the request's own origin (loops back through the ingress); override with
 *  TOME_INTERNAL_ORIGIN to hit the app directly and skip the proxy hop. */
function selfOrigin(request: NextRequest): string {
  return (process.env.TOME_INTERNAL_ORIGIN || new URL(request.url).origin).replace(/\/$/, "");
}

/** Forward the caller's credentials so the target route re-authenticates as the
 *  same principal (per-user RBAC preserved). */
function forwardHeaders(request: NextRequest): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  const auth = request.headers.get("Authorization");
  const cookie = request.headers.get("cookie");
  if (auth) h.Authorization = auth;
  if (cookie) h.cookie = cookie;
  return h;
}

type Forward = (
  method: string,
  path: string,
  body?: unknown,
) => Promise<{ status: number; json: any; text: string }>;

function makeForward(request: NextRequest): Forward {
  const origin = selfOrigin(request);
  const headers = forwardHeaders(request);
  return async (method, path, body) => {
    const res = await fetch(`${origin}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* non-JSON (e.g. an HTML error page) — leave json null, expose text */
    }
    return { status: res.status, json, text };
  };
}

/** Throw a compact message when a forwarded call failed, so the tool surfaces a
 *  useful error instead of a raw status. On success, unwrap the shared
 *  `successResponse` envelope (`{ success, data }`) so callers see the payload
 *  directly; routes that return a bare object pass through unchanged. */
function ensureOk(r: { status: number; json: any; text: string }, what: string): any {
  if (r.status < 200 || r.status >= 300) {
    const detail =
      (r.json && (r.json.error || r.json.message)) || r.text.slice(0, 300) || "(no body)";
    throw new Error(`${what} failed (${r.status}): ${detail}`);
  }
  const j = r.json;
  if (j && typeof j === "object" && j.success === true && "data" in j) {
    return j.data;
  }
  return j;
}

// --- chat SSE accumulation (for tome_ask) -----------------------------------

/** POST to the chat route and fold its SSE token stream into one string. */
async function askAndAccumulate(
  request: NextRequest,
  slug: string,
  question: string,
): Promise<string> {
  const origin = selfOrigin(request);
  const res = await fetch(`${origin}/api/tome/projects/${encodeURIComponent(slug)}/chat`, {
    method: "POST",
    headers: forwardHeaders(request),
    body: JSON.stringify({ message: question }),
  });
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    throw new Error(`chat failed (${res.status}): ${detail.slice(0, 300)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let answer = "";
  let streamError: string | null = null;

  const handleFrame = (frame: string) => {
    let event = "message";
    const dataLines: string[] = [];
    for (const line of frame.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    }
    if (!dataLines.length) return;
    let data: any = null;
    try {
      data = JSON.parse(dataLines.join("\n"));
    } catch {
      return;
    }
    if (event === "token" && typeof data?.text === "string") answer += data.text;
    else if (event === "error" && typeof data?.message === "string") streamError = data.message;
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      handleFrame(buffer.slice(0, idx));
      buffer = buffer.slice(idx + 2);
    }
  }
  if (buffer.trim()) handleFrame(buffer);

  if (streamError) throw new Error(streamError);
  return answer.trim() || "(the agent returned no text)";
}

// --- tools ------------------------------------------------------------------

interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (
    request: NextRequest,
    fwd: Forward,
    args: Record<string, any>,
  ) => Promise<ReturnType<typeof toolText>>;
}

const STR = { type: "string" } as const;
function schema(
  properties: Record<string, unknown>,
  required: string[] = [],
): Record<string, unknown> {
  return { type: "object", properties, required, additionalProperties: false };
}

const TOOLS: ToolDef[] = [
  {
    name: "tome_list_projects",
    description:
      "List Tome projects the authenticated user can access. Returns slug, name, and status for each.",
    inputSchema: schema({}),
    handler: async (_req, fwd) => {
      const data = ensureOk(await fwd("GET", "/api/projects"), "list projects");
      const projects = (data?.projects ?? []).map((p: any) => ({
        slug: p.slug,
        name: p.name ?? p.title,
        status: p.status,
      }));
      return toolText(JSON.stringify(projects, null, 2));
    },
  },
  {
    name: "tome_get_project",
    description:
      "Get a single project's detail: name, status, and attached sources (repos, Confluence URL, Webex rooms). `project_slug` is required.",
    inputSchema: schema({ project_slug: STR }, ["project_slug"]),
    handler: async (_req, fwd, args) => {
      const slug = String(args.project_slug);
      const data = ensureOk(await fwd("GET", `/api/projects/${encodeURIComponent(slug)}`), "get project");
      const p = data?.project ?? {};
      return toolText(
        JSON.stringify(
          { slug: p.slug, name: p.name ?? p.title, status: p.status, sources: p.sources },
          null,
          2,
        ),
      );
    },
  },
  {
    name: "tome_list_repos",
    description: "List the GitHub repositories attached to a project. `project_slug` is required.",
    inputSchema: schema({ project_slug: STR }, ["project_slug"]),
    handler: async (_req, fwd, args) => {
      const slug = String(args.project_slug);
      const data = ensureOk(await fwd("GET", `/api/projects/${encodeURIComponent(slug)}`), "get project");
      return toolText(JSON.stringify(data?.project?.sources?.repos ?? [], null, 2));
    },
  },
  {
    name: "tome_list_webex_rooms",
    description: "List the Webex rooms attached to a project. `project_slug` is required.",
    inputSchema: schema({ project_slug: STR }, ["project_slug"]),
    handler: async (_req, fwd, args) => {
      const slug = String(args.project_slug);
      const data = ensureOk(await fwd("GET", `/api/projects/${encodeURIComponent(slug)}`), "get project");
      return toolText(JSON.stringify(data?.project?.sources?.webex_rooms ?? [], null, 2));
    },
  },
  {
    name: "tome_list_confluence_spaces",
    description:
      "List the Confluence space(s) attached to a project. `project_slug` is required.",
    inputSchema: schema({ project_slug: STR }, ["project_slug"]),
    handler: async (_req, fwd, args) => {
      const slug = String(args.project_slug);
      const data = ensureOk(await fwd("GET", `/api/projects/${encodeURIComponent(slug)}`), "get project");
      const url = data?.project?.sources?.confluence_url;
      return toolText(JSON.stringify(url ? [url] : [], null, 2));
    },
  },
  {
    name: "tome_get_pages",
    description:
      "Read a project's Tome wiki: the page tree plus the markdown of every page. This is the project's synthesized context. `project_slug` is required.",
    inputSchema: schema({ project_slug: STR }, ["project_slug"]),
    handler: async (_req, fwd, args) => {
      const slug = String(args.project_slug);
      const data = ensureOk(
        await fwd("GET", `/api/tome/projects/${encodeURIComponent(slug)}/pages`),
        "get pages",
      );
      return toolText(JSON.stringify({ tree: data?.tree, pages: data?.pages }, null, 2));
    },
  },
  {
    name: "tome_ask",
    description:
      "Ask a question of a project's Tome chat agent. The agent reads the wiki (and attached sources) to answer. Returns the full answer text. `project_slug` and `question` are required.",
    inputSchema: schema({ project_slug: STR, question: STR }, ["project_slug", "question"]),
    handler: async (request, _fwd, args) => {
      const answer = await askAndAccumulate(request, String(args.project_slug), String(args.question));
      return toolText(answer);
    },
  },
  {
    name: "tome_get_ingest_log",
    description:
      "Get an ingest run's status and full log for a project. `project_slug` is required; `run_id` is optional (defaults to the most recent run).",
    inputSchema: schema({ project_slug: STR, run_id: STR }, ["project_slug"]),
    handler: async (_req, fwd, args) => {
      const slug = encodeURIComponent(String(args.project_slug));
      let runId = args.run_id ? String(args.run_id) : "";
      if (!runId) {
        const list = ensureOk(await fwd("GET", `/api/tome/projects/${slug}/ingests`), "list ingests");
        const runs = list?.runs ?? [];
        if (!runs.length) return toolText("No ingest runs for this project yet.");
        runId = runs[0].id;
      }
      const run = ensureOk(
        await fwd("GET", `/api/tome/projects/${slug}/ingests/${encodeURIComponent(runId)}`),
        "get ingest run",
      );
      return toolText(JSON.stringify(run, null, 2));
    },
  },
  {
    name: "tome_list_webex_meetings",
    description:
      "List recent recorded Webex meetings available for a project's ingest run. Returns [] when the user has no Webex OAuth connection. Use the returned `id`, `title`, and `start` fields to select meetings for `tome_reingest`. `project_slug` is required.",
    inputSchema: schema({ project_slug: STR }, ["project_slug"]),
    handler: async (_req, fwd, args) => {
      const slug = encodeURIComponent(String(args.project_slug));
      const data = ensureOk(
        await fwd("GET", `/api/tome/projects/${slug}/webex-meetings`),
        "list webex meetings",
      );
      return toolText(JSON.stringify(data?.meetings ?? [], null, 2));
    },
  },
  {
    name: "tome_reingest",
    description:
      "Kick off a (re)ingest run for a project, rebuilding its wiki from the attached sources. `project_slug` is required; `seed` is an optional steering hint; `webex_meetings` is an optional array of `{id, title, start}` objects (from `tome_list_webex_meetings`) whose transcripts and AI summaries should be included in this run. Returns the new run id.",
    inputSchema: schema(
      {
        project_slug: STR,
        seed: STR,
        webex_meetings: {
          type: "array",
          items: {
            type: "object",
            properties: { id: STR, title: STR, start: STR },
            required: ["id", "title", "start"],
            additionalProperties: false,
          },
        },
      },
      ["project_slug"],
    ),
    handler: async (_req, fwd, args) => {
      const slug = encodeURIComponent(String(args.project_slug));
      const body: Record<string, unknown> = {};
      if (args.seed) body.seed = String(args.seed);
      if (Array.isArray(args.webex_meetings) && args.webex_meetings.length > 0) {
        body.webexMeetings = args.webex_meetings;
      }
      const r = await fwd("POST", `/api/tome/projects/${slug}/reingest`, body);
      const data = ensureOk(r, "reingest");
      return toolText(`Ingest started. runId=${data?.runId}`);
    },
  },
  {
    name: "tome_create_project",
    description:
      "Create a new Tome project. `name` and `team_id` (team slug) are required. Optional: `description`, `github_repos` (URLs or owner/name), `confluence_url`, `webex_rooms` (array of { room_id, name? }).",
    inputSchema: schema(
      {
        name: STR,
        team_id: STR,
        description: STR,
        github_repos: { type: "array", items: STR },
        confluence_url: STR,
        webex_rooms: {
          type: "array",
          items: schema({ room_id: STR, name: STR }, ["room_id"]),
        },
      },
      ["name", "team_id"],
    ),
    handler: async (_req, fwd, args) => {
      const body: Record<string, unknown> = { name: String(args.name), team_id: String(args.team_id) };
      if (args.description) body.description = String(args.description);
      if (Array.isArray(args.github_repos)) body.github_repos = args.github_repos;
      if (args.confluence_url) body.confluence_url = String(args.confluence_url);
      if (Array.isArray(args.webex_rooms)) body.webex_rooms = args.webex_rooms;
      const data = ensureOk(await fwd("POST", "/api/projects", body), "create project");
      const p = data?.project ?? {};
      return toolText(`Created project "${p.name}" (slug=${p.slug}, status=${p.status}).`);
    },
  },
  {
    name: "tome_add_repo",
    description:
      "Attach a GitHub repository to a project (appends to its existing repos). `project_slug` and `repo` (URL or owner/name) are required.",
    inputSchema: schema({ project_slug: STR, repo: STR }, ["project_slug", "repo"]),
    handler: async (_req, fwd, args) => {
      const slug = encodeURIComponent(String(args.project_slug));
      const detail = ensureOk(await fwd("GET", `/api/projects/${slug}`), "get project");
      const repos: string[] = [...(detail?.project?.sources?.repos ?? [])];
      const repo = String(args.repo);
      if (!repos.includes(repo)) repos.push(repo);
      ensureOk(await fwd("PATCH", `/api/projects/${slug}`, { sources: { repos } }), "add repo");
      return toolText(`Attached repo. Project now has ${repos.length} repo(s).`);
    },
  },
  {
    name: "tome_add_webex_room",
    description:
      "Attach a Webex room to a project (appends to its existing rooms). `project_slug` and `room_id` are required; `name` is optional.",
    inputSchema: schema({ project_slug: STR, room_id: STR, name: STR }, ["project_slug", "room_id"]),
    handler: async (_req, fwd, args) => {
      const slug = encodeURIComponent(String(args.project_slug));
      const detail = ensureOk(await fwd("GET", `/api/projects/${slug}`), "get project");
      const rooms: any[] = [...(detail?.project?.sources?.webex_rooms ?? [])];
      const roomId = String(args.room_id);
      if (!rooms.some((r) => r.room_id === roomId)) {
        rooms.push({ room_id: roomId, ...(args.name ? { name: String(args.name) } : {}) });
      }
      ensureOk(
        await fwd("PATCH", `/api/projects/${slug}`, { sources: { webex_rooms: rooms } }),
        "add webex room",
      );
      return toolText(`Attached Webex room. Project now has ${rooms.length} room(s).`);
    },
  },
  {
    name: "tome_add_confluence_space",
    description:
      "Set the Confluence space URL for a project. `project_slug` and `confluence_url` are required.",
    inputSchema: schema({ project_slug: STR, confluence_url: STR }, ["project_slug", "confluence_url"]),
    handler: async (_req, fwd, args) => {
      const slug = encodeURIComponent(String(args.project_slug));
      const confluence_url = String(args.confluence_url);
      ensureOk(
        await fwd("PATCH", `/api/projects/${slug}`, { sources: { confluence_url } }),
        "set confluence space",
      );
      return toolText(`Set Confluence space to ${confluence_url}.`);
    },
  },
  {
    name: "tome_talk_read",
    description:
      "Read a project's Talk page — the conversation ABOUT the project (Mycelium room messages), as opposed to the wiki which holds the context itself. Returns newest-first messages with sender, type, content, and timestamp, plus `total` for paging. `project_slug` is required; `limit` (default 50) and `offset` (default 0, for older pages) are optional.",
    inputSchema: schema(
      { project_slug: STR, limit: { type: "integer" }, offset: { type: "integer" } },
      ["project_slug"],
    ),
    handler: async (_req, fwd, args) => {
      const slug = encodeURIComponent(String(args.project_slug));
      const p = new URLSearchParams();
      if (args.limit) p.set("limit", String(args.limit));
      if (args.offset) p.set("offset", String(args.offset));
      const qs = p.toString() ? `?${p}` : "";
      const data = ensureOk(await fwd("GET", `/api/tome/projects/${slug}/talk${qs}`), "read talk");
      return toolText(
        JSON.stringify({ messages: data?.messages ?? [], total: data?.total ?? 0 }, null, 2),
      );
    },
  },
  {
    name: "tome_talk_send",
    description:
      "Post a message to a project's Talk page (its Mycelium room). Use for commentary/discussion about the project's context. `project_slug` and `message` are required.",
    inputSchema: schema({ project_slug: STR, message: STR }, ["project_slug", "message"]),
    handler: async (_req, fwd, args) => {
      const slug = encodeURIComponent(String(args.project_slug));
      const r = await fwd("POST", `/api/tome/projects/${slug}/talk`, {
        message: String(args.message),
      });
      const data = ensureOk(r, "send talk");
      return toolText(`Posted to the Talk page (id=${data?.message?.id}).`);
    },
  },
];

const TOOLS_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

// --- JSON-RPC dispatch ------------------------------------------------------

async function dispatch(request: NextRequest, rpc: RpcRequest, fwd: Forward) {
  switch (rpc.method) {
    case "initialize": {
      const requested = (rpc.params?.protocolVersion as string) || PROTOCOL_VERSION;
      return rpcResult(rpc.id, {
        protocolVersion: requested,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });
    }
    case "ping":
      return rpcResult(rpc.id, {});
    case "tools/list":
      return rpcResult(rpc.id, {
        tools: TOOLS.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      });
    case "tools/call": {
      const name = rpc.params?.name as string;
      const args = (rpc.params?.arguments as Record<string, any>) ?? {};
      const tool = TOOLS_BY_NAME.get(name);
      if (!tool) return rpcError(rpc.id, -32602, `Unknown tool: ${name}`);
      try {
        const result = await tool.handler(request, fwd, args);
        return rpcResult(rpc.id, result);
      } catch (e) {
        // Tool-level failures are reported as a tool result with isError, not a
        // protocol error, so the model can read and react to the message.
        return rpcResult(rpc.id, toolText(e instanceof Error ? e.message : String(e), true));
      }
    }
    default:
      return rpcError(rpc.id, -32601, `Method not found: ${rpc.method}`);
  }
}

export async function POST(request: NextRequest) {
  // Feature gate: 404 (not 401/403) when Tome is off, matching the rest of
  // /api/tome/** so a disabled host doesn't leak the feature's existence.
  if (!isTomeServerEnabled()) {
    return new NextResponse("Not found", { status: 404 });
  }

  // Authenticate the transport. Bearer (skills API token) or session cookie.
  try {
    await getAuthFromBearerOrSession(request);
  } catch {
    return NextResponse.json(
      rpcError(null, -32001, "Unauthorized — provide a valid bearer token."),
      { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="tome-mcp"' } },
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(rpcError(null, -32700, "Parse error"), { status: 400 });
  }

  const fwd = makeForward(request);

  // Support JSON-RPC batches as well as single requests.
  const isBatch = Array.isArray(payload);
  const items = (isBatch ? payload : [payload]) as RpcRequest[];

  const responses = [];
  for (const rpc of items) {
    if (!rpc || rpc.jsonrpc !== "2.0" || typeof rpc.method !== "string") {
      responses.push(rpcError(rpc?.id ?? null, -32600, "Invalid Request"));
      continue;
    }
    // Notifications (no id, e.g. notifications/initialized) get no response.
    const isNotification = rpc.id === undefined || rpc.id === null;
    const res = await dispatch(request, rpc, fwd);
    if (!isNotification) responses.push(res);
  }

  if (!responses.length) return new NextResponse(null, { status: 202 });
  return NextResponse.json(isBatch ? responses : responses[0]);
}
