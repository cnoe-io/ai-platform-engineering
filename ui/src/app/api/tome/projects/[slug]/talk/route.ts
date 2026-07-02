// Tome "Talk page": the project's conversation, backed by a Mycelium room.
//
//   GET  /api/tome/projects/[slug]/talk        → { messages, total }
//   POST /api/tome/projects/[slug]/talk { message } → { message }
//
// Auth happens here (loadTomeProject = feature gate + project resolution +
// identity). The Mycelium backend is unauthenticated and internal-only; this
// route is the front door, so it never gets exposed directly. Room = slug.

import { NextRequest } from "next/server";

import { ApiError, successResponse, withErrorHandler } from "@/lib/api-middleware";
import { loadTomeProject } from "@/lib/tome/tome-api";
import { auditTome, tomeActorFromAuth } from "@/lib/tome/audit";
import { isMyceliumConfigured, listMessages, sendMessage } from "@/lib/tome/mycelium";
import type { MyceliumMessage } from "@/lib/tome/mycelium";
import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

/** Resolve sender emails → display names from the `users` collection.
 *  Best-effort: only CAIPE-logged-in users are present, so external senders
 *  and agents fall back to their handle on the client. */
async function withDisplayNames(
  messages: MyceliumMessage[],
): Promise<(MyceliumMessage & { display_name: string | null })[]> {
  const fallback = messages.map((m) => ({ ...m, display_name: null }));
  if (!isMongoDBConfigured) return fallback;

  const emails = [
    ...new Set(
      messages
        .map((m) => m.sender_handle)
        .filter((h) => h.includes("@"))
        .map((h) => h.toLowerCase()),
    ),
  ];
  if (!emails.length) return fallback;

  const users = await getCollection<{ email?: string; name?: string }>("users");
  const docs = await users
    .find({ email: { $in: emails } })
    .project({ email: 1, name: 1 })
    .toArray();
  const byEmail = new Map<string, string>();
  for (const d of docs) {
    if (d.email && d.name) byEmail.set(String(d.email).toLowerCase(), String(d.name));
  }

  return messages.map((m) => ({
    ...m,
    display_name: byEmail.get(m.sender_handle.toLowerCase()) ?? null,
  }));
}

function ensureConfigured(): void {
  if (!isMyceliumConfigured()) {
    throw new ApiError(
      "Mycelium is not configured (set MYCELIUM_URL).",
      503,
      "MYCELIUM_NOT_CONFIGURED",
    );
  }
}

export const GET = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  const { slug } = await ctx.params;
  await loadTomeProject(request, slug); // auth + project resolution
  ensureConfigured();

  const { searchParams } = new URL(request.url);
  const limitRaw = Number(searchParams.get("limit"));
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : 50;
  const offsetRaw = Number(searchParams.get("offset"));
  const offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? offsetRaw : 0;

  const data = await listMessages(slug, { limit, offset });
  const messages = await withDisplayNames(data.messages);
  return successResponse({ messages, total: data.total });
});

export const POST = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  const { slug } = await ctx.params;
  const tctx = await loadTomeProject(request, slug);
  ensureConfigured();

  const body = (await request.json().catch(() => ({}))) as { message?: string };
  if (!body.message || typeof body.message !== "string" || !body.message.trim()) {
    throw new ApiError("`message` (string) is required", 400, "BAD_REQUEST");
  }

  const sender = tctx.user.email || "unknown";
  // Distinguish who actually posted: the web UI authenticates with a session
  // cookie, while the MCP (tome_talk_send) forwards an `Authorization: Bearer`
  // token. A Bearer here means the message came from an agent acting as the
  // user, not the user typing in the UI. Encode it in `message_type`.
  //
  // Mycelium's public message API only accepts announce|direct|broadcast|delegate
  // (mycelium schemas.py); "agent" is rejected with a 422. Humans post as
  // "broadcast"; agents post as "announce" - a room-wide type (no recipient).
  // In a Tome room only humans and agents post, so "announce" unambiguously
  // means "posted by an agent".
  const viaBearer = (request.headers.get("Authorization") || "").startsWith("Bearer ");
  const message = await sendMessage(slug, {
    sender_handle: sender,
    content: body.message.trim(),
    message_type: viaBearer ? "announce" : "broadcast",
  });

  auditTome({
    action: "tome.talk.post",
    actor: tomeActorFromAuth({ user: tctx.user, session: tctx.session }),
    projectSlug: slug,
    metadata: { via: viaBearer ? "agent" : "web" },
  });

  return successResponse({ message }, 201);
});
