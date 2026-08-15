/**
 * RAG API Client - Ported from RAG WebUI
 *
 * This is a direct port of the RAG webui API client, adapted to use
 * fetch through the Next.js API proxy instead of axios.
 *
 * All requests go through /api/rag/* which proxies to the RAG server.
 */

import { DataSourceInfo,IngestionJob,IngestorInfo } from '../Models';

// API configuration - uses Next.js API proxy
const API_BASE = '/api/rag';

// Constants
export const WEBLOADER_INGESTOR_ID = 'webloader:default_webloader';
export const CONFLUENCE_INGESTOR_ID = 'confluence:default_confluence';
export const JIRA_INGESTOR_ID = 'jira:default_jira';

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

async function apiPostForm<T>(endpoint: string, data: FormData): Promise<T> {
    const response = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        body: data,
    });
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(error.error || error.detail || `HTTP ${response.status}`);
    }
    if (response.status === 204) return {} as T;
    return response.json();
}

async function apiPatch<T>(endpoint: string, data?: unknown): Promise<T> {
    const url = `${API_BASE}${endpoint}`;
    const response = await fetch(url, {
        method: 'PATCH',
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

export const renameDataSource = async (
    datasourceId: string,
    name: string,
): Promise<{ datasource_id: string; name: string; changed: boolean }> => {
    return apiPatch(`/v1/datasource/${encodeURIComponent(datasourceId)}`, { name });
};

// Cleanup response type
export interface CleanupResponse {
    datasource_id: string | null;
    success: boolean;
    message: string;
}

export const cleanupDataSource = async (datasourceId: string): Promise<CleanupResponse> => {
    return apiPost(`/v1/datasource/${encodeURIComponent(datasourceId)}/cleanup`);
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
    // Owning team for the new data source (spec 2026-06-03). The server
    // authorizes creation against the org `can_ingest` capability + membership
    // of this team, and writes ownership tuples so the team's members get
    // read/ingest on the new source. Required for non-org-admin authors.
    owner_team_slug?: string;
}): Promise<{ datasource_id: string | null; job_id: string | null; message: string }> => {
    // Route to appropriate endpoint based on ingest_type
    if (params.ingest_type === 'confluence') {
        return apiPost('/v1/ingest/confluence/page', {
            url: params.url,
            description: params.description || '',
            get_child_pages: params.get_child_pages || false,
            owner_team_slug: params.owner_team_slug || null
        });
    } else {
        // Web ingestion with ScrapySettings and optional reload_interval
        return apiPost('/v1/ingest/webloader/url', {
            url: params.url,
            description: params.description || '',
            settings: params.settings || { crawl_mode: 'single' },
            reload_interval: params.reload_interval,
            owner_team_slug: params.owner_team_slug || null
        });
    }
};

export const ingestLocalFile = async (params: {
    files: File[];
    description?: string;
    owner_team_slug?: string;
    chunk_size?: number;
    chunk_overlap?: number;
}): Promise<{ datasource_id: string | null; job_id: string | null; message: string }> => {
    const form = new FormData();
    params.files.forEach((file) => form.append('file', file));
    if (params.description) form.append('description', params.description);
    if (params.owner_team_slug) form.append('owner_team_slug', params.owner_team_slug);
    if (params.chunk_size !== undefined) form.append('chunk_size', String(params.chunk_size));
    if (params.chunk_overlap !== undefined) form.append('chunk_overlap', String(params.chunk_overlap));
    return apiPostForm('/v1/ingest/local-file', form);
};

// A single line of a benchmark corpus .jsonl. Keys are matched flexibly so the
// same UI works for corpora produced by different tools (deepeval/ragas scripts,
// a parquet->jsonl conversion, etc.).
export interface BenchmarkCorpusRow {
    document_id?: string;
    id?: string;
    title?: string;
    text?: string;
    content?: string;
    page_content?: string;
    [key: string]: unknown;
}

/**
 * Ingest a benchmark corpus JSONL (one document per line) into CAIPE, preserving
 * each row's document_id (so retrieval eval lines up with the golden
 * expected_doc_ids).
 *
 * The actual heartbeat->datasource->job->/v1/ingest->complete lifecycle runs
 * server-side in `/api/benchmark-ingest` under a service-account token, because
 * those setup endpoints require the `ingestonly` role that a human SSO login
 * (always `readonly`) never gets. This client just forwards the parsed rows.
 */
export const ingestBenchmarkCorpus = async (
    rows: BenchmarkCorpusRow[],
    datasourceId: string,
    datasourceName: string,
    options?: { description?: string; owner_team_slug?: string },
): Promise<{ datasource_id: string; job_id: string; count: number }> => {
    const response = await fetch('/api/benchmark-ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            datasourceId,
            datasourceName,
            description: options?.description,
            ownerTeamSlug: options?.owner_team_slug,
            rows,
        }),
    });
    if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'Ingestion failed' }));
        throw new Error(err.error || err.detail || `HTTP ${response.status}`);
    }
    return response.json();
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
// Documents API
// ============================================================================

