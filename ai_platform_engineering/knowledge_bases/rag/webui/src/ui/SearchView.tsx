import React, { useState, useMemo } from 'react';
import type { QueryResult } from './Models';
import { searchDocuments, getHealthStatus } from '../api';

interface SearchViewProps {
    onExploreEntity?: (entityType: string, primaryKey: string) => void;
}

export default function SearchView({ onExploreEntity }: SearchViewProps) {
    // Query state - matching QueryRequest model
    const [query, setQuery] = useState('');
    const [limit, setLimit] = useState(5);
    const [similarity, setSimilarity] = useState(0.3);
    const [filters, setFilters] = useState<Record<string, string>>({});
    const [rankerType] = useState('weighted'); // Only weighted ranker supported
    const [semanticsWeight, setSemanticsWeight] = useState(0.7); // Slider for weights
    const [results, setResults] = useState<QueryResult[] | null>(null);
    const [loadingQuery, setLoadingQuery] = useState(false);
    const [lastQuery, setLastQuery] = useState('');
    const [expandedResults, setExpandedResults] = useState<Set<number>>(new Set());
    
    // Filter configuration
    const [validFilterKeys, setValidFilterKeys] = useState<string[]>([]);
    const [supportedDocTypes, setSupportedDocTypes] = useState<string[]>([]);
    const [selectedFilterKey, setSelectedFilterKey] = useState('');
    const [filterValue, setFilterValue] = useState('');
    const [isGraphEntityFilter, setIsGraphEntityFilter] = useState<'all' | 'true' | 'false'>('all'); // 'all' = not set, 'true'/'false' = filter value



    // Fetch valid filter keys and supported doc types on component mount
    React.useEffect(() => {
        const fetchFilterConfig = async () => {
            try {
                const response = await getHealthStatus();
                const filterKeys = response?.config?.search?.keys || [];
                const docTypes = response?.config?.search?.supported_doc_types || [];
                setValidFilterKeys(filterKeys);
                setSupportedDocTypes(docTypes);
            } catch (error) {
                console.error('Failed to fetch filter configuration:', error);
            }
        };
        fetchFilterConfig();
    }, []);

    // Filter management functions
    const addFilter = () => {
        if (selectedFilterKey && filterValue.trim()) {
            setFilters(prev => ({
                ...prev,
                [selectedFilterKey]: filterValue.trim()
            }));
            setSelectedFilterKey('');
            setFilterValue('');
        }
    };

    const removeFilter = (key: string) => {
        setFilters(prev => {
            const newFilters = { ...prev };
            delete newFilters[key];
            return newFilters;
        });
    };

    const handleExploreClick = (metadata: Record<string, unknown>) => {
        console.log('Explore clicked', metadata);
        
        // Extract entity information from metadata - using the correct keys
        const nestedMetadata = metadata?.metadata as Record<string, unknown> | undefined;
        const entityType = nestedMetadata?.graph_entity_type as string || undefined;
        const primaryKey = nestedMetadata?.graph_entity_pk as string || undefined;
        
        if (entityType && primaryKey) {
            if (onExploreEntity) {
                onExploreEntity(entityType, primaryKey);
            } else {
                console.log('Entity exploration:', { entityType, primaryKey });
                alert(`Entity exploration: ${entityType} - ${primaryKey}`);
            }
        } else {
            console.warn('Missing entity_type or primary_key in metadata:', metadata);
            console.warn('Available keys:', Object.keys(metadata));
            alert('Cannot explore: Missing entity information in metadata');
        }
    };

    const toggleResult = (index: number) => {
        setExpandedResults(prev => {
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
            // Calculate text search weight (complement of semantics weight)
            const textWeight = 1 - semanticsWeight;
            const weights = [semanticsWeight, textWeight];

            // Build filters - combine regular filters with is_graph_entity radio button
            const combinedFilters: Record<string, string | boolean> = { ...filters };
            if (isGraphEntityFilter !== 'all') {
                combinedFilters['is_graph_entity'] = isGraphEntityFilter === 'true'; // boolean true or false
            }

            const data = await searchDocuments({
                query,
                limit,
                similarity_threshold: similarity,
                filters: Object.keys(combinedFilters).length > 0 ? combinedFilters : undefined,
                ranker_type: rankerType,
                ranker_params: { weights }
            });
            setResults(data);
            setLastQuery(query);
        } catch (e: any) {
            alert(`Query failed: ${e?.message || 'unknown error'}`);
        } finally {
            setLoadingQuery(false);
        }
    };

    return (
        <div className="h-full bg-slate-100 p-6 pt-20">
            <style>{`
                .slider::-webkit-slider-thumb {
                    appearance: none;
                    height: 20px;
                    width: 20px;
                    border-radius: 50%;
                    cursor: pointer;
                    border: 2px solid white;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.2);
                }
                .slider::-moz-range-thumb {
                    height: 20px;
                    width: 20px;
                    border-radius: 50%;
                    cursor: pointer;
                    border: 2px solid white;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.2);
                }
            `}</style>
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
                            className="px-6 py-2 btn bg-brand-gradient hover:bg-brand-gradient-hover active:bg-brand-gradient-active text-white rounded-md transition-colors disabled:bg-gray-400"
                        >
                            {loadingQuery ? 'Searching…' : 'Search'}
                        </button>
                    </div>
                    
                    {/* Advanced Options */}
                    <details className="mb-4 rounded-lg bg-slate-50 p-4">
                        <summary className="cursor-pointer text-sm font-semibold text-slate-700">Advanced Options</summary>

                        {/* Search Options */}
                        <div className="space-y-4 text-sm">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <label>
                                    Similarity Threshold:
                                    <input
                                        type="number"
                                        min={0.0}
                                        max={1.0}
                                        step={0.1}
                                        value={similarity}
                                        onChange={(e) => setSimilarity(parseFloat(e.target.value))}
                                        className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                                    />
                                </label>
                                <label>
                                    Result Limit:
                                    <input
                                        type="number"
                                        min={1}
                                        max={100}
                                        value={limit}
                                        onChange={(e) => setLimit(parseInt(e.target.value, 10))}
                                        className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                                    />
                                </label>
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-2">Search Weight Balance</label>
                                <div className="relative">
                                    <div className="flex bg-gray-200 rounded-full h-5 overflow-hidden">
                                        <div 
                                            className="bg-brand-600 flex items-center justify-center text-xs text-white font-medium transition-all duration-15"
                                            style={{ width: `${semanticsWeight * 100}%` }}
                                        >
                                            {semanticsWeight > 0.15 && `Semantic (${(semanticsWeight * 100).toFixed(0)}%)`}
                                        </div>
                                        <div 
                                            className="flex items-center justify-center text-xs text-white font-medium transition-all duration-15"
                                            style={{ width: `${(1 - semanticsWeight) * 100}%`, backgroundColor: '#00C799' }}
                                        >
                                            {(1 - semanticsWeight) > 0.15 && `Keyword (${((1 - semanticsWeight) * 100).toFixed(0)}%)`}
                                        </div>
                                    </div>
                                    <input
                                        type="range"
                                        min={0}
                                        max={1}
                                        step={0.05}
                                        value={semanticsWeight}
                                        onChange={(e) => setSemanticsWeight(parseFloat(e.target.value))}
                                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                    />
                                </div>
                                <span className="text-xs text-gray-500 italic mt-1 block">(Slide to change)</span>
                            </div>
                        </div>
                         {/* Filters Section */}
                        <div className="mt-4 mb-4 p-4 border border-gray-200 rounded-md bg-gray-50">
                            <h4 className="text-sm font-semibold mb-3">Filters</h4>
                            
                            {/* Graph Entity Radio Filter */}
                            <div className="mb-4 p-3 bg-white border border-gray-200 rounded-md">
                                <div className="text-sm font-medium mb-2">Entity Type</div>
                                <div className="flex gap-4">
                                    <label className="flex items-center gap-1 text-sm cursor-pointer">
                                        <input
                                            type="radio"
                                            name="graph-entity-filter"
                                            checked={isGraphEntityFilter === 'all'}
                                            onChange={() => setIsGraphEntityFilter('all')}
                                            className="h-4 w-4"
                                        />
                                        <span>All</span>
                                    </label>
                                    <label className="flex items-center gap-1 text-sm cursor-pointer">
                                        <input
                                            type="radio"
                                            name="graph-entity-filter"
                                            checked={isGraphEntityFilter === 'true'}
                                            onChange={() => setIsGraphEntityFilter('true')}
                                            className="h-4 w-4"
                                        />
                                        <span>Graph entities only</span>
                                    </label>
                                    <label className="flex items-center gap-1 text-sm cursor-pointer">
                                        <input
                                            type="radio"
                                            name="graph-entity-filter"
                                            checked={isGraphEntityFilter === 'false'}
                                            onChange={() => setIsGraphEntityFilter('false')}
                                            className="h-4 w-4"
                                        />
                                        <span>Non-graph entities</span>
                                    </label>
                                </div>
                            </div>
                            
                            {/* Add Filter Controls */}
                            <div className="flex gap-2 mb-3">
                                <select
                                    value={selectedFilterKey}
                                    onChange={(e) => setSelectedFilterKey(e.target.value)}
                                    className="rounded-md border border-slate-300 bg-white px-3 py-1 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                                >
                                    <option value="">Select filter key...</option>
                                    {validFilterKeys.filter(key => key !== 'is_graph_entity').map(key => (
                                        <option key={key} value={key}>{key}</option>
                                    ))}
                                </select>
                                <input
                                    type="text"
                                    placeholder="Filter value"
                                    value={filterValue}
                                    onChange={(e) => setFilterValue(e.target.value)}
                                    className="flex-1 rounded-md border border-slate-300 bg-white px-3 py-1 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                                    onKeyDown={(e) => e.key === 'Enter' && addFilter()}
                                />
                                <button
                                    onClick={addFilter}
                                    disabled={!selectedFilterKey || !filterValue.trim()}
                                    className="px-3 py-1 bg-brand-600 text-white rounded-md text-sm hover:bg-brand-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
                                >
                                    Add
                                </button>
                            </div>
                            
                            {/* Hint for doc_type filter */}
                            {selectedFilterKey === 'doc_type' && supportedDocTypes.length > 0 && (
                                <div className="mb-3 p-2 bg-blue-50 border border-blue-200 rounded-md">
                                    <p className="text-xs text-blue-700">
                                        <strong>Hint:</strong> Supported values: {supportedDocTypes.join(', ')}
                                    </p>
                                </div>
                            )}

                            {/* Active Filters */}
                            {Object.keys(filters).length > 0 && (
                                <div className="flex flex-wrap gap-2">
                                    {Object.entries(filters).map(([key, value]) => (
                                        <span
                                            key={key}
                                            className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-800 rounded-md text-xs"
                                        >
                                            {key}: {value}
                                            <button
                                                onClick={() => removeFilter(key)}
                                                className="text-blue-600 hover:text-blue-800"
                                            >
                                                ×
                                            </button>
                                        </span>
                                    ))}
                                </div>
                            )}
                        </div>
                    </details>
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
                            <div className="mb-3 text-sm text-slate-600">Query: {lastQuery}</div>
                            <ul className="grid list-none gap-3 p-0 mr-2 max-w-full">
                            {results.map((r, i) => {
                                const isExpanded = expandedResults.has(i);
                                const pageContent = String(r.document.page_content || '');
                                const summary = pageContent.replace(/\n/g, ' ').substring(0, 150);
                                const isGraphEntity = r.document.metadata?.is_graph_entity as boolean;
                                
                                // For graph entities, extract entity info
                                const nestedMetadata = r.document.metadata?.metadata as Record<string, unknown> | undefined;
                                const entityType = nestedMetadata?.graph_entity_type as string || 'Unknown';
                                const primaryKey = nestedMetadata?.graph_entity_pk as string || 'Unknown';

                                return (
                                    <li 
                                        key={i} 
                                        className={`rounded-lg p-3 shadow-sm cursor-pointer mr-2 max-w-full overflow-hidden border border-slate-200 bg-white`}
                                        onClick={() => toggleResult(i)}
                                    >
                                        {isExpanded ? (
                                            <pre className="m-0 whitespace-pre-wrap text-sm leading-relaxed break-words">{pageContent}</pre>
                                        ) : (
                                            <div className="flex items-center gap-2 min-w-0">
                                                {isGraphEntity ? (
                                                    <p className="m-0 flex-1 truncate text-sm leading-relaxed min-w-0">
                                                        🔌 <strong>{entityType}</strong>: {primaryKey}
                                                    </p>
                                                ) : (
                                                    <p className="m-0 flex-1 truncate text-sm leading-relaxed min-w-0">{summary}...</p>
                                                )}
                                                <div className="flex items-center gap-2 flex-shrink-0">
                                                    <span className={`text-xs font-mono flex-shrink-0 ${
                                                        isGraphEntity ? 'text-brand-500' : 'text-slate-500'
                                                    }`}>
                                                        {r.score.toFixed(3)}
                                                    </span>
                                                    {isGraphEntity && (
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                handleExploreClick(r.document.metadata!)
                                                            }}
                                                            className="px-2 py-1 btn text-white rounded text-xs hover:bg-brand-400 transition-colors"
                                                        >
                                                            Explore
                                                        </button>
                                                    )}
                                                </div>
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
                        </ul>
                    </div>
                )}
                </div>
            </div>
        </div>
    );
}