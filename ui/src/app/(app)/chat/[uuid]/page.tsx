"use client";

import { AuthGuard } from "@/components/auth-guard";

/**
 * Chat UUID page — this page exists only to define the /chat/[uuid] route.
 * The actual chat rendering is handled by ChatContainer in the layout,
 * which persists across conversation switches to prevent visual refresh.
 * 
 * We still wrap in AuthGuard to ensure authentication is checked.
 */
function ChatUUIDPage() {
  // ChatContainer in layout.tsx handles all rendering based on useParams()
  return null;
}

export default function ChatUUID() {
  return (
    <AuthGuard>
      <ChatUUIDPage />
    </AuthGuard>
  );
}