export interface ChunkInfo {
    id: string;
    chunk_index: number;
    total_chunks: number;
    metadata: {
        fresh_until?: number;
        document_type?: string;
        document_ingested_at?: number;
        is_structured_entity?: boolean;
        source?: string;
        [key: string]: unknown;
    };
}

export interface DocumentInfo {
    document_id: string;
    title: string;
    chunks: ChunkInfo[];
}

export interface DatasourceDocumentsResponse {
    datasource_id: string;
    documents: DocumentInfo[];
    total_documents: number;
    total_chunks: number;
    offset: number;
    limit: number;
    has_more: boolean;
}

export interface ChunkContentResponse {
    id: string;
    text_content: string;
}

export const getDatasourceDocuments = async (
    datasourceId: string,
    offset: number = 0,
    limit: number = 100
): Promise<DatasourceDocumentsResponse> => {
    return apiGet(`/v1/datasource/${encodeURIComponent(datasourceId)}/documents`, { offset, limit });
};

export const getChunkContent = async (chunkId: string): Promise<ChunkContentResponse> => {
    return apiGet(`/v1/chunk/${encodeURIComponent(chunkId)}/content`);
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

export interface JobsBatchResponse {
    jobs: Record<string, IngestionJob[]>;
    total_jobs: number;
    datasource_count: number;
}

export const getJobsBatch = async (
    datasourceIds: string[],
    statusFilter?: string[]
): Promise<JobsBatchResponse> => {
    return apiPost('/v1/jobs/batch', {
        datasource_ids: datasourceIds,
        status_filter: statusFilter,
    });
};

// ============================================================================
// MCP Tools API
// ============================================================================

// MCP Tool Schema types
export interface MCPToolParameter {
    type: string;
    description?: string;
    default?: unknown;
    enum?: string[];
    items?: { type: string };
    properties?: Record<string, MCPToolParameter>;
    required?: string[];
}

export interface MCPToolSchema {
    name: string;
    description: string;
    parameters: {
        type: string;
        properties: Record<string, MCPToolParameter>;
        required?: string[];
    };
}

export interface MCPToolSchemasResponse {
    tools: MCPToolSchema[];
    count: number;
}

export interface MCPToolInvokeResponse {
    tool_name: string;
    success: boolean;
    result: unknown;
    error: string | null;
}

/**
 * Get all registered MCP tools with their full JSON schemas.
 */
export const getMCPToolSchemas = async (): Promise<MCPToolSchemasResponse> => {
    return apiGet('/v1/mcp/tools/schema');
};

/**
 * Invoke an MCP tool via REST API.
 */
export const invokeMCPTool = async (
    toolName: string,
    args: Record<string, unknown>
): Promise<MCPToolInvokeResponse> => {
    return apiPost('/v1/mcp/invoke', {
        tool_name: toolName,
        arguments: args,
    });
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

// ============================================================================
// Evaluation — Question Sets API
//
// Stored by the DeepEval evaluation service's Question Set Manager, reached
// through our own /api/knowledge-bases/question-sets routes: those add the
// session + OpenFGA check and hold the service API key server-side. Field
// names are the service's own (`input`/`expected_output`/`level`), passed
// through untranslated.
// ============================================================================

export interface QuestionSet {
    id: number;
    name: string;
    description: string | null;
    source_format: string | null;
    created_at: string | null;
    updated_at: string | null;
    question_count: number;
    /** Category name -> question count in that category. */
    categories: Record<string, number> | null;
}

export interface QuestionSetItem {
    id: number;
    question_set_id: number;
    /** Caller-supplied identifier from the source file, not the DB key. */
    question_id: string | null;
    input: string;
    expected_output: string | null;
    category: string | null;
    level: string | null;
    expected_doc_ids: string[];
    context?: unknown;
    extra?: unknown;
    created_at: string | null;
    updated_at: string | null;
}

/** Envelope shared by both paginated list endpoints. */
export interface QuestionSetPage<T> {
    items: T[];
    total: number;
    page: number;
    limit: number;
    total_pages: number;
}

const QUESTION_SETS_BASE = '/api/knowledge-bases/question-sets';

async function questionSetsFetch<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${QUESTION_SETS_BASE}${path}`, {
        credentials: 'include',
        ...init,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(body.error || body.detail || `HTTP ${response.status}`);
    }
    return (body.data ?? body) as T;
}

export const listQuestionSets = async (params?: {
    page?: number;
    limit?: number;
    query?: string;
}): Promise<QuestionSetPage<QuestionSet>> => {
    const search = new URLSearchParams();
    if (params?.page) search.set('page', String(params.page));
    if (params?.limit) search.set('limit', String(params.limit));
    if (params?.query) search.set('query', params.query);
    const qs = search.toString();
    return questionSetsFetch(qs ? `?${qs}` : '');
};

export const getQuestionSet = async (id: number): Promise<QuestionSet> => {
    return questionSetsFetch(`/${id}`);
};

/** Create an empty set — name + optional description, no file. */
export const createQuestionSet = async (opts: {
    name: string;
    description?: string;
}): Promise<QuestionSet> => {
    const form = new FormData();
    form.append('name', opts.name);
    if (opts.description) form.append('description', opts.description);
    return questionSetsFetch('', { method: 'POST', body: form });
};

/** Create a set, optionally seeded from a .jsonl / .csv / .json file. */
export const uploadQuestionSet = async (
    file: File,
    opts: { name: string; description?: string },
): Promise<QuestionSet> => {
    const form = new FormData();
    form.append('file', file);
    form.append('name', opts.name);
    if (opts.description) form.append('description', opts.description);

    return questionSetsFetch('', { method: 'POST', body: form });
};

export const renameQuestionSet = async (
    id: number,
    patch: { name?: string; description?: string | null },
): Promise<QuestionSet> => {
    return questionSetsFetch(`/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
    });
};

