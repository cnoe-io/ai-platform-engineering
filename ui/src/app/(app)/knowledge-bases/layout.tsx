"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Loader2,
  WifiOff,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { config } from "@/lib/config";
import { cn } from "@/lib/utils";
import { RagAuthIndicator } from "@/components/rag/RagAuthBanner";
import { useRAGHealth } from "@/hooks/use-rag-health";

export default function KnowledgeBasesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  
  // Use the shared RAG health hook
  const { status: ragHealth, graphRagEnabled, checkNow: checkRagHealth } = useRAGHealth();

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
      <div className="flex-1 flex flex-col items-center justify-center bg-background text-muted-foreground">
        <Loader2 className="h-16 w-16 animate-spin text-primary" />
        <p className="mt-4 text-lg">Connecting to RAG server...</p>
      </div>
    );
  }

  // Connected - show tabbed interface
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Compact Tab Navigation */}
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

          {/* Auth Status */}
          <RagAuthIndicator />
        </div>
      </div>

      {/* Tab Content */}
      {children}
    </div>
  );
}
