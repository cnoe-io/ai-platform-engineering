/**
 * TypeScript types for Dynamic Agents feature.
 */

// =============================================================================
// Enums
// =============================================================================

export type TransportType = 'stdio' | 'sse' | 'http';

export type VisibilityType = 'private' | 'team' | 'global';

// =============================================================================
// MCP Server Types
// =============================================================================

export interface MCPServerConfig {
  _id: string;
  name: string;
  description?: string;
  transport: TransportType;
  endpoint?: string;  // For sse/http transports
  command?: string;   // For stdio transport
  args?: string[];    // For stdio transport
  env?: Record<string, string>;  // For stdio transport
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface MCPServerConfigCreate {
  id: string;  // User-provided slug ID
  name: string;
  description?: string;
  transport: TransportType;
  endpoint?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  enabled?: boolean;
}

export interface MCPServerConfigUpdate {
  name?: string;
  description?: string;
  transport?: TransportType;
  endpoint?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  enabled?: boolean;
}

export interface MCPToolInfo {
  name: string;
  namespaced_name: string;
  description: string;
}

export interface MCPServerProbeResult {
  server_id: string;
  success: boolean;
  tools?: MCPToolInfo[];
  error?: string;
}

// =============================================================================
// Dynamic Agent Types
// =============================================================================

export interface DynamicAgentConfig {
  _id: string;
  name: string;
  description?: string;
  system_prompt: string;
  agents_md?: string;
  extension_prompt?: string;
  allowed_tools: Record<string, string[]>;  // server_id -> tool names (empty = all)
  model_id?: string;
  visibility: VisibilityType;
  shared_with_teams?: string[];
  enabled: boolean;
  owner_id: string;
  is_system: boolean;
  created_at: string;
  updated_at: string;
}

export interface DynamicAgentConfigCreate {
  name: string;
  description?: string;
  system_prompt: string;
  agents_md?: string;
  extension_prompt?: string;
  allowed_tools?: Record<string, string[]>;
  model_id?: string;
  visibility?: VisibilityType;
  shared_with_teams?: string[];
  enabled?: boolean;
}

export interface DynamicAgentConfigUpdate {
  name?: string;
  description?: string;
  system_prompt?: string;
  agents_md?: string;
  extension_prompt?: string;
  allowed_tools?: Record<string, string[]>;
  model_id?: string;
  visibility?: VisibilityType;
  shared_with_teams?: string[];
  enabled?: boolean;
}

// =============================================================================
// Chat Types
// =============================================================================

export interface ChatRequest {
  message: string;
  conversation_id: string;
  agent_id: string;
}

export interface ChatEvent {
  type: 'content' | 'tool_start' | 'tool_end' | 'error' | 'done';
  data?: string | Record<string, unknown>;
}

// =============================================================================
// API Response Types
// =============================================================================

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  total_pages: number;
}
