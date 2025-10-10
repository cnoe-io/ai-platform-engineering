import React, { useState, useMemo } from 'react';
import axios from 'axios';
import type { QueryResult, QueryResponse } from './Models';

const apiBase = import.meta.env.VITE_API_BASE?.toString() || '';

interface SearchViewProps {
    onExploreEntity?: (entityType: string, primaryKey: string) => void;
}

export default function SearchView({ onExploreEntity }: SearchViewProps) {
    // Query state
    const [query, setQuery] = useState('');
    const [limit, setLimit] = useState(3);
    const [similarity, setSimilarity] = useState(0.5);
    const [results, setResults] = useState<QueryResponse | null>(null);
    const [loadingQuery, setLoadingQuery] = useState(false);
    const [expandedDocResults, setExpandedDocResults] = useState<Set<number>>(new Set());
    const [expandedGraphResults, setExpandedGraphResults] = useState<Set<number>>(new Set());

    const api = useMemo(() => axios.create({ baseURL: apiBase || undefined }), []);

    const handleExploreClick = (metadata: Record<string, unknown>) => {
        console.log('Explore clicked', metadata);
        
        // Extract entity information from metadata
        const entityType = metadata.entity_type as string;
        const primaryKey = metadata.entity_primary_key as string;
        
        if (entityType && primaryKey) {
            if (onExploreEntity) {
                onExploreEntity(entityType, primaryKey);
            } else {
                console.log('Entity exploration:', { entityType, primaryKey });
                alert(`Entity exploration: ${entityType} - ${primaryKey}`);
            }
        } else {
            console.warn('Missing entity_type or primary_key in metadata:', metadata);
            alert('Cannot explore: Missing entity information in metadata');
        }
    };

    const toggleDocResult = (index: number) => {
        setExpandedDocResults(prev => {
            const newSet = new Set(prev);
            if (newSet.has(index)) {
                newSet.delete(index);
            } else {
                newSet.add(index);
            }
            return newSet;
        });
    };

    const toggleGraphResult = (index: number) => {
        setExpandedGraphResults(prev => {
            const newSet = new Set(prev);
            if (newSet.has(index)) {
                newSet.delete(index);
            } else {
                newSet.add(index);
            }
            return newSet;
        });
    };

    const handleQuery = async () => {
        if (!query) return;
        setLoadingQuery(true);
        try {
            const { data } = await api.post<QueryResponse>('/v1/query', {
                query,
                limit,
                similarity_threshold: similarity,
            });
            setResults(data);
        } catch (e: any) {
            alert(`Query failed: ${e?.message || 'unknown error'}`);
        } finally {
            setLoadingQuery(false);
        }
    };

    return (
        <div className="h-full bg-slate-100 p-6 pt-20">
            <div className="max-w-4xl mx-auto">
                <div className="text-center mb-8">
                    <div className="text-4xl mb-4">🔍</div>
                    <h1 className="text-3xl font-bold text-gray-800 mb-2">Search</h1>
                    <p className="text-gray-600">
                        Search and explore your knowledge base
                    </p>
                </div>
                
                {/* Search Interface */}
                <div className="bg-white rounded-lg shadow-md p-6 mb-6">
                    <div className="flex gap-4 mb-4">
                        <input
                            type="text"
                            placeholder="Search vector database"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            className="flex-1 px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            onKeyPress={(e) => e.key === 'Enter' && handleQuery()}
                        />
                        <button 
                            onClick={handleQuery} 
                            disabled={!query || loadingQuery}
                            className="px-6 py-2 bg-brand-600 text-white rounded-md hover:bg-brand-700 transition-colors disabled:bg-gray-400"
                        >
                            {loadingQuery ? 'Searching…' : 'Search'}
                        </button>
                    </div>
                    
                    {/* Search Options */}
                    <div className="flex items-center gap-6 text-sm">
                        <label>
                            Similarity:
                            <input
                                type="number"
                                min={0.1}
                                max={1.0}
                                step={0.1}
                                value={similarity}
                                onChange={(e) => setSimilarity(parseFloat(e.target.value))}
                                className="ml-2 w-20 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                            />
                        </label>
                        <label>
                            Limit:
                            <input
                                type="number"
                                min={1}
                                max={100}
                                value={limit}
                                onChange={(e) => setLimit(parseInt(e.target.value, 10))}
                                className="ml-2 w-28 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                            />
                        </label>
                    </div>
                </div>
                
                {/* Results Section */}
                <div className="bg-white rounded-lg shadow-md p-6">
                    <h3 className="text-lg font-semibold mb-4">Search Results</h3>
                    {!results && (
                        <div className="text-center py-12 text-gray-500">
                            <div className="text-4xl mb-2">📝</div>
                            <p>Enter a search query to see results</p>
                        </div>
                    )}
                    {results && (
                        <div>
                            <div className="mb-3 text-sm text-slate-600">Query: {results.query}</div>
                            <ul className="grid list-none gap-3 p-0 mr-2 max-w-full">

                            {/* Document Results (white tinted) */}
                            {results.results_docs.map((r, i) => {
                                const isExpanded = expandedDocResults.has(i);
                                const pageContent = String(r.document.page_content || '');
                                const summary = pageContent.replace(/\n/g, ' ').substring(0, 150);

                                return (
                                    <li key={i} className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm cursor-pointer mr-2 max-w-full overflow-hidden" onClick={() => toggleDocResult(i)}>
                                        {isExpanded ? (
                                            <pre className="m-0 whitespace-pre-wrap text-sm leading-relaxed break-words">{pageContent}</pre>
                                        ) : (
                                            <div className="flex items-center gap-2 min-w-0">
                                                <p className="m-0 flex-1 truncate text-sm leading-relaxed min-w-0">{summary}...</p>
                                                <span className="text-xs font-mono text-slate-500 flex-shrink-0">{r.score.toFixed(3)}</span>
                                            </div>
                                        )}
                                        {isExpanded && r.document.metadata && (
                                            <details className="mt-2" onClick={(e) => e.stopPropagation()}>
                                                <summary className="cursor-pointer select-none text-sm text-slate-700">Metadata</summary>
                                                <pre className="whitespace-pre-wrap text-xs text-slate-600">{JSON.stringify(r.document.metadata, null, 2)}</pre>
                                            </details>
                                        )}
                                    </li>
                                );
                            })}

                            {/* Graph Entity Results (blue tinted) */}
                            {results.results_graph.map((r, i) => {
                                const isExpanded = expandedGraphResults.has(i);
                                const pageContent = String(r.document.page_content || '');
                                const entityType = r.document.metadata?.entity_type as string || 'Unknown';
                                const primaryKey = r.document.metadata?.entity_primary_key as string || 'Unknown';

                                return (
                                    <li key={i} className="rounded-lg border border-blue-200 bg-blue-50 p-3 shadow-sm cursor-pointer mr-2 max-w-full overflow-hidden" onClick={() => toggleGraphResult(i)}>
                                        {isExpanded ? (
                                            <pre className="m-0 whitespace-pre-wrap text-sm leading-relaxed break-words">{pageContent}</pre>
                                        ) : (
                                            <div className="flex items-center gap-2 min-w-0">
                                                <p className="m-0 flex-1 truncate text-sm leading-relaxed min-w-0">
                                                    🔌 <strong>{entityType}</strong>: {primaryKey}
                                                </p>
                                                <div className="flex items-center gap-2 flex-shrink-0">
                                                    <span className="text-xs font-mono text-blue-500">{r.score.toFixed(3)}</span>
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleExploreClick(r.document.metadata!)
                                                        }}
                                                        className="px-2 py-1 bg-blue-500 text-white rounded text-xs hover:bg-blue-600 transition-colors">
                                                        Explore
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                        {isExpanded && r.document.metadata && (
                                            <div className="flex justify-between items-start mt-2">
                                            <details className="flex-grow" onClick={(e) => e.stopPropagation()}>
                                                <summary className="cursor-pointer select-none text-sm text-slate-700">Metadata</summary>
                                                <pre className="whitespace-pre-wrap text-xs text-slate-600">{JSON.stringify(r.document.metadata, null, 2)}</pre>
                                            </details>
                                        </div>
                                        )}
                                    </li>
                                );
                            })}
                        </ul>
                    </div>
                )}
                </div>
            </div>
        </div>
    );
}