import { NextResponse } from "next/server";

import { getCollection } from "@/lib/mongodb";
import { requireConversationResourcePermission } from "@/lib/rbac/conversation-implicit-authz";
import type { Conversation } from "@/types/mongodb";

import type { AuthResult } from "./_helpers";

export async function requireConversationWriteAccess(
  authResult: AuthResult,
  conversationId: string,
): Promise<NextResponse | null> {
  const conversations = await getCollection<Conversation>("conversations");
  const conversation = await conversations.findOne({ _id: conversationId });
  if (!conversation) {
    return NextResponse.json(
      {
        success: false,
        error: "Conversation not found",
        code: "conversation#write",
      },
      { status: 404 },
    );
  }

  // Slack threads are inherently multi-participant — anyone in the channel
  // should be able to invoke the agent within a thread, not just the user who
  // originally @mentioned the bot. Rather than granting wildcard writer tuples
  // (which would also leak read access via the model's `can_read: ... or
  // can_write` rule), we bypass the conversation#write check for Slack
  // conversations here.
  //
  // Safe because:
  //   - agent#can_use is enforced first and independently on every invoke/stream
  //     route, so this grants no tool/data/agent access.
  //   - `client_type` is read from the stored document, never the request body,
  //     so a caller cannot spoof it; no update path lets it be flipped to 'slack'.
  //   - Read endpoints (GET messages/turns/detail) still require `can_read`,
  //     which this does not touch — thread history stays ReBAC-protected.
  //   - Metadata mutation is separately gated (owner-only), so routing keys
  //     cannot be injected via this path.
  if (conversation.client_type === "slack") {
    return null;
  }

  try {
    await requireConversationResourcePermission(
      // Carry isServiceAccount so subjectFromSession graphs SA callers as
      // `service_account:<sub>` (not `user:<sub>`). Without this, a Slack route
      // running as a service account fails conversation#write even though the
      // SA holds the writer grant on the conversation it created.
      { sub: authResult.subject, user: { email: authResult.email }, isServiceAccount: authResult.isServiceAccount },
      authResult.email ?? "",
      conversation,
      "write",
    );
    return null;
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Access denied",
        code: (error as { code?: string }).code,
      },
      { status: (error as { statusCode?: number }).statusCode ?? 500 },
    );
  }
}
