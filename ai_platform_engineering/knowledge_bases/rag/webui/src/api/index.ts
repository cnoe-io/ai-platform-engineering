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

// Note: Use exploreDataNeighborhood for data entity exploration

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
// Ontology and Data Graph Neighborhood Exploration API
// ============================================================================

export const getOntologyStartNodes = async (n: number = 10): Promise<any[]> => {
    const response = await api.get('/v1/graph/explore/ontology/entity/start', {
        params: { n }
    });
    return response.data;
};

export const getDataStartNodes = async (n: number = 10): Promise<any[]> => {
    const response = await api.get('/v1/graph/explore/data/entity/start', {
        params: { n }
    });
    return response.data;
};

export const exploreOntologyNeighborhood = async (entityType: string, entityPk: string, depth: number = 1): Promise<any> => {
    const response = await api.post('/v1/graph/explore/ontology/entity/neighborhood', {
        entity_type: entityType,
        entity_pk: entityPk,
        depth: depth
    });
    return response.data;
};

export const exploreDataNeighborhood = async (entityType: string, entityPk: string, depth: number = 1): Promise<any> => {
    const response = await api.post('/v1/graph/explore/data/entity/neighborhood', {
        entity_type: entityType,
        entity_pk: entityPk,
        depth: depth
    });
    return response.data;
};

export const getOntologyGraphStats = async (): Promise<{ node_count: number; relation_count: number }> => {
    const response = await api.get('/v1/graph/explore/ontology/stats');
    return response.data;
};

export const getDataGraphStats = async (): Promise<{ node_count: number; relation_count: number }> => {
    const response = await api.get('/v1/graph/explore/data/stats');
    return response.data;
};

// ============================================================================
// Graph Batch Fetch API
// ============================================================================

export const fetchOntologyEntitiesBatch = async (params: {
    offset?: number;
    limit?: number;
    entity_type?: string;
}): Promise<{ entities: any[]; count: number; offset: number; limit: number }> => {
    const response = await api.get('/v1/graph/explore/ontology/entities/batch', { params });
    return response.data;
};

export const fetchOntologyRelationsBatch = async (params: {
    offset?: number;
    limit?: number;
    relation_name?: string;
}): Promise<{ relations: any[]; count: number; offset: number; limit: number }> => {
    const response = await api.get('/v1/graph/explore/ontology/relations/batch', { params });
    return response.data;
};

export const fetchDataEntitiesBatch = async (params: {
    offset?: number;
    limit?: number;
    entity_type?: string;
}): Promise<{ entities: any[]; count: number; offset: number; limit: number }> => {
    const response = await api.get('/v1/graph/explore/data/entities/batch', { params });
    return response.data;
};

export const fetchDataRelationsBatch = async (params: {
    offset?: number;
    limit?: number;
    relation_name?: string;
}): Promise<{ relations: any[]; count: number; offset: number; limit: number }> => {
    const response = await api.get('/v1/graph/explore/data/relations/batch', { params });
    return response.data;
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
    await api.post(
        `/v1/graph/ontology/agent/relation/accept/${encodeURIComponent(relationId)}?relation_name=${encodeURIComponent(relationName)}`,
        propertyMappings
    );
};

export const rejectOntologyRelation = async (relationId: string, justification: string = 'Rejected by user'): Promise<void> => {
    await api.post(`/v1/graph/ontology/agent/relation/reject/${encodeURIComponent(relationId)}?justification=${encodeURIComponent(justification)}`);
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

export const getOntologyRelationHeuristicsBatch = async (relationIds: string[]): Promise<Record<string, any>> => {
    const response = await api.post('/v1/graph/ontology/agent/relation/heuristics/batch', relationIds);
    return response.data;
};

export const getOntologyRelationEvaluationsBatch = async (relationIds: string[]): Promise<Record<string, any>> => {
    const response = await api.post('/v1/graph/ontology/agent/relation/evaluations/batch', relationIds);
    return response.data;
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