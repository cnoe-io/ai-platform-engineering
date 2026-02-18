/**
 * RAG API Client - Ported from RAG WebUI
 *
 * This is a direct port of the RAG webui API client, adapted to use
 * fetch through the Next.js API proxy instead of axios.
 *
 * All requests go through /api/rag/* which proxies to the RAG server.
 */

import { DataSourceInfo, IngestorInfo, IngestionJob, QueryResult } from '../Models';

// API configuration - uses Next.js API proxy
const API_BASE = '/api/rag';

// Constants
export const WEBLOADER_INGESTOR_ID = 'webloader:default_webloader';
export const CONFLUENCE_INGESTOR_ID = 'confluence:default_confluence';

// Helper function for API calls (replaces axios)
async function apiGet<T>(endpoint: string, params?: Record<string, string | number>): Promise<T> {
    let url = `${API_BASE}${endpoint}`;
    if (params) {
        const searchParams = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => {
            searchParams.append(key, String(value));
        });
        url += `?${searchParams.toString()}`;
    }
    const response = await fetch(url);
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(error.error || error.detail || `HTTP ${response.status}`);
    }
    if (response.status === 204) return {} as T;
    return response.json();
}

async function apiPost<T>(endpoint: string, data?: unknown, params?: Record<string, string>): Promise<T> {
    let url = `${API_BASE}${endpoint}`;
    if (params) {
        const searchParams = new URLSearchParams(params);
        url += `?${searchParams.toString()}`;
    }
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: data ? JSON.stringify(data) : undefined,
    });
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(error.error || error.detail || `HTTP ${response.status}`);
    }
    if (response.status === 204) return {} as T;
    return response.json();
}

async function apiDelete<T>(endpoint: string, params?: Record<string, string>): Promise<T> {
    let url = `${API_BASE}${endpoint}`;
    if (params) {
        const searchParams = new URLSearchParams(params);
        url += `?${searchParams.toString()}`;
    }
    const response = await fetch(url, { method: 'DELETE' });
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(error.error || error.detail || `HTTP ${response.status}`);
    }
    if (response.status === 204) return {} as T;
    return response.json();
}

// ============================================================================
// Health & Configuration
// ============================================================================

export const getHealthStatus = async () => {
    return apiGet<any>('/healthz');
};

// ============================================================================
// Data Sources API
// ============================================================================

export const getDataSources = async (): Promise<{ success: boolean; datasources: DataSourceInfo[]; count: number }> => {
    return apiGet('/v1/datasources');
};

export const deleteDataSource = async (datasourceId: string): Promise<void> => {
    return apiDelete('/v1/datasource', { datasource_id: datasourceId });
};

// ScrapySettings interface for web scraping configuration
export interface ScrapySettings {
    crawl_mode: 'single' | 'sitemap' | 'recursive';
    max_depth?: number;
    max_pages?: number;
    render_javascript?: boolean;
    wait_for_selector?: string | null;
    page_load_timeout?: number;
    follow_external_links?: boolean;
    allowed_url_patterns?: string[] | null;
    denied_url_patterns?: string[] | null;
    download_delay?: number;
    concurrent_requests?: number;
    respect_robots_txt?: boolean;
    chunk_size?: number;
    chunk_overlap?: number;
    user_agent?: string | null;
}

export const ingestUrl = async (params: {
    url: string;
    description?: string;
    ingest_type?: string;
    get_child_pages?: boolean;
    settings?: ScrapySettings;
    reload_interval?: number;
}): Promise<{ datasource_id: string | null; job_id: string | null; message: string }> => {
    // Route to appropriate endpoint based on ingest_type
    if (params.ingest_type === 'confluence') {
        return apiPost('/v1/ingest/confluence/page', {
            url: params.url,
            description: params.description || '',
            get_child_pages: params.get_child_pages || false
        });
    } else {
        // Web ingestion with ScrapySettings and optional reload_interval
        return apiPost('/v1/ingest/webloader/url', {
            url: params.url,
            description: params.description || '',
            settings: params.settings || { crawl_mode: 'single' },
            reload_interval: params.reload_interval
        });
    }
};

export const reloadDataSource = async (datasourceId: string): Promise<{ datasource_id: string; message: string }> => {
    // Determine endpoint based on datasource ID pattern
    if (datasourceId.includes('src_confluence___')) {
        return apiPost('/v1/ingest/confluence/reload', { datasource_id: datasourceId });
    } else {
        return apiPost('/v1/ingest/webloader/reload', { datasource_id: datasourceId });
    }
};

