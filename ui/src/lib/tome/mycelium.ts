// Thin client for the Mycelium hub — the "Talk page" backing store.
//
// Tome is a *spoke*: it maps one project → one Mycelium room (`room =
// project.slug`) and reads/writes that room's messages. We deliberately use
// only the messages slice of Mycelium's API (rooms + messages); memory,
// negotiation, and CFN are out of scope for the Talk page.
//
// Mycelium's backend has no auth of its own and is expected to live on the
// internal network (never publicly exposed) — tome's authenticated routes
// front it. `MYCELIUM_URL` points at the backend (e.g. http://mycelium-backend:8000).
// When unset, the Talk feature is considered not-configured and callers should
// surface that cleanly (mirrors the TOME_AGENT_URL contract).

const DEFAULT_MESSAGE_TYPE = "broadcast"; // room-wide post, no specific recipient

export interface MyceliumMessage {
  id: string;
  room_name: string | null;
  sender_handle: string;
  recipient_handle: string | null;
  message_type: string;
  content: string;
  created_at: string;
}

export interface MyceliumMessageList {
  messages: MyceliumMessage[];
  total: number;
}

export class MyceliumNotConfiguredError extends Error {
  constructor() {
    super("Mycelium is not configured (set MYCELIUM_URL).");
    this.name = "MyceliumNotConfiguredError";
  }
}

export class MyceliumError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "MyceliumError";
  }
}

export function isMyceliumConfigured(): boolean {
  return Boolean(process.env.MYCELIUM_URL?.trim());
}

function baseUrl(): string {
  const url = process.env.MYCELIUM_URL?.trim();
  if (!url) throw new MyceliumNotConfiguredError();
  return url.replace(/\/$/, "");
}

/** One Mycelium room per project. Centralized so the mapping is easy to change
 *  (e.g. add a namespace prefix if the hub is shared across apps). */
export function roomNameForProject(slug: string): string {
  return slug;
}

async function call(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<Response> {
  const res = await fetch(`${baseUrl()}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    // Talk traffic is conversational, not cached.
    cache: "no-store",
  });
  return res;
}

async function failure(res: Response, what: string): Promise<MyceliumError> {
  const detail = await res.text().catch(() => "");
  return new MyceliumError(`${what} failed (${res.status}): ${detail.slice(0, 300)}`, res.status);
}

/** Create the project's room if it doesn't exist yet. Idempotent. */
export async function ensureRoom(slug: string, description?: string): Promise<void> {
  const room = roomNameForProject(slug);
  const existing = await call("GET", `/api/rooms/${encodeURIComponent(room)}`);
  if (existing.ok) return;
  if (existing.status !== 404) throw await failure(existing, "check room");

  const created = await call("POST", "/api/rooms", {
    name: room,
    description: description ?? `Tome talk page for ${slug}`,
    is_public: true,
  });
  // Tolerate a race: another request may have created it first (409/400).
  if (!created.ok && created.status !== 409 && created.status !== 400) {
    throw await failure(created, "create room");
  }
}

/** List a project room's messages, newest API order. */
export async function listMessages(
  slug: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<MyceliumMessageList> {
  const room = roomNameForProject(slug);
  const params = new URLSearchParams();
  if (opts.limit != null) params.set("limit", String(opts.limit));
  if (opts.offset != null) params.set("offset", String(opts.offset));
  const qs = params.toString() ? `?${params}` : "";
  const res = await call("GET", `/api/rooms/${encodeURIComponent(room)}/messages${qs}`);
  if (res.status === 404) return { messages: [], total: 0 }; // room not created yet
  if (!res.ok) throw await failure(res, "list messages");
  return (await res.json()) as MyceliumMessageList;
}

/** Post a message to a project's room. Ensures the room exists first. */
export async function sendMessage(
  slug: string,
  opts: {
    sender_handle: string;
    content: string;
    message_type?: string;
    recipient_handle?: string | null;
  },
): Promise<MyceliumMessage> {
  await ensureRoom(slug);
  const room = roomNameForProject(slug);
  const res = await call("POST", `/api/rooms/${encodeURIComponent(room)}/messages`, {
    sender_handle: opts.sender_handle,
    recipient_handle: opts.recipient_handle ?? null,
    message_type: opts.message_type ?? DEFAULT_MESSAGE_TYPE,
    content: opts.content,
  });
  if (!res.ok) throw await failure(res, "send message");
  return (await res.json()) as MyceliumMessage;
}
