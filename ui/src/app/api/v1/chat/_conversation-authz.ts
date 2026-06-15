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
