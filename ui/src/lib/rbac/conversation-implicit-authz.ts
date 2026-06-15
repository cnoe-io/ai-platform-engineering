import type { Conversation } from "@/types/mongodb";

import {
filterResourcesByPermission,
requireResourcePermission,
type ResourceAuthzSession,
type ResourcePermissionAction,
} from "./resource-authz";

function stableSubject(session: ResourceAuthzSession): string | null {
  return typeof session.sub === "string" && session.sub.trim() ? session.sub.trim() : null;
}

function normalizeEmail(email: string | undefined): string {
  return email?.trim().toLowerCase() ?? "";
}

export function isImplicitConversationOwner(
  session: ResourceAuthzSession,
  userEmail: string,
  conversation: Pick<Conversation, "owner_id" | "owner_subject">,
): boolean {
  const subject = stableSubject(session);
  if (subject && conversation.owner_subject === subject) return true;
  return Boolean(normalizeEmail(userEmail) && normalizeEmail(conversation.owner_id) === normalizeEmail(userEmail));
}

export async function requireConversationResourcePermission(
  session: ResourceAuthzSession,
  userEmail: string,
  conversation: Conversation,
  action: ResourcePermissionAction,
): Promise<void> {
  if (isImplicitConversationOwner(session, userEmail, conversation)) return;
  await requireResourcePermission(session, {
    type: "conversation",
    id: conversation._id,
    action,
  });
}

export async function filterConversationsByImplicitOrExplicitPermission<T extends Conversation>(
  session: ResourceAuthzSession,
  userEmail: string,
  conversations: T[],
  action: ResourcePermissionAction = "discover",
): Promise<T[]> {
  const implicitIds = new Set(
    conversations
      .filter((conversation) => isImplicitConversationOwner(session, userEmail, conversation))
      .map((conversation) => conversation._id),
  );
  const explicitCandidates = conversations.filter((conversation) => !implicitIds.has(conversation._id));
  const explicitVisible = await filterResourcesByPermission(session, explicitCandidates, {
    type: "conversation",
    action,
    id: (conversation) => conversation._id,
  });
  const explicitIds = new Set(explicitVisible.map((conversation) => conversation._id));
  return conversations.filter((conversation) => implicitIds.has(conversation._id) || explicitIds.has(conversation._id));
}
