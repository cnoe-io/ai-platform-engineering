"use client";

/**
 * KnowledgePanel - Main container for RAG functionality
 *
 * This is the entry point for the Knowledge Bases tab.
 * Uses ported RAG WebUI components for full functionality.
 * Full screen layout with theme-compatible dark mode.
 */

import React, { useState, useCallback } from "react";
import {
  Loader2,
  WifiOff,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { config } from "@/lib/config";
import { useRAGHealth } from "@/hooks/use-rag-health";
import SearchView from "./SearchView";
import IngestView from "./IngestView";
import GraphView from "./GraphView";

type TabType = "ingest" | "search" | "graph";

export function KnowledgePanel() {
  const [activeTab, setActiveTab] = useState<TabType>("ingest");
  const [exploreEntityData, setExploreEntityData] = useState<{ entityType: string; primaryKey: string } | null>(null);

  // Use the shared RAG health hook
  const { status: ragHealth, graphRagEnabled, checkNow: checkRagHealth } = useRAGHealth();

  // Handle explore entity from search
  const handleExploreEntity = useCallback((entityType: string, primaryKey: string) => {
    setExploreEntityData({ entityType, primaryKey });
    setActiveTab("graph");
  }, []);

  const handleExploreComplete = useCallback(() => {
    setExploreEntityData(null);
  }, []);

  // Disconnected state
  if (ragHealth === "disconnected") {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-background text-muted-foreground p-4 text-center">
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
      <div className="flex flex-col items-center justify-center h-full bg-background text-muted-foreground">
        <Loader2 className="h-16 w-16 animate-spin text-primary" />
        <p className="mt-4 text-lg">Connecting to RAG server...</p>
      </div>
    );
  }

  // Connected - show tabbed interface (full screen layout)
  return (
    <div className="h-full flex flex-col bg-background">
      {/* Compact Tab Navigation */}
      <div className="flex-shrink-0 w-full px-6 py-2 border-b border-border bg-card/50">
        <nav className="flex gap-6" aria-label="Tabs">
          <button
            onClick={() => setActiveTab('ingest')}
            className={`shrink-0 py-2 text-sm font-semibold transition-all duration-200 flex items-center gap-2 border-b-2 ${
              activeTab === 'ingest'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <span>🗃️</span> Data Sources
          </button>
          <button
            onClick={() => setActiveTab('search')}
            className={`shrink-0 py-2 text-sm font-semibold transition-all duration-200 flex items-center gap-2 border-b-2 ${
              activeTab === 'search'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <span>🔍</span> Search
          </button>
          <button
            onClick={graphRagEnabled ? () => setActiveTab('graph') : undefined}
            disabled={!graphRagEnabled}
            className={`shrink-0 py-2 text-sm font-semibold transition-all duration-200 flex items-center gap-2 border-b-2 ${
              !graphRagEnabled
                ? 'border-transparent text-muted-foreground/50 cursor-not-allowed'
                : activeTab === 'graph'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
            title={!graphRagEnabled ? 'Graph RAG is disabled' : ''}
          >
            <span>✳</span> Graph
          </button>
        </nav>
      </div>

      {/* Tab Content - full width */}
      <div className="flex-1 min-h-0 w-full overflow-hidden">
        {activeTab === 'ingest' && <IngestView />}
        {activeTab === 'search' && (
          <SearchView onExploreEntity={handleExploreEntity} />
        )}
        {activeTab === 'graph' && (
          <GraphView
            exploreEntityData={exploreEntityData}
            onExploreComplete={handleExploreComplete}
          />
        )}
      </div>
    </div>
  );
}
