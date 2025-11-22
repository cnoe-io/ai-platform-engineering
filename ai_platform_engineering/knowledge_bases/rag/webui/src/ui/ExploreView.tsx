import React, { useState, useCallback, useEffect } from 'react';
import OntologyGraph from './Graph/OntologyGraph/OntologyGraph';
import DataGraph from './Graph/DataGraph/DataGraph';
import SearchView from './SearchView';
import { getHealthStatus } from '../api';

type ViewType = 'ontology' | 'data' | 'search';

export default function ExploreView() {
    const [activeView, setActiveView] = useState<ViewType>('search');
    const [exploreEntityData, setExploreEntityData] = useState<{entityType: string, primaryKey: string} | null>(null);
    const [graphRagEnabled, setGraphRagEnabled] = useState<boolean>(true);

    const fetchConfig = useCallback(async () => {
        try {
            const response = await getHealthStatus();
            const { config } = response;
            const graphRagEnabled = config?.graph_rag_enabled ?? true;
            setGraphRagEnabled(graphRagEnabled);

            // If graph RAG is disabled and user is on a graph tab, redirect to search
            if (!graphRagEnabled && (activeView === 'ontology' || activeView === 'data')) {
                setActiveView('search');
            }
        } catch (error) {
            console.error('Failed to fetch config:', error);
        }
    }, [activeView]);





    const handleExploreEntity = (entityType: string, primaryKey: string) => {
        setExploreEntityData({ entityType, primaryKey });
        setActiveView('data'); // Switch to data view
    };

    const handleExploreComplete = () => {
        setExploreEntityData(null);
    };



    // Initial config and status fetching
    useEffect(() => {
        // Fetch config once on component mount
        fetchConfig();
    }, [fetchConfig]);



    return (
        <div className="relative h-full bg-slate-100 overflow-hidden">
            {/* --- Tab Navigation --- */}
            <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-20">
                <div className="flex bg-white rounded-lg shadow-md border overflow-hidden">
                    <button
                        onClick={() => setActiveView('search')}
                        className={`px-6 py-2 text-sm font-medium transition-colors ${
                            activeView === 'search'
                                ? 'bg-brand-600 text-white'
                                : 'bg-white text-gray-700 hover:bg-gray-50'
                        }`}
                    >
                        🔍 Search
                    </button>
                    <button
                        onClick={graphRagEnabled ? () => setActiveView('ontology') : undefined}
                        disabled={!graphRagEnabled}
                        className={`px-6 py-2 text-sm font-medium transition-colors ${
                            !graphRagEnabled
                                ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                                : activeView === 'ontology'
                                ? 'bg-brand-600 text-white'
                                : 'bg-white text-gray-700 hover:bg-gray-50'
                        }`}
                        title={!graphRagEnabled ? 'Graph RAG is disabled' : ''}
                    >
                        🌐 Graph: Ontology
                    </button>
                    <button
                        onClick={graphRagEnabled ? () => setActiveView('data') : undefined}
                        disabled={!graphRagEnabled}
                        className={`px-6 py-2 text-sm font-medium transition-colors ${
                            !graphRagEnabled
                                ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                                : activeView === 'data'
                                ? 'bg-brand-600 text-white'
                                : 'bg-white text-gray-700 hover:bg-gray-50'
                        }`}
                        title={!graphRagEnabled ? 'Graph RAG is disabled' : ''}
                    >
                        📊 Graph: Data
                    </button>
                </div>
            </div>

            {/* --- View Content --- */}
            <div className="h-full">
                {activeView === 'search' ? (
                    <SearchView onExploreEntity={handleExploreEntity} />
                ) : activeView === 'ontology' ? (
                    <OntologyGraph />
                ) : (
                    <DataGraph
                        exploreEntityData={exploreEntityData}
                        onExploreComplete={handleExploreComplete}
                    />
                )}
            </div>
        </div>
    );
}