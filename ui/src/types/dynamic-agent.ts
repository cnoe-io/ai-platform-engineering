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
  config_driven?: boolean;  // Whether loaded from config.yaml (not editable)
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
// Built-in Tools Types
// =============================================================================

/**
 * Definition of a configurable field for a built-in tool.
 * Returned by the /api/v1/builtin-tools endpoint.
 */
export interface BuiltinToolConfigField {
  name: string;           // Field name (e.g., 'allowed_domains')
  type: 'string' | 'number' | 'boolean';
  label: string;          // Display label for UI
  description: string;    // Help text for users
  default?: string | number | boolean;  // Default value
  required?: boolean;
}

/**
 * Definition of a built-in tool returned by the API.
 */
export interface BuiltinToolDefinition {
  id: string;             // Tool identifier (e.g., 'fetch_url')
  name: string;           // Display name
  description: string;    // What the tool does
  enabled_by_default: boolean;
  config_fields: BuiltinToolConfigField[];
}

/**
 * Configuration for the fetch_url built-in tool.
 */
export interface FetchUrlToolConfig {
  enabled: boolean;
  /** 
   * Comma-separated domain patterns.
   * - "*" allows all domains
   * - "*.cisco.com" allows any subdomain of cisco.com
   * - "cisco.com" allows only the exact domain
   * - Empty string blocks all domains
   */
  allowed_domains: string;
}

/**
 * Configuration for the current_datetime built-in tool.
 */
export interface CurrentDatetimeToolConfig {
  enabled: boolean;
}

/**
 * Configuration for the user_info built-in tool.
 */
export interface UserInfoToolConfig {
  enabled: boolean;
}

/**
 * Configuration for the sleep built-in tool.
 */
export interface SleepToolConfig {
  enabled: boolean;
  max_seconds?: number;  // Maximum sleep duration in seconds (default: 300)
}

/**
 * Configuration for all built-in tools available to dynamic agents.
 * Each tool config is optional - if not present, tool uses defaults.
 */
export interface BuiltinToolsConfig {
  fetch_url?: FetchUrlToolConfig;
  current_datetime?: CurrentDatetimeToolConfig;
  user_info?: UserInfoToolConfig;
  sleep?: SleepToolConfig;
  // Allow dynamic tool configs for future extensibility
  [key: string]: { enabled: boolean; [field: string]: unknown } | undefined;
}

// =============================================================================
// Dynamic Agent Types
// =============================================================================

/**
 * Reference to another dynamic agent to use as a subagent.
 * When configured, the parent agent can delegate tasks to this subagent.
 */
export interface SubAgentRef {
  agent_id: string;     // MongoDB ObjectId of the subagent
  name: string;         // Routing identifier (e.g., 'code-reviewer')
  description: string;  // Description for LLM routing decisions
}

export interface DynamicAgentConfig {
  _id: string;
  name: string;
  description?: string;
  system_prompt: string;
  allowed_tools: Record<string, string[]>;  // server_id -> tool names (empty = all)
  builtin_tools?: BuiltinToolsConfig;  // Built-in tools configuration
  model_id: string;  // Required: LLM model identifier
  model_provider: string;  // Required: LLM provider (anthropic-claude, openai, etc.)
  visibility: VisibilityType;
  shared_with_teams?: string[];
  subagents: SubAgentRef[];  // Other dynamic agents that can be delegated to
  enabled: boolean;
  owner_id: string;
  is_system: boolean;
  config_driven?: boolean;  // Whether loaded from config.yaml (not editable)
  created_at: string;
  updated_at: string;
}

export interface DynamicAgentConfigCreate {
  id: string;  // Required: User-friendly slug ID derived from name
  name: string;
  description?: string;
  system_prompt: string;
  allowed_tools?: Record<string, string[]>;
  builtin_tools?: BuiltinToolsConfig;
  model_id: string;  // Required: LLM model identifier
  model_provider: string;  // Required: LLM provider
  visibility?: VisibilityType;
  shared_with_teams?: string[];
  subagents?: SubAgentRef[];
  enabled?: boolean;
}

export interface DynamicAgentConfigUpdate {
  name?: string;
  description?: string;
  system_prompt?: string;
  allowed_tools?: Record<string, string[]>;
  builtin_tools?: BuiltinToolsConfig;
  model_id?: string;
  model_provider?: string;
  visibility?: VisibilityType;
  shared_with_teams?: string[];
  subagents?: SubAgentRef[];
  enabled?: boolean;
}

/**
 * Available agent for subagent selection (returned by available-subagents endpoint)
 */
export interface AvailableSubagent {
  id: string;
  name: string;
  description?: string;
  visibility: VisibilityType;
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
