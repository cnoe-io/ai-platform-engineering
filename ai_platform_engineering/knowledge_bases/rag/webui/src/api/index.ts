import axios, { AxiosInstance } from 'axios';
import { DataSourceInfo, GraphConnectorInfo, IngestionJob, QueryResponse } from '../ui/Models';

// API configuration
const apiBase = import.meta.env.VITE_API_BASE?.toString() || '';

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

export const getDataSources = async (): Promise<{ datasources: DataSourceInfo[] }> => {
    const response = await api.get('/v1/datasources');
    return response.data;
};

export const getDataSource = async (datasourceId: string): Promise<DataSourceInfo> => {
    const response = await api.get(`/v1/datasource/${datasourceId}`);
    return response.data.source_info;
};

export const deleteDataSource = async (datasourceId: string): Promise<void> => {
    await api.delete('/v1/datasource/delete', { params: { datasource_id: datasourceId } });
};

export const ingestUrl = async (params: {
    url: string;
    default_chunk_size: number;
    default_chunk_overlap: number;
    check_for_site_map?: boolean;
    sitemap_max_urls?: number;
    description?: string;
}): Promise<{ job_id: string }> => {
    const response = await api.post('/v1/datasource/ingest/url', params);
    return response.data;
};

export const getDataSourceDocuments = async (datasourceId: string) => {
    const response = await api.get(`/v1/datasource/${datasourceId}/documents`);
    return response.data;
};

export const reloadDataSource = async (datasourceId: string): Promise<{ job_id: string }> => {
    const response = await api.post('/v1/datasource/reload', null, { params: { datasource_id: datasourceId } });
    return response.data;
};

// ============================================================================
// Jobs API
// ============================================================================

export const getJobStatus = async (jobId: string): Promise<IngestionJob> => {
    const response = await api.get(`/v1/job/${jobId}`);
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
    filters?: Record<string, string>;
    ranker_type?: string;
    ranker_params?: { weights: number[] };
    datasource_id?: string;
    connector_id?: string;
    graph_entity_type?: string;
}): Promise<QueryResponse> => {
    const response = await api.post('/v1/query', params);
    return response.data;
};

// ============================================================================
// Graph Connectors API
// ============================================================================

export const getGraphConnectors = async (): Promise<GraphConnectorInfo[]> => {
    const response = await api.get('/v1/graph/connectors');
    return response.data;
};

export const deleteGraphConnector = async (connectorId: string): Promise<void> => {
    await api.delete(`/v1/graph/connector/${connectorId}`);
};

// ============================================================================
// Ontology Graph API
// ============================================================================

export const getOntologyEntities = async (filterProps: Record<string, any> = {}) => {
    const response = await api.post('/v1/graph/explore/ontology/entities', {
        filter_by_properties: filterProps
    });
    return response.data;
};

export const getOntologyRelations = async (filterProps: Record<string, any> = {}) => {
    const response = await api.post('/v1/graph/explore/ontology/relations', {
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