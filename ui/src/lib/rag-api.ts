/**
 * RAG API Client for New UI
 * 
 * This module provides type-safe API functions to interact with the RAG server
 * through the Next.js API proxy at /api/rag/*.
 * 
 * Key Features:
 * - RBAC headers automatically injected server-side via Next.js API routes
 * - Type-safe request/response handling
 * - Compatible with old UI's API structure
 */

// ============================================================================
// Types (matching old UI's Models.tsx)
// ============================================================================

export interface DataSourceInfo {
  datasource_id: string;
  ingestor_id: string;
  source_type: string;
  description: string;
  created_at: string;
  metadata: Record<string, unknown>;
}

export interface IngestorInfo {
  ingestor_id: string;
  ingestor_type: string;
  created_at: string;
  metadata: Record<string, unknown>;
}

export interface IngestionJob {
  job_id: string;
  datasource_id: string;
  status: string;
  created_at: string;
  updated_at: string;
  progress?: number;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface QueryResult {
  id: string;
  score: number;
  text: string;
  metadata: Record<string, unknown>;
}

/**
 * Permission constants for RAG operations.
 * Use these instead of magic strings to avoid typos.
 */
export const Permission = {
  READ: 'read',
  INGEST: 'ingest',
  DELETE: 'delete',
} as const;

export type PermissionType = typeof Permission[keyof typeof Permission];

export interface UserInfo {
  email: string;
  role: string;
  is_authenticated: boolean;
  groups: string[];
  permissions?: PermissionType[];
  in_trusted_network: boolean;
}

/**
 * Helper to check if user has a specific permission.
 * 
 * @example
 * hasPermission(userInfo, Permission.DELETE)
 */
export function hasPermission(userInfo: UserInfo | null, permission: PermissionType): boolean {
  const result = (() => {
    if (!userInfo) return false;
    if (!userInfo.permissions) return false;
    if (!Array.isArray(userInfo.permissions)) return false;
    return userInfo.permissions.includes(permission);
  })();
  
  console.log(`[hasPermission] Checking '${permission}': ${result}`, {
    hasUserInfo: !!userInfo,
    permissions: userInfo?.permissions,
    isArray: Array.isArray(userInfo?.permissions)
  });
  
  return result;
}

// ============================================================================
// API Client Configuration
// ============================================================================

const API_BASE = '/api/rag';

/**
 * Make a GET request to the RAG API
 */
async function get<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`${API_BASE}${path}`, window.location.origin);
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.append(key, value);
    });
  }

  const response = await fetch(url.toString(), {
    method: 'GET',
    credentials: 'include', // Important for session cookies
  });

  if (!response.ok) {
    throw new Error(`API Error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

/**
 * Make a POST request to the RAG API
 */
async function post<T>(path: string, body?: unknown): Promise<T> {
  const url = `${API_BASE}${path}`;
  
  const response = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    throw new Error(`API Error: ${response.status} ${response.statusText}`);
  }

  // Handle 204 No Content
  if (response.status === 204) {
    return {} as T;
  }

  return response.json();
}

/**
 * Make a DELETE request to the RAG API
 */
async function del<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`${API_BASE}${path}`, window.location.origin);
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.append(key, value);
    });
  }

  const response = await fetch(url.toString(), {
    method: 'DELETE',
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error(`API Error: ${response.status} ${response.statusText}`);
  }

  // Handle 204 No Content
  if (response.status === 204) {
    return {} as T;
  }

  return response.json();
}

// ============================================================================
// Health & Configuration
// ============================================================================

export async function getHealthStatus() {
  return get<{ status: string }>('/healthz');
}

// ============================================================================
// Data Sources API
// ============================================================================

export async function getDataSources(): Promise<{ success: boolean; datasources: DataSourceInfo[]; count: number }> {
  return get('/v1/datasources');
}

export async function deleteDataSource(datasourceId: string): Promise<void> {
  await del('/v1/datasource', { datasource_id: datasourceId });
}

export async function ingestUrl(params: {
  url: string;
  check_for_sitemaps?: boolean;
  sitemap_max_urls?: number;
  description?: string;
  ingest_type?: string;
  get_child_pages?: boolean;
}): Promise<{ datasource_id: string | null; job_id: string | null; message: string }> {
  if (params.ingest_type === 'confluence') {
    return post('/v1/ingest/confluence/page', {
      url: params.url,
      description: params.description || '',
      get_child_pages: params.get_child_pages || false,
    });
  } else {
    return post('/v1/ingest/webloader/url', params);
  }
}

export async function reloadDataSource(datasourceId: string): Promise<{ datasource_id: string; message: string }> {
  if (datasourceId.includes('src_confluence___')) {
    return post('/v1/ingest/confluence/reload', { datasource_id: datasourceId });
  } else {
    return post('/v1/ingest/webloader/reload', { datasource_id: datasourceId });
  }
}

// ============================================================================
// Jobs API
// ============================================================================

export async function getJobStatus(jobId: string): Promise<IngestionJob> {
  return get(`/v1/job/${jobId}`);
}

export async function getJobsByDataSource(datasourceId: string): Promise<IngestionJob[]> {
  return get(`/v1/jobs/datasource/${datasourceId}`);
}

export async function terminateJob(jobId: string): Promise<void> {
  await post(`/v1/job/${jobId}/terminate`);
}

// ============================================================================
// Query API
// ============================================================================

export async function searchDocuments(params: {
  query: string;
  limit?: number;
  similarity_threshold?: number;
  filters?: Record<string, string | boolean>;
  ranker_type?: string;
  ranker_params?: { weights: number[] };
  datasource_id?: string;
  connector_id?: string;
  graph_entity_type?: string;
}): Promise<QueryResult[]> {
  return post('/v1/query', params);
}

// ============================================================================
// Ingestors API
// ============================================================================

export async function getIngestors(): Promise<IngestorInfo[]> {
  return get('/v1/ingestors');
}

export async function deleteIngestor(ingestorId: string): Promise<void> {
  await del('/v1/ingestor/delete', { ingestor_id: ingestorId });
}

// ============================================================================
// Ontology Graph API
// ============================================================================

export async function getOntologyEntities(filterProps: Record<string, unknown> = {}) {
  return post('/v1/graph/explore/ontology/entities', {
    entity_type: null,
    filter_by_properties: filterProps,
  });
}

export async function getOntologyRelations(filterProps: Record<string, unknown> = {}) {
  return post('/v1/graph/explore/ontology/relations', {
    from_type: null,
    to_type: null,
    relation_name: null,
    filter_by_properties: filterProps,
  });
}

export async function getEntityTypes(): Promise<string[]> {
  return get('/v1/graph/explore/entity_type');
}

// ============================================================================
// Ontology Agent API
// ============================================================================

export async function getOntologyAgentStatus() {
  return get('/v1/graph/ontology/agent/status');
}

export async function regenerateOntology(): Promise<void> {
  await post('/v1/graph/ontology/agent/regenerate_ontology');
}

export async function clearOntology(): Promise<void> {
  await del('/v1/graph/ontology/agent/clear');
}

export async function getOntologyVersion() {
  return get('/v1/graph/ontology/agent/ontology_version');
}

// ============================================================================
// User Info & RBAC API
// ============================================================================

export async function getUserInfo(): Promise<UserInfo> {
  console.log('[getUserInfo] Fetching from /api/user/info...');
  // Use the new Next.js API endpoint instead of RAG server
  const response = await fetch('/api/user/info', {
    credentials: 'include',
  });

  if (!response.ok) {
    console.error('[getUserInfo] Failed with status:', response.status);
    throw new Error(`Failed to fetch user info: ${response.status}`);
  }

  const data = await response.json();
  console.log('[getUserInfo] Received data:', data);
  console.log('[getUserInfo] Permissions type:', typeof data.permissions, Array.isArray(data.permissions) ? 'array' : 'not array');
  console.log('[getUserInfo] Permissions value:', data.permissions);
  
  // Normalize permissions to array if it comes as object
  if (data.permissions && !Array.isArray(data.permissions)) {
    console.warn('[getUserInfo] ⚠️  Permissions came as object, converting to array:', data.permissions);
    
    // Convert object like {can_read: true, can_ingest: true, can_delete: true} to array
    // Extract keys where value is true, and remove "can_" prefix
    data.permissions = Object.entries(data.permissions)
      .filter(([_, value]) => value === true)
      .map(([key, _]) => key.replace(/^can_/, ''));
    
    console.log('[getUserInfo] ✅ Converted permissions to:', data.permissions);
  }
  
  return data;
}
