"use client";

import { AuthGuard } from "@/components/auth-guard";
import { WorkspaceHeader } from "@/components/layout/WorkspaceHeader";
import { KnowledgeSidebar } from "@/components/rag/KnowledgeSidebar";
import { Button } from "@/components/ui/button";
import { CAIPESpinner } from "@/components/ui/caipe-spinner";
import { useRAGHealth } from "@/hooks/use-rag-health";
import { config } from "@/lib/config";
import { BookOpen,RefreshCw,WifiOff } from "lucide-react";
import React from "react";

function KnowledgeBasesHeader(): React.ReactElement {
  return (
    <WorkspaceHeader
      description="Manage data sources, search content, and explore relationships."
      icon={BookOpen}
      iconAnimationClassName="motion-safe:duration-300 motion-safe:group-hover:-rotate-6 motion-safe:group-hover:scale-110"
      iconTestId="knowledge-bases-header-icon"
      title="Knowledge Bases"
    />
  );
}

function KnowledgeBasesLayoutContent({
  children,
}: {
  children: React.ReactNode;
}) {
  // Use the shared RAG health hook
  const { status: ragHealth, graphRagEnabled, checkNow: checkRagHealth } = useRAGHealth();

  // Disconnected state
  if (ragHealth === "disconnected") {
    return (
      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full max-w-[108rem] flex-col px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <KnowledgeBasesHeader />
          <div className="flex flex-1 flex-col items-center justify-center p-4 text-center text-muted-foreground">
          <WifiOff className="h-16 w-16 mb-4 text-destructive" />
          <h2 className="text-2xl font-bold mb-2 text-foreground">RAG Server Unavailable</h2>
          <p className="text-lg mb-4">
            Unable to connect to the RAG server at{" "}
            <span className="font-mono text-sm text-foreground">{config.ragUrl}</span>
          </p>
          <Button
            onClick={checkRagHealth}
            className="mt-4 flex items-center gap-2"
          >
            <RefreshCw className="h-4 w-4" />
            Retry Connection
          </Button>
          </div>
        </div>
      </main>
    );
  }

  // Loading state
  if (ragHealth === "checking") {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-background">
        <CAIPESpinner size="lg" message="Connecting to RAG server..." />
      </div>
    );
  }

  // Connected - use the same page-style workspace shell as Settings and Credentials.
  return (
    <main className="min-h-0 flex-1 overflow-y-auto lg:overflow-hidden">
      <div className="mx-auto flex min-h-full w-full max-w-[108rem] flex-col px-4 py-6 sm:px-6 lg:h-full lg:px-8 lg:py-8">
        <KnowledgeBasesHeader />
        <div className="space-y-6 lg:flex lg:min-h-0 lg:flex-1 lg:items-stretch lg:gap-10 lg:space-y-0">
          <KnowledgeSidebar graphRagEnabled={graphRagEnabled} />
          <div className="flex min-h-[42rem] min-w-0 flex-1 flex-col overflow-hidden lg:min-h-0">
            {children}
          </div>
        </div>
      </div>
    </main>
  );
}

export default function KnowledgeBasesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthGuard>
      <KnowledgeBasesLayoutContent>
        {children}
      </KnowledgeBasesLayoutContent>
    </AuthGuard>
  );
}
