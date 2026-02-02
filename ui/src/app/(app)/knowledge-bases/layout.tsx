"use client";

import React, { useState } from "react";
import {
  Loader2,
  WifiOff,
  RefreshCw,
  Database,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { CAIPESpinner } from "@/components/ui/caipe-spinner";
import { config } from "@/lib/config";
import { useRAGHealth } from "@/hooks/use-rag-health";
import { KnowledgeSidebar } from "@/components/rag/KnowledgeSidebar";
import { AuthGuard } from "@/components/auth-guard";

function KnowledgeBasesLayoutContent({
  children,
}: {
  children: React.ReactNode;
}) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  
  // Use the shared RAG health hook
  const { status: ragHealth, graphRagEnabled, checkNow: checkRagHealth } = useRAGHealth();

  // Disconnected state
  if (ragHealth === "disconnected") {
    return (
      <div className="flex-1 flex flex-col bg-background overflow-hidden">
        {/* Header with Gradient */}
        <div className="relative overflow-hidden border-b border-border shrink-0">
          <div 
            className="absolute inset-0" 
            style={{
              background: `linear-gradient(to bottom right, color-mix(in srgb, var(--gradient-from) 15%, transparent) 0%, color-mix(in srgb, var(--gradient-to) 8%, transparent) 50%, transparent 100%)`
            }}
          />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/5 via-transparent to-transparent" />

          <div className="relative px-6 py-3 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-destructive/20 shadow-sm">
              <WifiOff className="h-5 w-5 text-destructive" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-foreground">Knowledge Bases</h1>
              <p className="text-destructive text-xs">
                RAG Server Unavailable
              </p>
            </div>
          </div>
        </div>

        <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground p-4 text-center">
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

  // Connected - show sidebar + content layout
  return (
    <div className="flex-1 flex min-h-0">
      {/* Sidebar */}
      <KnowledgeSidebar
        collapsed={sidebarCollapsed}
        onCollapse={setSidebarCollapsed}
        graphRagEnabled={graphRagEnabled}
      />

      {/* Main Content */}
      <div className="flex-1 min-w-0 overflow-y-auto">
        {children}
      </div>
    </div>
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
