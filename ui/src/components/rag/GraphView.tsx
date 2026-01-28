"use client";

/**
 * GraphView - Ported from RAG WebUI
 *
 * Full Sigma.js graph visualization for ontology and data exploration.
 */

import React, { useState, useCallback, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { getHealthStatus } from './api';
import { Loader2 } from 'lucide-react';

// Dynamically import Sigma components with SSR disabled
// This is required because Sigma.js uses browser-only APIs
const OntologyGraphSigma = dynamic(
    () => import('./graph/OntologyGraph/OntologyGraphSigma'),
    {
        ssr: false,
        loading: () => (
            <div className="h-full flex items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        )
    }
);

const DataGraphSigma = dynamic(
    () => import('./graph/DataGraph/DataGraphSigma'),
    {
        ssr: false,
        loading: () => (
            <div className="h-full flex items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        )
    }
);

type GraphViewType = 'ontology' | 'data';

interface GraphViewProps {
    exploreEntityData?: { entityType: string; primaryKey: string } | null;
    onExploreComplete?: () => void;
}

export default function GraphView({ exploreEntityData, onExploreComplete }: GraphViewProps) {
    const [activeView, setActiveView] = useState<GraphViewType>('ontology');
    const [graphRagEnabled, setGraphRagEnabled] = useState<boolean | null>(null);
    const [loading, setLoading] = useState(true);

    const fetchConfig = useCallback(async () => {
        try {
            const response = await getHealthStatus();
            const { config } = response;
            const enabled = config?.graph_rag_enabled ?? false;
            setGraphRagEnabled(enabled);
        } catch (error) {
            console.error('Failed to fetch config:', error);
            setGraphRagEnabled(false);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchConfig();
    }, [fetchConfig]);

    useEffect(() => {
        if (exploreEntityData) {
            setActiveView('data');
        }
    }, [exploreEntityData]);

    if (loading) {
        return (
            <div className="h-full flex items-center justify-center bg-muted/50">
                <div className="text-center">
                    <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-4" />
                    <p className="text-muted-foreground">Loading graph configuration...</p>
                </div>
            </div>
        );
    }

    if (!graphRagEnabled) {
        return (
            <div className="h-full flex flex-col items-center justify-center bg-muted/50 p-8">
                <div className="text-center max-w-md">
                    <div className="text-6xl mb-4">🔗</div>
                    <h2 className="text-2xl font-bold text-foreground mb-4">
                        Graph RAG is Disabled
                    </h2>
                    <p className="text-muted-foreground mb-6">
                        Knowledge graph visualization is currently not available.
                        Graph RAG can be enabled in the RAG server configuration to unlock
                        entity relationship exploration and ontology visualization.
                    </p>
                    <div className="bg-card rounded-lg p-4 border border-border">
                        <h3 className="font-semibold text-foreground mb-2">What Graph RAG provides:</h3>
                        <ul className="text-sm text-muted-foreground text-left space-y-2">
                            <li className="flex items-start gap-2">
                                <span className="text-green-500">✓</span>
                                <span>Ontology graph visualization - see entity types and relationships</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-green-500">✓</span>
                                <span>Data graph exploration - navigate between related entities</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-green-500">✓</span>
                                <span>Entity neighborhood exploration from search results</span>
                            </li>
                        </ul>
                    </div>
                </div>
            </div>
        );
    }

    // Graph RAG is enabled - show the graph interface
    return (
        <div className="relative h-full bg-muted/50 overflow-hidden flex flex-col">
            {/* Tab Navigation - Centered at top */}
            <div className="absolute top-6 left-1/2 -translate-x-1/2 z-20">
                <div className="flex bg-card rounded-md shadow-md border border-border overflow-hidden backdrop-blur-sm">
                    <button
                        onClick={() => setActiveView('ontology')}
                        className={`px-3 py-1.5 text-xs font-medium transition-all duration-200 flex items-center gap-1.5 ${
                            activeView === 'ontology'
                                ? 'bg-primary text-primary-foreground shadow-inner'
                                : 'bg-card text-muted-foreground hover:bg-muted hover:text-foreground'
                        }`}
                    >
                        <span className="text-sm">🌐</span> Ontology
                    </button>
                    <button
                        onClick={() => setActiveView('data')}
                        className={`px-3 py-1.5 text-xs font-medium transition-all duration-200 flex items-center gap-1.5 ${
                            activeView === 'data'
                                ? 'bg-primary text-primary-foreground shadow-inner'
                                : 'bg-card text-muted-foreground hover:bg-muted hover:text-foreground'
                        }`}
                    >
                        <span className="text-sm">📊</span> Data
                    </button>
                </div>
            </div>

            {/* Graph Content */}
            <div className="flex-1 min-h-0">
                {activeView === 'ontology' ? (
                    <OntologyGraphSigma />
                ) : (
                    <DataGraphSigma
                        exploreEntityData={exploreEntityData}
                        onExploreComplete={onExploreComplete}
                    />
                )}
            </div>
        </div>
    );
}
