import axios, { AxiosInstance } from 'axios';
import { DataSourceInfo, IngestorInfo, IngestionJob, QueryResult } from '../ui/Models';

// API configuration
const apiBase = import.meta.env.VITE_API_BASE?.toString() || '';

// Constants
export const WEBLOADER_INGESTOR_ID = 'webloader:default_webloader';

// Create axios instance
const api: AxiosInstance = axios.create({
    baseURL: apiBase || undefined,
});

// ============================================================================
// Health & Configuration
// ============================================================================

export const getHealthStatus = async () => {
    const response = await api.get('/healthz');
    return response.data;
};

// ============================================================================
// Data Sources API
// ============================================================================

export const getDataSources = async (): Promise<{ success: boolean; datasources: DataSourceInfo[]; count: number }> => {
    const response = await api.get('/v1/datasources');
    return response.data;
};

export const deleteDataSource = async (datasourceId: string): Promise<void> => {
    await api.delete('/v1/datasource', { params: { datasource_id: datasourceId } });
};

export const ingestUrl = async (params: {
    url: string;
    check_for_sitemaps?: boolean;
    sitemap_max_urls?: number;
    description?: string;
}): Promise<{ datasource_id: string; job_id: string; message: string }> => {
    const response = await api.post('/v1/ingest/webloader/url', params);
    return response.data;
};

export const reloadDataSource = async (datasourceId: string): Promise<{ datasource_id: string; message: string }> => {
    const response = await api.post('/v1/ingest/webloader/reload', { datasource_id: datasourceId });
    return response.data;
};

// ============================================================================
// Jobs API
// ============================================================================

export const getJobStatus = async (jobId: string): Promise<IngestionJob> => {
    const response = await api.get(`/v1/job/${jobId}`);
    return response.data;
};

export const getJobsByDataSource = async (datasourceId: string): Promise<IngestionJob[]> => {
    const response = await api.get(`/v1/jobs/datasource/${datasourceId}`);
    return response.data;
};

export const terminateJob = async (jobId: string): Promise<void> => {
    await api.post(`/v1/job/${jobId}/terminate`);
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
    const response = await api.post('/v1/query', params);
    return response.data;
};

// ============================================================================
// Ingestors API
// ============================================================================

export const getIngestors = async (): Promise<IngestorInfo[]> => {
    const response = await api.get('/v1/ingestors');
    return response.data;
};

export const deleteIngestor = async (ingestorId: string): Promise<void> => {
    await api.delete('/v1/ingestor/delete', { params: { ingestor_id: ingestorId } });
};

// ============================================================================
// Ontology Graph API
// ============================================================================

export const getOntologyEntities = async (filterProps: Record<string, any> = {}) => {
    const response = await api.post('/v1/graph/explore/ontology/entities', {
        entity_type: null,
        filter_by_properties: filterProps
    });
    return response.data;
};

export const getOntologyRelations = async (filterProps: Record<string, any> = {}) => {
    const response = await api.post('/v1/graph/explore/ontology/relations', {
        from_type: null,
        to_type: null,
        relation_name: null,
        filter_by_properties: filterProps
    });
    return response.data;
};

export const getEntityTypes = async (): Promise<string[]> => {
    const response = await api.get('/v1/graph/explore/entity_type');
    return response.data;
};

// ============================================================================
// Data Graph API
// ============================================================================

export const getDataEntity = async (entityType: string, primaryKey: string) => {
    const response = await api.post('/v1/graph/explore/data/entity', {
        entity_type: entityType,
        entity_pk: primaryKey
    });
    return response.data;
};

// ============================================================================
// Ontology Agent API
// ============================================================================

export const getOntologyAgentStatus = async () => {
    const response = await api.get('/v1/graph/ontology/agent/status');
    return response.data;
};

export const regenerateOntology = async (): Promise<void> => {
    await api.post('/v1/graph/ontology/agent/regenerate_ontology');
};

export const clearOntology = async (): Promise<void> => {
    await api.delete('/v1/graph/ontology/agent/clear');
};

export const getOntologyVersion = async () => {
    const response = await api.get('/v1/graph/ontology/agent/ontology_version');
    return response.data;
};

// ============================================================================
// Ontology Relation Management API
// ============================================================================

export const acceptOntologyRelation = async (relationId: string, relationName: string): Promise<void> => {
    await api.post(`/v1/graph/ontology/agent/relation/accept/${encodeURIComponent(relationId)}`, null, {
        params: { relation_name: relationName }
    });
};

export const rejectOntologyRelation = async (relationId: string): Promise<void> => {
    await api.post(`/v1/graph/ontology/agent/relation/reject/${encodeURIComponent(relationId)}`);
};

export const undoOntologyRelationEvaluation = async (relationId: string): Promise<void> => {
    await api.post(`/v1/graph/ontology/agent/relation/undo_evaluation/${encodeURIComponent(relationId)}`);
};

export const evaluateOntologyRelation = async (relationId: string): Promise<void> => {
    await api.post(`/v1/graph/ontology/agent/relation/evaluate/${encodeURIComponent(relationId)}`);
};

export const syncOntologyRelation = async (relationId: string): Promise<void> => {
    await api.post(`/v1/graph/ontology/agent/relation/sync/${encodeURIComponent(relationId)}`);
};

// ============================================================================
// Debug/Development API
// ============================================================================

export const processEntityForHeuristics = async (entityType: string, primaryKeyValue: string): Promise<void> => {
    await api.post('/v1/graph/ontology/agent/debug/process', null, {
        params: { entity_type: entityType, primary_key_value: primaryKeyValue }
    });
};

export const cleanupOntologyRelations = async (): Promise<void> => {
    await api.post('/v1/graph/ontology/agent/debug/cleanup');
};

// ============================================================================
// Export the axios instance for custom requests if needed
// ============================================================================

export { api as axiosInstance };