// ============================================================================
// Jobs API
// ============================================================================

export const getJobStatus = async (jobId: string): Promise<IngestionJob> => {
    return apiGet(`/v1/job/${jobId}`);
};

export const getJobsByDataSource = async (datasourceId: string): Promise<IngestionJob[]> => {
    return apiGet(`/v1/jobs/datasource/${datasourceId}`);
};

export const terminateJob = async (jobId: string): Promise<void> => {
    return apiPost(`/v1/job/${jobId}/terminate`);
};

// ============================================================================
// Query API
// ============================================================================

export const searchDocuments = async (params: {
    query: string;
    limit?: number;
    similarity_threshold?: number;
    filters?: Record<string, string | boolean>;
    ranker_type?: string;
    ranker_params?: { weights: number[] };
    datasource_id?: string;
    connector_id?: string;
    graph_entity_type?: string;
}): Promise<QueryResult[]> => {
    return apiPost('/v1/query', params);
};

// ============================================================================
// Ingestors API
// ============================================================================

export const getIngestors = async (): Promise<IngestorInfo[]> => {
    return apiGet('/v1/ingestors');
};

export const deleteIngestor = async (ingestorId: string): Promise<void> => {
    return apiDelete('/v1/ingestor/delete', { ingestor_id: ingestorId });
};

// ============================================================================
// Ontology Graph API
// ============================================================================

export const getOntologyEntities = async (filterProps: Record<string, any> = {}) => {
    return apiPost('/v1/graph/explore/ontology/entities', {
        entity_type: null,
        filter_by_properties: filterProps
    });
};

export const getOntologyRelations = async (filterProps: Record<string, any> = {}) => {
    return apiPost('/v1/graph/explore/ontology/relations', {
        from_type: null,
        to_type: null,
        relation_name: null,
        filter_by_properties: filterProps
    });
};

export const getEntityTypes = async (): Promise<string[]> => {
    return apiGet('/v1/graph/explore/entity_type');
};

// ============================================================================
// Ontology Agent API
// ============================================================================

export const getOntologyAgentStatus = async () => {
    return apiGet('/v1/graph/ontology/agent/status');
};

export const regenerateOntology = async (): Promise<void> => {
    return apiPost('/v1/graph/ontology/agent/regenerate_ontology');
};

export const clearOntology = async (): Promise<void> => {
    return apiDelete('/v1/graph/ontology/agent/clear');
};

export const getOntologyVersion = async () => {
    return apiGet('/v1/graph/ontology/agent/ontology_version');
};

// ============================================================================
// Ontology and Data Graph Neighborhood Exploration API
// ============================================================================

export const getOntologyStartNodes = async (n: number = 10): Promise<any[]> => {
    return apiGet('/v1/graph/explore/ontology/entity/start', { n });
};

export const getDataStartNodes = async (n: number = 10): Promise<any[]> => {
    return apiGet('/v1/graph/explore/data/entity/start', { n });
};

export const exploreOntologyNeighborhood = async (entityType: string, entityPk: string, depth: number = 1): Promise<any> => {
    return apiPost('/v1/graph/explore/ontology/entity/neighborhood', {
        entity_type: entityType,
        entity_pk: entityPk,
        depth: depth
    });
};

export const exploreDataNeighborhood = async (entityType: string, entityPk: string, depth: number = 1): Promise<any> => {
    return apiPost('/v1/graph/explore/data/entity/neighborhood', {
        entity_type: entityType,
        entity_pk: entityPk,
        depth: depth
    });
};

export const getOntologyGraphStats = async (): Promise<{ node_count: number; relation_count: number }> => {
    return apiGet('/v1/graph/explore/ontology/stats');
};

export const getDataGraphStats = async (): Promise<{ node_count: number; relation_count: number }> => {
    return apiGet('/v1/graph/explore/data/stats');
};

// ============================================================================
// Graph Batch Fetch API
// ============================================================================

export const fetchOntologyEntitiesBatch = async (params: {
    offset?: number;
    limit?: number;
    entity_type?: string;
}): Promise<{ entities: any[]; count: number; offset: number; limit: number }> => {
    const queryParams: Record<string, string> = {};
    if (params.offset !== undefined) queryParams.offset = String(params.offset);
    if (params.limit !== undefined) queryParams.limit = String(params.limit);
    if (params.entity_type) queryParams.entity_type = params.entity_type;
    return apiGet('/v1/graph/explore/ontology/entities/batch', queryParams);
};

