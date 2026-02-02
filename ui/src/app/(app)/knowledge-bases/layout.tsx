"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Loader2,
  WifiOff,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { CAIPESpinner } from "@/components/ui/caipe-spinner";
import { config } from "@/lib/config";
import { getHealthStatus } from "@/components/rag/api";
import { cn } from "@/lib/utils";
import { AuthGuard } from "@/components/auth-guard";

function KnowledgeBasesLayoutContent({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [ragHealth, setRagHealth] = useState<
    "connected" | "disconnected" | "checking"
  >("checking");
  const [ragHealthDetails, setRagHealthDetails] = useState<string | null>(null);
  const [graphRagEnabled, setGraphRagEnabled] = useState<boolean>(true);

  const checkRagHealth = async () => {
    setRagHealth("checking");
    setRagHealthDetails(null);
    try {
      const data = await getHealthStatus();
      if (data.status === "healthy") {
        setRagHealth("connected");
        setGraphRagEnabled(data.config?.graph_rag_enabled ?? true);
      } else {
        setRagHealth("disconnected");
        setRagHealthDetails(`RAG server reported unhealthy: ${JSON.stringify(data)}`);
      }
    } catch (error: unknown) {
      console.error("[RAG] Error checking health:", error);
      setRagHealth("disconnected");
      setRagHealthDetails(
        error instanceof Error ? error.message : "Unknown error"
      );
    }
  };

  useEffect(() => {
    checkRagHealth();
    const interval = setInterval(checkRagHealth, 30000);
    return () => clearInterval(interval);
  }, []);

  const getActiveTab = () => {
    if (pathname?.includes("/ingest")) return "ingest";
    if (pathname?.includes("/search")) return "search";
    if (pathname?.includes("/graph")) return "graph";
    return "ingest";
  };

  const activeTab = getActiveTab();

  // Disconnected state
  if (ragHealth === "disconnected") {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-background text-muted-foreground p-4 text-center">
        <WifiOff className="h-16 w-16 mb-4 text-destructive" />
        <h2 className="text-2xl font-bold mb-2 text-foreground">RAG Server Unavailable</h2>
        <p className="text-lg mb-4">
          Unable to connect to the RAG server at{" "}
          <span className="font-mono text-sm text-foreground">{config.ragUrl}</span>
        </p>
        {ragHealthDetails && (
          <p className="text-sm text-destructive mb-4 max-w-md break-all">
            Error: {ragHealthDetails}
          </p>
        )}
        <Button
          onClick={checkRagHealth}
          className="mt-4 flex items-center gap-2"
        >
          <RefreshCw className="h-4 w-4" />
          Retry Connection
        </Button>
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

  // Connected - show tabbed interface
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Compact Tab Navigation with connection status */}
      <div className="flex-shrink-0 w-full px-6 py-2 border-b border-border bg-card/50">
        <div className="flex items-center justify-between">
          {/* Tab Navigation */}
          <nav className="flex gap-6" aria-label="Tabs">
            <Link
              href="/knowledge-bases/ingest"
              prefetch={true}
              className={cn(
                "shrink-0 py-2 text-sm font-semibold transition-all duration-200 flex items-center gap-2 border-b-2",
                activeTab === "ingest"
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              <span>🗃️</span> Data Sources
            </Link>
            <Link
              href="/knowledge-bases/search"
              prefetch={true}
              className={cn(
                "shrink-0 py-2 text-sm font-semibold transition-all duration-200 flex items-center gap-2 border-b-2",
                activeTab === "search"
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              <span>🔍</span> Search
            </Link>
            <Link
              href="/knowledge-bases/graph"
              prefetch={true}
              className={cn(
                "shrink-0 py-2 text-sm font-semibold transition-all duration-200 flex items-center gap-2 border-b-2",
                !graphRagEnabled
                  ? "border-transparent text-muted-foreground/50 cursor-not-allowed pointer-events-none"
                  : activeTab === "graph"
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
              title={!graphRagEnabled ? "Graph RAG is disabled" : ""}
            >
              <span>✳</span> Graph
            </Link>
          </nav>

          {/* Connection Status */}
          <div className="flex items-center gap-2">
            <span className={cn(
              "h-2 w-2 rounded-full",
              ragHealth === "connected" ? "bg-emerald-500" : "bg-destructive"
            )} />
            <span className="text-xs uppercase tracking-wide text-muted-foreground">{ragHealth}</span>
          </div>
        </div>
      </div>

      {/* Tab Content */}
      {children}
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
