import React from "react";
import { AuthGuard } from "@/components/auth-guard";
import { KbSharingPanel } from "@/components/rag/KbSharingPanel";

interface KbSharingPageProps {
  params: Promise<{ id: string }>;
}

/**
 * Per-Knowledge-Base sharing page.
 *
 * Wraps `KbSharingPanel`. The page itself does not enforce RBAC (the BFF
 * route does that on every read/write) so admins linking directly from
 * external tools land on a useful "you need access" empty state via the
 * existing `requireResourcePermission` 403 → BFF handler.
 */
export default async function KnowledgeBaseSharingPage({ params }: KbSharingPageProps) {
  const { id } = await params;
  return (
    <AuthGuard>
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-3xl space-y-4 p-6">
          <header className="space-y-1">
            <h1 className="text-xl font-semibold text-foreground">Knowledge Base Sharing</h1>
            <p className="text-xs text-muted-foreground">
              Manage which CAIPE teams can read this knowledge base. <code>{id}</code>
            </p>
          </header>
          <KbSharingPanel knowledgeBaseId={id} />
        </div>
      </div>
    </AuthGuard>
  );
}