export const deleteQuestionSet = async (
    id: number,
): Promise<{ deleted: boolean; question_set_id: number }> => {
    return questionSetsFetch(`/${id}`, { method: 'DELETE' });
};

/** `query` searches the whole set server-side, not just the current page. */
export const listQuestionSetItems = async (
    id: number,
    params?: { page?: number; limit?: number; category?: string; level?: string; query?: string },
): Promise<QuestionSetPage<QuestionSetItem>> => {
    const search = new URLSearchParams();
    if (params?.page) search.set('page', String(params.page));
    if (params?.limit) search.set('limit', String(params.limit));
    if (params?.category) search.set('category', params.category);
    if (params?.level) search.set('level', params.level);
    if (params?.query) search.set('query', params.query);
    const qs = search.toString();
    return questionSetsFetch(`/${id}/questions${qs ? `?${qs}` : ''}`);
};

export const updateQuestionSetItem = async (
    id: number,
    itemId: number,
    patch: Partial<
        Pick<
            QuestionSetItem,
            'input' | 'expected_output' | 'category' | 'level' | 'question_id' | 'expected_doc_ids'
        >
    >,
): Promise<QuestionSetItem> => {
    return questionSetsFetch(`/${id}/questions/${itemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
    });
};

export const deleteQuestionSetItem = async (
    id: number,
    itemId: number,
): Promise<{ deleted: boolean; question_id: number }> => {
    return questionSetsFetch(`/${id}/questions/${itemId}`, { method: 'DELETE' });
};

/** Append questions to an existing set from a file. */
export const uploadQuestionsToSet = async (
    id: number,
    file: File,
): Promise<{ questions: QuestionSetItem[]; added_count: number }> => {
    const form = new FormData();
    form.append('file', file);
    return questionSetsFetch(`/${id}/questions/upload`, { method: 'POST', body: form });
};

/** Add a single question to a set via JSON (no file). */
export const addQuestionToSet = async (
    id: number,
    question: {
        question_id?: string | null;
        input: string;
        expected_output?: string | null;
        category?: string | null;
        level?: string | null;
        expected_doc_ids?: string[];
    },
): Promise<QuestionSetItem[]> => {
    return questionSetsFetch(`/${id}/questions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(question),
    });
};

