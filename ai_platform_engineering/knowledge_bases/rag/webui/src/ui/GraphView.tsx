import React, { useState, useCallback, useEffect } from 'react';
import OntologyGraph from './Graph/OntologyGraph';
import DataGraph from './Graph/DataGraph';
import { getHealthStatus } from '../api';

type GraphViewType = 'ontology' | 'data';

interface GraphViewProps {
    exploreEntityData: {entityType: string, primaryKey: string} | null;
    onExploreComplete: () => void;
}

export default function GraphView({ exploreEntityData, onExploreComplete }: GraphViewProps) {
    const [activeView, setActiveView] = useState<GraphViewType>('ontology');
    const [graphRagEnabled, setGraphRagEnabled] = useState<boolean>(true);

    const fetchConfig = useCallback(async () => {
        try {
            const response = await getHealthStatus();
            const { config } = response;
            const graphRagEnabled = config?.graph_rag_enabled ?? true;
            setGraphRagEnabled(graphRagEnabled);
        } catch (error) {
            console.error('Failed to fetch config:', error);
        }
    }, []);

    // Initial config fetching
    useEffect(() => {
        fetchConfig();
    }, [fetchConfig]);

    // Switch to data view when exploreEntityData is provided
    useEffect(() => {
        if (exploreEntityData) {
            setActiveView('data');
        }
    }, [exploreEntityData]);

    return (
        <div className="relative h-full bg-slate-100 overflow-hidden flex flex-col">
            {/* --- Pill Tab Navigation --- */}
            <div className="absolute top-2 right-3 z-20">
                <div className="flex bg-white/95 rounded-md shadow-sm border border-gray-200 overflow-hidden backdrop-blur-sm">
                    <button
                        onClick={graphRagEnabled ? () => setActiveView('ontology') : undefined}
                        disabled={!graphRagEnabled}
                        className={`px-3 py-1 text-xs font-medium transition-colors ${
                            !graphRagEnabled
                                ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                                : activeView === 'ontology'
                                ? 'bg-brand-600 text-white'
                                : 'bg-white text-gray-600 hover:bg-gray-50'
                        }`}
                        title={!graphRagEnabled ? 'Graph RAG is disabled' : ''}
                    >
                        🌐 Ontology
                    </button>
                    <button
                        onClick={graphRagEnabled ? () => setActiveView('data') : undefined}
                        disabled={!graphRagEnabled}
                        className={`px-3 py-1 text-xs font-medium transition-colors ${
                            !graphRagEnabled
                                ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                                : activeView === 'data'
                                ? 'bg-brand-600 text-white'
                                : 'bg-white text-gray-600 hover:bg-gray-50'
                        }`}
                        title={!graphRagEnabled ? 'Graph RAG is disabled' : ''}
                    >
                        📊 Data
                    </button>
                </div>
            </div>

            {/* --- View Content --- */}
            <div className="flex-1 min-h-0">
                {activeView === 'ontology' ? (
                    <OntologyGraph />
                ) : (
                    <DataGraph
                        exploreEntityData={exploreEntityData}
                        onExploreComplete={onExploreComplete}
                    />
                )}
            </div>
        </div>
    );
}

