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
// Built-in Tools Types
// =============================================================================

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
 * Configuration for all built-in tools available to dynamic agents.
 */
export interface BuiltinToolsConfig {
  fetch_url?: FetchUrlToolConfig;
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
  agents_md?: string;
  extension_prompt?: string;
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
  created_at: string;
  updated_at: string;
}

export interface DynamicAgentConfigCreate {
  id: string;  // Required: User-friendly slug ID derived from name
  name: string;
  description?: string;
  system_prompt: string;
  agents_md?: string;
  extension_prompt?: string;
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
  agents_md?: string;
  extension_prompt?: string;
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
