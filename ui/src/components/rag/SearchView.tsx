"use client";

/**
 * SearchView - Ported directly from RAG WebUI with minimal changes
 *
 * Changes from original:
 * - Added "use client" directive for Next.js
 * - Changed import paths for local modules
 * - Changed onKeyPress to onKeyDown (React 19 compat)
 * - Redesigned to have centered search bar like a search engine
 */

import React, { useState, useEffect } from 'react';
import { Search, SlidersHorizontal, X, ExternalLink, Database, ArrowRight } from 'lucide-react';
import type { QueryResult } from './Models';
import { searchDocuments, getHealthStatus, getDataSources } from './api';
import { motion, AnimatePresence } from 'framer-motion';
import { getColorForType } from './graph/shared/graphStyles';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Helper to check if a string is a valid URL
function isValidUrl(str: string): boolean {
    try {
        const url = new URL(str);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
        return false;
    }
}

// Helper to get a display-friendly version of a URL (max ~35 chars)
function getUrlDisplayName(url: string, maxLength: number = 35): string {
    try {
        const parsed = new URL(url);
        let displayName: string;
        
        // For GitHub repos (github.com/owner/repo)
        if (parsed.hostname === 'github.com') {
            const parts = parsed.pathname.split('/').filter(Boolean);
            if (parts.length >= 2) {
                displayName = `${parts[0]}/${parts[1]}`;
            } else {
                displayName = parsed.pathname.substring(1) || 'github.com';
            }
        }
        // For GitHub Pages (*.github.io)
        else if (parsed.hostname.endsWith('.github.io')) {
            // e.g., cnoe-io.github.io -> cnoe-io docs
            const org = parsed.hostname.replace('.github.io', '');
            const pathPart = parsed.pathname.split('/').filter(Boolean)[0] || '';
            displayName = pathPart ? `${org}/${pathPart}/...` : org;
        }
        // Confluence/Atlassian - show page title from path
        else if (parsed.hostname.includes('confluence') || parsed.hostname.includes('atlassian')) {
            displayName = parsed.pathname.split('/').pop() || parsed.hostname;
        }
        // Default: show just hostname
        else {
            displayName = parsed.hostname + '/...';
        }
        
        // Truncate if still too long
        if (displayName.length > maxLength) {
            return displayName.substring(0, maxLength - 3) + '...';
        }
        return displayName;
    } catch {
        // Fallback for invalid URLs
        if (url.length > maxLength) {
            return url.substring(0, maxLength - 3) + '...';
        }
        return url;
    }
}

