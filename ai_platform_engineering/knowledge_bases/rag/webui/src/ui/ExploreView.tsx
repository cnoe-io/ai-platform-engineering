import React, { useState, useCallback, useEffect } from 'react';
import axios from 'axios';
import OntologyGraph from './Graph/OntologyGraph/OntologyGraph';
import DataGraph from './Graph/DataGraph/DataGraph';
import SearchView from './SearchView';

type ViewType = 'ontology' | 'data' | 'search';

export default function ExploreView() {
    const [activeView, setActiveView] = useState<ViewType>('search');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isAgentProcessing, setIsAgentProcessing] = useState(false);
    const [isAgentEvaluating, setIsAgentEvaluating] = useState(false);
    const [processingProgress, setProcessingProgress] = useState({ total: 0, completed: 0 });
    const [evaluationProgress, setEvaluationProgress] = useState({ total: 0, completed: 0 });
    const [acceptanceThreshold, setAcceptanceThreshold] = useState<number>(0.75);
    const [rejectionThreshold, setRejectionThreshold] = useState<number>(0.3);
    const [exploreEntityData, setExploreEntityData] = useState<{entityType: string, primaryKey: string} | null>(null);
    const [graphRagEnabled, setGraphRagEnabled] = useState<boolean>(true);

    const fetchConfig = useCallback(async () => {
        try {
            const response = await axios.get('/healthz');
            const { config } = response.data;
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

    const fetchAgentStatus = useCallback(async () => {
        // BUG FIX: Only fetch agent status if Graph RAG is enabled
        //
        // Previously, this code unconditionally polled the ontology agent status endpoint
        // every 5 seconds, even when Graph RAG was disabled (ENABLE_GRAPH_RAG=false).
        //
        // This caused:
        // - Continuous 404 errors in browser console (endpoint doesn't exist when Graph RAG is off)
        // - Unnecessary network traffic and server load
        // - Confusing error messages for users running without Graph RAG
        //
        // Now we check graphRagEnabled before making the request, preventing these issues.
        if (!graphRagEnabled) {
            return;
        }

        try {
            const response = await axios.get('/v1/graph/ontology/agent/status');
            const {
                is_processing,
                is_evaluating,
                processing_tasks_total,
                processed_tasks_count,
                evaluation_tasks_total,
                evaluated_tasks_count,
                candidate_acceptance_threshold,
                candidate_rejection_threshold
            } = response.data;
            setIsAgentProcessing(is_processing);
            setIsAgentEvaluating(is_evaluating);
            setProcessingProgress({ total: processing_tasks_total, completed: processed_tasks_count });
            setEvaluationProgress({ total: evaluation_tasks_total, completed: evaluated_tasks_count });
            setAcceptanceThreshold(candidate_acceptance_threshold);
            setRejectionThreshold(candidate_rejection_threshold);
        } catch (error) {
            console.error('Failed to fetch agent status:', error);
        }
    }, [graphRagEnabled]);

    const handleRegenerateOntology = async () => {
        setIsLoading(true);
        try {
            await axios.post('/v1/graph/ontology/agent/regenerate_ontology');
            alert('Submitted for regeneration, an agent will look at all the graph data, and regenerate the ontology soon');
            setError(null);
            fetchAgentStatus();
        } catch (error) {
            console.error('Failed to regenerate ontology:', error);
            setError('Failed to regenerate ontology.');
        }
        setIsLoading(false);
    };

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

    // BUG FIX: Set up status polling only when Graph RAG is enabled
    //
    // This useEffect hook controls the periodic polling of the ontology agent status.
    // Previously, the polling happened unconditionally, causing continuous 404 errors
    // when Graph RAG was disabled.
    //
    // Now we check graphRagEnabled and skip setting up the interval if it's false.
    // The dependency array [graphRagEnabled, fetchAgentStatus] ensures that:
    // - Polling starts if Graph RAG is enabled later
    // - Polling stops if Graph RAG is disabled
    useEffect(() => {
        if (!graphRagEnabled) {
            return;  // Skip polling when Graph RAG is disabled
        }

        // Initial status check
        fetchAgentStatus();

        // Set up periodic status checking every 5 seconds
        const statusInterval = setInterval(fetchAgentStatus, 5000);

        return () => {
            clearInterval(statusInterval);
        };
    }, [graphRagEnabled, fetchAgentStatus]);

    const isAgentActive = isAgentProcessing || isAgentEvaluating;

    return (
        <div className="relative h-full bg-slate-100 overflow-hidden">
            {/* --- Agent Status Banner --- */}
            {isAgentActive && (
                <div className="absolute top-0 left-0 right-0 bg-blue-500 text-white px-4 py-2 text-center text-sm font-medium z-30">
                    <div className="flex items-center justify-center gap-4">
                        <span>
                            Agent is currently {isAgentProcessing && isAgentEvaluating ? 'processing and evaluating' :
                                              isAgentProcessing ? 'processing' : 'evaluating'} the ontology...
                        </span>
                        {isAgentProcessing && processingProgress.total > 0 && (
                            <span className="text-blue-100">
                                Processing: {processingProgress.completed}/{processingProgress.total} ({Math.round((processingProgress.completed / processingProgress.total) * 100)}%)
                            </span>
                        )}
                        {isAgentEvaluating && evaluationProgress.total > 0 && (
                            <span className="text-blue-100">
                                Evaluating: {evaluationProgress.completed}/{evaluationProgress.total} ({Math.round((evaluationProgress.completed / evaluationProgress.total) * 100)}%)
                            </span>
                        )}
                    </div>
                </div>
            )}

            {/* --- Tab Navigation --- */}
            <div className={`absolute ${isAgentActive ? 'top-12' : 'top-4'} left-1/2 transform -translate-x-1/2 z-20`}>
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
            <div className={`h-full ${isAgentActive ? 'pt-12' : ''}`}>
                {activeView === 'search' ? (
                    <SearchView onExploreEntity={handleExploreEntity} />
                ) : activeView === 'ontology' ? (
                    <OntologyGraph
                        isAgentProcessing={isAgentProcessing}
                        isAgentEvaluating={isAgentEvaluating}
                        acceptanceThreshold={acceptanceThreshold}
                        rejectionThreshold={rejectionThreshold}
                        onRegenerateOntology={handleRegenerateOntology}
                        isLoading={isLoading}
                        error={error}
                    />
                ) : (
                    <DataGraph
                        isLoading={isLoading}
                        error={error}
                        exploreEntityData={exploreEntityData}
                        onExploreComplete={handleExploreComplete}
                    />
                )}
            </div>
        </div>
    );
}