export const batchDeleteQuestionSetItems = async (
    id: number,
    ids: number[],
): Promise<{ deleted_count: number }> => {
    return questionSetsFetch(`/${id}/questions/batch-delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
    });
};

/** Download URL for a set export — point the browser at it directly. */
export const questionSetExportUrl = (id: number, format: 'jsonl' | 'csv'): string =>
    `${QUESTION_SETS_BASE}/${id}/export?format=${format}`;

// ============================================================================
// Evaluation — Run Experiment API
//
// BFF-owned orchestration: converts a stored question set into the DeepEval
// evaluation service's expected format and submits/polls a job. The service
// itself is a separate deployment (not part of this repo's docker-compose);
// the BFF holds its API key server-side, so these calls go through our own
// /api/knowledge-bases/evaluation/* routes, never directly to that service.
// ============================================================================

export type EvaluationJobStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface EvaluationSummary {
    total_items: number;
    evaluation_time_seconds: number;
    p50_latency: number;
    p95_latency: number;
    total_tokens: number;
    metrics: Record<string, number>;
    failure_causes: Record<string, number>;
}

export interface EvaluationJob {
    job_id: string;
    status: EvaluationJobStatus;
    created_at: number;
    completed_at: number | null;
    cached: boolean;
    error: string | null;
    config_args?: Record<string, unknown>;
    summary?: EvaluationSummary;
}

const EVALUATION_BASE = '/api/knowledge-bases/evaluation';

async function evaluationFetch<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${EVALUATION_BASE}${path}`, {
        credentials: 'include',
        ...init,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(body.error || body.detail || `HTTP ${response.status}`);
    }
    return (body.data ?? body) as T;
}

export const runEvaluationExperiment = async (params: {
    question_set_id: number;
    /** Omit/empty to search across all datasources. */
    datasource_id?: string;
    top_k: number;
    max_items: number;
    limit_per_category?: number;
}): Promise<EvaluationJob> => {
    return evaluationFetch('/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
    });
};

export const getEvaluationJobStatus = async (jobId: string): Promise<EvaluationJob> => {
    return evaluationFetch(`/jobs/${jobId}`);
};

export const getEvaluationServiceHealth = async (): Promise<{ healthy: boolean }> => {
    return evaluationFetch('/health');
};

export const listEvaluationJobs = async (): Promise<{ jobs: EvaluationJob[] }> => {
    return evaluationFetch('/jobs');
};