// Helper function to highlight query terms in text
function highlightQueryTerms(text: string, query: string): React.ReactNode[] {
    if (!query.trim()) return [text];
    
    // Split query into individual words, filter out empty strings
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return [text];
    
    // Create a regex pattern that matches any of the terms (case-insensitive)
    const pattern = new RegExp(`(${terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
    
    // Split text by the pattern, keeping the matched parts
    const parts = text.split(pattern);
    
    return parts.map((part, i) => {
        // Check if this part matches any term
        const isMatch = terms.some(term => part.toLowerCase() === term.toLowerCase());
        if (isMatch) {
            return (
                <mark key={i} className="bg-yellow-200/50 dark:bg-yellow-500/30 rounded px-0.5">
                    {part}
                </mark>
            );
        }
        return part;
    });
}

// Fast animation transition
const fastTransition = { duration: 0.1 };

interface SearchViewProps {
    onExploreEntity?: (entityType: string, primaryKey: string) => void;
    onNavigateToDataSources?: () => void;
}

export default function SearchView({ onExploreEntity, onNavigateToDataSources }: SearchViewProps) {
    // Query state - matching QueryRequest model
    const [query, setQuery] = useState('');
    const [limit, setLimit] = useState(10);
    const [filters, setFilters] = useState<Record<string, string>>({});
    const [rankerType] = useState('weighted'); // Only weighted ranker supported
    const [semanticsWeight, setSemanticsWeight] = useState(0.5); // Slider for weights
    const [results, setResults] = useState<QueryResult[] | null>(null);
    const [loadingQuery, setLoadingQuery] = useState(false);
    const [lastQuery, setLastQuery] = useState('');
    const [expandedResults, setExpandedResults] = useState<Set<number>>(new Set());
    const [showAdvanced, setShowAdvanced] = useState(false);

    // Filter configuration
    const [validFilterKeys, setValidFilterKeys] = useState<string[]>([]);
    const [supportedDocTypes, setSupportedDocTypes] = useState<string[]>([]);
    const [selectedFilterKey, setSelectedFilterKey] = useState('');
    const [filterValue, setFilterValue] = useState('');
    const [isGraphEntityFilter, setIsGraphEntityFilter] = useState<'all' | 'true' | 'false'>('all');

    // Graph RAG configuration
    const [graphRagEnabled, setGraphRagEnabled] = useState<boolean>(true);

    // Data sources count for empty state
    const [dataSourcesCount, setDataSourcesCount] = useState<number | null>(null);

    // Fetch valid filter keys and supported doc types on component mount
    useEffect(() => {
        const fetchFilterConfig = async () => {
            try {
                const response = await getHealthStatus();
                const filterKeys = response?.config?.search?.keys || [];
                const docTypes = response?.config?.search?.supported_doc_types || [];
                const graphRagEnabled = response?.config?.graph_rag_enabled ?? true;
                setValidFilterKeys(filterKeys);
                setSupportedDocTypes(docTypes);
                setGraphRagEnabled(graphRagEnabled);
            } catch (error) {
                console.error('Failed to fetch filter configuration:', error);
            }
        };
        fetchFilterConfig();
    }, []);

    // Fetch data sources count to show empty state suggestion
    useEffect(() => {
        const fetchDataSourcesCount = async () => {
            try {
                const response = await getDataSources();
                setDataSourcesCount(response.datasources?.length ?? 0);
            } catch (error) {
                console.error('Failed to fetch data sources:', error);
                setDataSourcesCount(0);
            }
        };
        fetchDataSourcesCount();
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
            const textWeight = 1 - semanticsWeight;
            const weights = [semanticsWeight, textWeight];

            const combinedFilters: Record<string, string | boolean> = { ...filters };
            if (isGraphEntityFilter !== 'all') {
                combinedFilters['is_graph_entity'] = isGraphEntityFilter === 'true';
            }

            const data = await searchDocuments({
                query,
                limit,
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

    const clearResults = () => {
        setResults(null);
        setLastQuery('');
        setQuery('');
    };

    const hasResults = results !== null;

    // Advanced options panel (shared between both views)
    const advancedOptionsContent = (
        <div className="p-4 rounded-xl bg-card border border-border shadow-sm">
            <div className="space-y-4 text-sm">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <label className="text-foreground">
                        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Result Limit</span>
                        <input
                            type="number"
                            min={1}
                            max={100}
                            value={limit}
                            onChange={(e) => setLimit(parseInt(e.target.value, 10))}
                            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 text-foreground"
                        />
                    </label>
                    <div>
                        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Entity Type</span>
                        <div className="flex gap-2 mt-1">
                            {(['all', 'true', 'false'] as const).map((value) => (
                                <button
                                    key={value}
                                    onClick={() => setIsGraphEntityFilter(value)}
                                    className={`flex-1 px-3 py-2 text-xs rounded-md border transition-colors ${
                                        isGraphEntityFilter === value
                                            ? 'bg-primary text-primary-foreground border-primary'
                                            : 'bg-background text-foreground border-border hover:bg-muted'
                                    }`}
                                >
                                    {value === 'all' ? 'All' : value === 'true' ? 'Graph' : 'Non-graph'}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                <div>
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Search Weight Balance</span>
                    <div className="mt-2 relative">
                        <div className="flex bg-muted rounded-full h-6 overflow-hidden">
                            <div
                                className="bg-primary flex items-center justify-center text-xs text-primary-foreground font-medium transition-all duration-150"
                                style={{ width: `${semanticsWeight * 100}%` }}
                            >
                                {semanticsWeight > 0.2 && `Semantic ${(semanticsWeight * 100).toFixed(0)}%`}
                            </div>
                            <div
                                className="flex items-center justify-center text-xs text-white font-medium transition-all duration-150"
                                style={{ width: `${(1 - semanticsWeight) * 100}%`, backgroundColor: '#00C799' }}
                            >
                                {(1 - semanticsWeight) > 0.2 && `Keyword ${((1 - semanticsWeight) * 100).toFixed(0)}%`}
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
                </div>

                {/* Filters */}
                <div>
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Filters</span>
                    <div className="flex gap-2 mt-2">
                        <select
                            value={selectedFilterKey}
                            onChange={(e) => setSelectedFilterKey(e.target.value)}
                            className="rounded-md border border-border bg-background px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 text-foreground"
                        >
                            <option value="">Select filter...</option>
                            {validFilterKeys.filter(key => key !== 'is_graph_entity').map(key => (
                                <option key={key} value={key}>{key}</option>
                            ))}
                        </select>
                        <input
                            type="text"
                            placeholder="Value"
                            value={filterValue}
                            onChange={(e) => setFilterValue(e.target.value)}
                            className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 text-foreground"
                            onKeyDown={(e) => e.key === 'Enter' && addFilter()}
                        />
                        <button
                            onClick={addFilter}
                            disabled={!selectedFilterKey || !filterValue.trim()}
                            className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed"
                        >
                            Add
                        </button>
                    </div>
                    {selectedFilterKey === 'doc_type' && supportedDocTypes.length > 0 && (
                        <p className="text-xs text-primary mt-2">
                            Supported: {supportedDocTypes.join(', ')}
                        </p>
                    )}
                    {Object.keys(filters).length > 0 && (
                        <div className="flex flex-wrap gap-2 mt-2">
                            {Object.entries(filters).map(([key, value]) => (
                                <span
                                    key={key}
                                    className="inline-flex items-center gap-1 px-2 py-1 bg-primary/10 text-primary rounded-full text-xs"
                                >
                                    {key}: {value}
                                    <button onClick={() => removeFilter(key)} className="hover:text-primary/80">
                                        <X className="h-3 w-3" />
                                    </button>
                                </span>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );

    return (
        <div className="h-full flex flex-col bg-background">
            <AnimatePresence mode="wait">
                {!hasResults ? (
                    // Centered search state (like Google homepage)
                    <motion.div
                        key="centered"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={fastTransition}
                        className="h-full flex flex-col items-center pt-[18vh] px-6 py-8"
                    >
                        {/* Logo/Title */}
                        <div className="mb-8 text-center">
                            <div className="inline-flex p-4 rounded-2xl gradient-primary-br shadow-lg shadow-primary/20 mb-4">
                                <Search className="h-10 w-10 text-white" />
                            </div>
                            <h1 className="text-3xl font-bold gradient-text mb-2">Knowledge Search</h1>
                            <p className="text-muted-foreground">Search and explore your knowledge base</p>
                        </div>

                        {/* Search Input - Inlined to prevent focus loss */}
                        <div className="flex gap-2 w-full max-w-2xl">
                            <div className="relative flex-1">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                <input
                                    type="text"
                                    placeholder="Search your knowledge base..."
                                    value={query}
                                    onChange={(e) => setQuery(e.target.value)}
                                    className="w-full pl-10 pr-4 py-3 border border-border rounded-full focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent bg-background text-foreground shadow-sm"
                                    onKeyDown={(e) => e.key === 'Enter' && handleQuery()}
                                />
                            </div>
                            <button
                                onClick={handleQuery}
                                disabled={!query || loadingQuery}
                                className="px-6 py-3 bg-primary hover:bg-primary/90 text-primary-foreground rounded-full transition-colors disabled:bg-muted disabled:text-muted-foreground font-medium shadow-sm"
                            >
                                {loadingQuery ? 'Searching…' : 'Search'}
                            </button>
                            <button
                                onClick={() => setShowAdvanced(!showAdvanced)}
                                className={`p-3 rounded-full border border-border hover:bg-muted transition-colors ${showAdvanced ? 'bg-muted' : 'bg-background'}`}
                                title="Advanced options"
                            >
                                <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
                            </button>
                        </div>

                        {/* Advanced Options */}
                        <AnimatePresence>
                            {showAdvanced && (
                                <motion.div
                                    initial={{ opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: 'auto' }}
                                    exit={{ opacity: 0, height: 0 }}
                                    transition={fastTransition}
                                    className="overflow-hidden w-full max-w-2xl mt-4"
                                >
                                    {advancedOptionsContent}
                                </motion.div>
                            )}
                        </AnimatePresence>

                        {/* Quick tips */}
                        <div className="mt-8 text-center text-sm text-muted-foreground">
                            <p>Press <kbd className="px-2 py-0.5 rounded bg-muted border border-border text-xs">Enter</kbd> to search</p>
                        </div>

                        {/* Empty data sources suggestion */}
                        {dataSourcesCount === 0 && (
                            <motion.div
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.2 }}
                                className="mt-6 p-4 rounded-xl bg-primary/5 border border-primary/20 max-w-lg text-center"
                            >
                                <div className="flex items-center justify-center gap-2 mb-2">
                                    <Database className="h-5 w-5 text-primary" />
                                    <span className="font-medium text-foreground">No data sources yet</span>
                                </div>
                                <p className="text-sm text-muted-foreground mb-3">
                                    To search your knowledge base, you need to ingest some data sources first.
                                </p>
                                {onNavigateToDataSources && (
                                    <button
                                        onClick={onNavigateToDataSources}
                                        className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-full text-sm font-medium hover:bg-primary/90 transition-colors"
                                    >
                                        Add Data Sources
                                        <ArrowRight className="h-4 w-4" />
                                    </button>
                                )}
                            </motion.div>
                        )}
                    </motion.div>
                ) : (
                    // Results state (search bar at top)
                    <motion.div
                        key="results"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={fastTransition}
                        className="h-full flex flex-col"
                    >
                        {/* Top search bar */}
                        <div className="shrink-0 border-b border-border bg-card/50 backdrop-blur-sm px-6 py-3">
                            <div className="max-w-4xl mx-auto flex items-center gap-4">
                                <button
                                    onClick={clearResults}
                                    className="p-2 rounded-lg gradient-primary-br shadow-sm"
                                >
                                    <Search className="h-5 w-5 text-white" />
                                </button>
                                {/* Compact search input - Inlined */}
                                <div className="flex-1 flex gap-2">
                                    <div className="relative flex-1">
                                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                        <input
                                            type="text"
                                            placeholder="Search your knowledge base..."
                                            value={query}
                                            onChange={(e) => setQuery(e.target.value)}
                                            className="w-full pl-10 pr-10 py-2 text-sm border border-border rounded-full focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent bg-background text-foreground shadow-sm"
                                            onKeyDown={(e) => e.key === 'Enter' && handleQuery()}
                                        />
                                        <button
                                            onClick={clearResults}
                                            className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded-full hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                                            title="Clear results"
                                        >
                                            <X className="h-4 w-4" />
                                        </button>
                                    </div>
                                    <button
                                        onClick={handleQuery}
                                        disabled={!query || loadingQuery}
                                        className="px-4 py-2 text-sm bg-primary hover:bg-primary/90 text-primary-foreground rounded-full transition-colors disabled:bg-muted disabled:text-muted-foreground font-medium shadow-sm"
                                    >
                                        {loadingQuery ? 'Searching…' : 'Search'}
                                    </button>
                                </div>
                                <button
                                    onClick={() => setShowAdvanced(!showAdvanced)}
                                    className={`p-2 rounded-lg border border-border hover:bg-muted transition-colors ${showAdvanced ? 'bg-muted' : ''}`}
                                    title="Advanced options"
                                >
                                    <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
                                </button>
                            </div>
                            
                            {/* Inline advanced options */}
                            <AnimatePresence>
                                {showAdvanced && (
                                    <motion.div
                                        initial={{ opacity: 0, height: 0 }}
                                        animate={{ opacity: 1, height: 'auto' }}
                                        exit={{ opacity: 0, height: 0 }}
                                        transition={fastTransition}
                                        className="max-w-4xl mx-auto mt-3 overflow-hidden"
                                    >
                                        {advancedOptionsContent}
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>

                        {/* Results - scrollable area */}
                        <div className="flex-1 overflow-y-auto">
                            <div className="max-w-4xl mx-auto px-6 py-4">
                                <p className="text-sm text-muted-foreground mb-4">
                                    {results.length} results for &quot;{lastQuery}&quot;
                                </p>

                                <div className="space-y-3 pb-8">
                                    {results.map((r, i) => {
                                        const isExpanded = expandedResults.has(i);
                                        const pageContent = String(r.document.page_content || '');
                                        const summary = pageContent.replace(/\n/g, ' ').substring(0, 200);
                                        const isGraphEntity = r.document.metadata?.is_graph_entity as boolean;

                                        const nestedMetadata = r.document.metadata?.metadata as Record<string, unknown> | undefined;
                                        const entityType = nestedMetadata?.graph_entity_type as string || 'Document';
                                        const primaryKey = nestedMetadata?.graph_entity_pk as string || '';
                                        
                                        // Check for source URL in nested metadata (for Document types)
                                        // Source is stored in metadata.metadata.source for web documents
                                        const source = nestedMetadata?.source as string | undefined;
                                        const hasSourceLink = !isGraphEntity && source && isValidUrl(source);
                                        
                                        // Get entity color for the left border
                                        const entityColor = isGraphEntity ? getColorForType(entityType) : '#6b7280';

                                        return (
                                            <div
                                                key={i}
                                                className="rounded-lg overflow-hidden border border-border bg-card hover:bg-muted/30 transition-colors cursor-pointer"
                                                onClick={() => toggleResult(i)}
                                            >
                                                {/* Colored left border indicator */}
                                                <div className="flex min-w-0">
                                                    <div 
                                                        className="w-1 shrink-0" 
                                                        style={{ backgroundColor: entityColor }}
                                                    />
                                                    <div className="flex-1 min-w-0 p-4 overflow-hidden">
                                                        {/* Header row: badge, title/source, score */}
                                                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                                                            <span 
                                                                className="px-2 py-0.5 rounded-full text-xs font-medium text-white shrink-0"
                                                                style={{ backgroundColor: entityColor }}
                                                            >
                                                                {entityType}
                                                            </span>
                                                            {primaryKey ? (
                                                                <span className="text-sm font-medium text-foreground truncate max-w-[300px]">
                                                                    {primaryKey}
                                                                </span>
                                                            ) : hasSourceLink ? (
                                                                <a
                                                                    href={source}
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    onClick={(e) => e.stopPropagation()}
                                                                    className="inline-flex items-center gap-1 text-sm text-primary hover:underline truncate max-w-[300px]"
                                                                >
                                                                    <ExternalLink className="h-3 w-3 shrink-0" />
                                                                    {getUrlDisplayName(source)}
                                                                </a>
                                                            ) : null}
                                                            <span className="ml-auto px-2 py-0.5 rounded bg-muted text-xs font-mono text-muted-foreground shrink-0">
                                                                {r.score.toFixed(3)}
                                                            </span>
                                                            {isGraphEntity && graphRagEnabled && (
                                                                <button
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        handleExploreClick(r.document.metadata!);
                                                                    }}
                                                                    className="px-2.5 py-1 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors shrink-0"
                                                                >
                                                                    Explore
                                                                </button>
                                                            )}
                                                        </div>
                                                        
                                                        {/* Content area */}
                                                        {isExpanded ? (
                                                            <div className="text-sm leading-relaxed text-foreground markdown-content overflow-hidden">
                                                                <ReactMarkdown 
                                                                    remarkPlugins={[remarkGfm]}
                                                                    components={{
                                                                        // Style headings
                                                                        h1: ({children}) => <h1 className="text-lg font-bold mt-4 mb-2">{children}</h1>,
                                                                        h2: ({children}) => <h2 className="text-base font-bold mt-3 mb-2">{children}</h2>,
                                                                        h3: ({children}) => <h3 className="text-sm font-bold mt-2 mb-1">{children}</h3>,
                                                                        // Style paragraphs
                                                                        p: ({children}) => <p className="mb-2">{children}</p>,
                                                                        // Style lists
                                                                        ul: ({children}) => <ul className="list-disc list-inside mb-2 space-y-1">{children}</ul>,
                                                                        ol: ({children}) => <ol className="list-decimal list-inside mb-2 space-y-1">{children}</ol>,
                                                                        li: ({children}) => <li className="text-sm">{children}</li>,
                                                                        // Style code
                                                                        code: ({className, children}) => {
                                                                            const isBlock = className?.includes('language-');
                                                                            return isBlock ? (
                                                                                <code className="block text-xs font-mono whitespace-pre-wrap break-words">
                                                                                    {children}
                                                                                </code>
                                                                            ) : (
                                                                                <code className="px-1 py-0.5 rounded bg-muted text-xs font-mono">
                                                                                    {children}
                                                                                </code>
                                                                            );
                                                                        },
                                                                        pre: ({children}) => (
                                                                            <pre className="my-2 bg-muted p-3 rounded-md overflow-x-auto whitespace-pre-wrap break-words">
                                                                                {children}
                                                                            </pre>
                                                                        ),
                                                                        // Style blockquotes
                                                                        blockquote: ({children}) => (
                                                                            <blockquote className="border-l-2 border-primary pl-3 my-2 text-muted-foreground italic">
                                                                                {children}
                                                                            </blockquote>
                                                                        ),
                                                                        // Style links
                                                                        a: ({href, children}) => (
                                                                            <a 
                                                                                href={href} 
                                                                                target="_blank" 
                                                                                rel="noopener noreferrer"
                                                                                className="text-primary hover:underline"
                                                                                onClick={(e) => e.stopPropagation()}
                                                                            >
                                                                                {children}
                                                                            </a>
                                                                        ),
                                                                        // Style tables
                                                                        table: ({children}) => (
                                                                            <div className="overflow-x-auto my-2">
                                                                                <table className="min-w-full border border-border text-xs">{children}</table>
                                                                            </div>
                                                                        ),
                                                                        th: ({children}) => <th className="border border-border px-2 py-1 bg-muted font-medium">{children}</th>,
                                                                        td: ({children}) => <td className="border border-border px-2 py-1">{children}</td>,
                                                                        // Style horizontal rules
                                                                        hr: () => <hr className="my-3 border-border" />,
                                                                    }}
                                                                >
                                                                    {isGraphEntity ? '```\n' + pageContent + '\n```' : pageContent}
                                                                </ReactMarkdown>
                                                            </div>
                                                        ) : (
                                                            <p className="text-sm text-muted-foreground line-clamp-2">
                                                                {highlightQueryTerms(summary + '...', lastQuery)}
                                                            </p>
                                                        )}

                                                        {/* Metadata section */}
                                                        {isExpanded && r.document.metadata && (
                                                            <details className="mt-3" onClick={(e) => e.stopPropagation()}>
                                                                <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                                                                    View metadata
                                                                </summary>
                                                                <pre className="mt-2 p-2 rounded bg-muted text-xs text-muted-foreground overflow-auto max-h-48">
                                                                    {JSON.stringify(r.document.metadata, null, 2)}
                                                                </pre>
                                                            </details>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
