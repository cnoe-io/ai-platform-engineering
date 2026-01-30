"use client";

/**
 * KnowledgePanel - Main container for RAG functionality
 *
 * This is the entry point for the Knowledge Bases tab.
 * Uses ported RAG WebUI components for full functionality.
 * Full screen layout with theme-compatible dark mode.
 */

import React, { useEffect, useState, useCallback } from "react";
import {
  Loader2,
  WifiOff,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { config } from "@/lib/config";
import { getHealthStatus } from "./api";
import SearchView from "./SearchView";
import IngestView from "./IngestView";
import GraphView from "./GraphView";

type TabType = "ingest" | "search" | "graph";

export function KnowledgePanel() {
  const [activeTab, setActiveTab] = useState<TabType>("ingest");
  const [ragHealth, setRagHealth] = useState<
    "connected" | "disconnected" | "checking"
  >("checking");
  const [ragHealthDetails, setRagHealthDetails] = useState<string | null>(null);
  const [graphRagEnabled, setGraphRagEnabled] = useState<boolean>(true);
  const [exploreEntityData, setExploreEntityData] = useState<{ entityType: string; primaryKey: string } | null>(null);

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
      <div className="flex flex-col items-center justify-center h-full bg-background">
        <div className="flex flex-col items-center gap-4">
          {/* CAIPE Logo with spinner */}
          <div className="relative">
            {/* Spinning glow ring */}
            <div
              className="absolute inset-[-8px] rounded-3xl opacity-30 gradient-primary-br"
              style={{
                animation: 'spin 3s linear infinite',
              }}
            />
            {/* Blur glow */}
            <div
              className="absolute inset-[-4px] rounded-2xl blur-xl opacity-40 gradient-primary"
            />
            {/* Logo container */}
            <div className="relative w-16 h-16 rounded-2xl gradient-primary-br flex items-center justify-center shadow-2xl">
              <img src="/logo.svg" alt="CAIPE" className="h-10 w-10" />
            </div>
          </div>
          {/* Spinner */}
          <div className="flex items-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <span className="text-sm text-muted-foreground">Connecting to RAG server...</span>
          </div>
        </div>
      </div>
    );
  }

  // Connected - show tabbed interface (full screen layout)
  return (
    <div className="h-full flex flex-col bg-background">
      {/* Compact Tab Navigation with connection status */}
      <div className="flex-shrink-0 w-full px-6 py-2 border-b border-border bg-card/50">
        <div className="flex items-center justify-between">
          {/* Tab Navigation */}
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

          {/* Connection Status */}
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${ragHealth === 'connected' ? 'bg-emerald-500' : 'bg-destructive'}`}></span>
            <span className="text-xs uppercase tracking-wide text-muted-foreground">{ragHealth}</span>
          </div>
        </div>
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