export const fetchOntologyRelationsBatch = async (params: {
    offset?: number;
    limit?: number;
    relation_name?: string;
}): Promise<{ relations: any[]; count: number; offset: number; limit: number }> => {
    const queryParams: Record<string, string> = {};
    if (params.offset !== undefined) queryParams.offset = String(params.offset);
    if (params.limit !== undefined) queryParams.limit = String(params.limit);
    if (params.relation_name) queryParams.relation_name = params.relation_name;
    return apiGet('/v1/graph/explore/ontology/relations/batch', queryParams);
};

export const fetchDataEntitiesBatch = async (params: {
    offset?: number;
    limit?: number;
    entity_type?: string;
}): Promise<{ entities: any[]; count: number; offset: number; limit: number }> => {
    const queryParams: Record<string, string> = {};
    if (params.offset !== undefined) queryParams.offset = String(params.offset);
    if (params.limit !== undefined) queryParams.limit = String(params.limit);
    if (params.entity_type) queryParams.entity_type = params.entity_type;
    return apiGet('/v1/graph/explore/data/entities/batch', queryParams);
};

export const fetchDataRelationsBatch = async (params: {
    offset?: number;
    limit?: number;
    relation_name?: string;
}): Promise<{ relations: any[]; count: number; offset: number; limit: number }> => {
    const queryParams: Record<string, string> = {};
    if (params.offset !== undefined) queryParams.offset = String(params.offset);
    if (params.limit !== undefined) queryParams.limit = String(params.limit);
    if (params.relation_name) queryParams.relation_name = params.relation_name;
    return apiGet('/v1/graph/explore/data/relations/batch', queryParams);
};

// ============================================================================
// Ontology Relation Management API
// ============================================================================

export const acceptOntologyRelation = async (
    relationId: string,
    relationName: string,
    propertyMappings: Array<{
        entity_a_property: string;
        entity_b_idkey_property: string;
        match_type: 'exact' | 'prefix' | 'suffix' | 'subset' | 'superset' | 'contains';
    }>
): Promise<void> => {
    return apiPost(
        `/v1/graph/ontology/agent/relation/accept/${encodeURIComponent(relationId)}`,
        propertyMappings,
        { relation_name: relationName }
    );
};

export const rejectOntologyRelation = async (relationId: string, justification: string = 'Rejected by user'): Promise<void> => {
    return apiPost(
        `/v1/graph/ontology/agent/relation/reject/${encodeURIComponent(relationId)}`,
        undefined,
        { justification }
    );
};

export const undoOntologyRelationEvaluation = async (relationId: string): Promise<void> => {
    return apiPost(`/v1/graph/ontology/agent/relation/undo_evaluation/${encodeURIComponent(relationId)}`);
};

export const evaluateOntologyRelation = async (relationId: string): Promise<void> => {
    return apiPost(`/v1/graph/ontology/agent/relation/evaluate/${encodeURIComponent(relationId)}`);
};

export const syncOntologyRelation = async (relationId: string): Promise<void> => {
    return apiPost(`/v1/graph/ontology/agent/relation/sync/${encodeURIComponent(relationId)}`);
};

export const getOntologyRelationHeuristicsBatch = async (relationIds: string[]): Promise<Record<string, any>> => {
    return apiPost('/v1/graph/ontology/agent/relation/heuristics/batch', relationIds);
};

export const getOntologyRelationEvaluationsBatch = async (relationIds: string[]): Promise<Record<string, any>> => {
    return apiPost('/v1/graph/ontology/agent/relation/evaluations/batch', relationIds);
};

// ============================================================================
// Debug/Development API
// ============================================================================

export const processEntityForHeuristics = async (entityType: string, primaryKeyValue: string): Promise<void> => {
    return apiPost('/v1/graph/ontology/agent/debug/process', null, {
        entity_type: entityType,
        primary_key_value: primaryKeyValue
    });
};

export const cleanupOntologyRelations = async (): Promise<void> => {
    return apiPost('/v1/graph/ontology/agent/debug/cleanup');
};

// ============================================================================
// Aliases for graph components
// ============================================================================

// Alias for batch fetch functions (used by graph components)
export const getOntologyEntitiesBatch = fetchOntologyEntitiesBatch;
export const getOntologyRelationsBatch = fetchOntologyRelationsBatch;
export const exploreEntityNeighborhood = exploreDataNeighborhood;
