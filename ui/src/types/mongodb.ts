// MongoDB collection type definitions

import { ObjectId } from 'mongodb';

// ============================================================================
// User Collection
// ============================================================================

export interface User {
  _id?: ObjectId;
  email: string;
  name: string;
  keycloak_sub?: string;
  avatar_url?: string;
  created_at: Date;
  updated_at: Date;
  last_login: Date;
  favorites?: string[]; // Array of agent config IDs
  metadata: {
    sso_provider: string;
    sso_id: string;
    keycloak_sub?: string;
    role: 'user' | 'admin';
  };
}

export interface UserPublicInfo {
  email: string;
  name: string;
  avatar_url?: string;
}

// ============================================================================
// Conversation Collection
// ============================================================================

/** Valid client types for conversation creation. */
export type ClientType = 'webui' | 'slack' | 'webex';

/** All valid client_type values — used for runtime validation. */
export const VALID_CLIENT_TYPES: readonly ClientType[] = ['webui', 'slack', 'webex'] as const;

/**
 * A conversation participant — either an agent or a user.
 *
 * For now each conversation has one owner (user) and optionally one agent.
 * In the future this can grow to multiple agents or collaborating users.
 */
export interface Participant {
  type: 'agent' | 'user';
  id: string; // agent config ID (for agents) or user email (for users)
}

export interface Conversation {
  _id: string; // UUID for shareable links (server-generated)
  title: string;
  client_type: ClientType; // Top-level: 'webui' | 'slack' (promoted from metadata)
  owner_id: string; // User email
  owner_subject?: string; // Keycloak subject for schema-versioned ownership checks
  owner_identity_version?: number; // 2 when owner_subject has been normalized
  idempotency_key?: string; // Maps integration-specific identity (e.g. Slack thread_ts) to conversation_id used by UI/checkpoints
  participants: Participant[]; // Agents and users involved in this conversation
  created_at: Date;
  updated_at: Date;
  metadata: Record<string, unknown> & {
    /** @deprecated Use top-level client_type instead. Kept for backward compat reads. */
    client_type?: string;
    /** UI version (from package.json) when client_type is 'webui' */
    ui_version?: string;
    total_messages: number;
    total_tokens?: number;
    /** @deprecated Kept for backward compat with old conversations */
    agent_version?: string;
    /** @deprecated Kept for backward compat with old conversations */
    model_used?: string;
    owner_identity_migration?: {
      migration_id: string;
      migrated_at: string;
      migrated_by: string;
      source_field: 'owner_id';
    };
  };
  sharing: {
    is_public: boolean;
    public_permission?: 'view' | 'comment'; // Permission for public shares (default: comment)
    shared_with: string[]; // Array of user emails
    shared_with_teams: string[]; // Array of team IDs
    team_permissions?: Record<string, 'view' | 'comment'>; // Per-team permission
    share_link_enabled: boolean;
    share_link_expires?: Date;
  };
  tags: string[];
  is_archived: boolean;
  is_pinned: boolean;
  deleted_at?: Date | null; // Soft-delete timestamp; null = not deleted; auto-purged after 7 days
  /**
   * Set ONLY when the conversation was created by a service account (session.isServiceAccount).
   * Stores the SA's Keycloak sub (session.sub). Used by the audit/reconcile step to
   * backfill missing `service_account:<sub> writer conversation:<id>` OpenFGA grants.
   * Never set for normal user-created conversations.
   */
  created_by_service_account?: string;
}

// ============================================================================
// Message Collection
// ============================================================================

export interface Message {
  _id?: ObjectId;
  message_id?: string; // Client-generated ID for cross-reference
  conversation_id: string;
  owner_id?: string; // User email — denormalized from conversation for analytics queries
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: Date;
  // Sender identity — tracks who actually typed this message.
  // Distinct from owner_id (conversation creator). Required for shared conversations
  // where multiple users can send messages. All fields are optional for backward
  // compatibility with messages created before this feature.
  sender_email?: string;
  sender_name?: string;
  sender_image?: string;
  metadata: {
    turn_id: string;
    source?: string;
    model?: string;
    tokens_used?: number;
    latency_ms?: number;
    agent_name?: string;
    is_final?: boolean;
    timeline_segments?: any[]; // TimelineSegment[] persisted for plan/thinking/answer reconstruction
  };
  artifacts?: Artifact[];
  stream_events?: any[]; // Protocol-agnostic stream events for Dynamic Agents (tool_start, tool_end, etc.)
  feedback?: MessageFeedback;
}

export interface Artifact {
  type: string;
  name: string;
  data: Record<string, any>;
}

export interface MessageFeedback {
  rating: 'positive' | 'negative';
  comment?: string;
  submitted_at: Date;
}

// ============================================================================
// Turns Collection
// ============================================================================

/**
 * A turn represents one user-message / assistant-response exchange in a
 * conversation. The payload is opaque to the server — each client type
 * (UI, Slack, Webex) stores its own structure.
 *
 * For the web UI the payload contains collapsed stream_events (timeline data)
 * plus message IDs for cross-referencing with the messages collection.
 */
export interface Turn {
  _id?: ObjectId;
  conversation_id: string;      // = LangGraph thread_id
  turn_id: string;              // Client-generated turn identifier
  client_type: string;          // "ui" | "slack" | "webex" | ...
  payload: Record<string, unknown>; // Opaque, client-specific
  created_at: Date;
  updated_at: Date;
}

/** Request body for POST /api/chat/conversations/:id/turns */
export interface UpsertTurnRequest {
  turn_id: string;
  client_type: string;
  payload: Record<string, unknown>;
}

// ============================================================================
// User Settings Collection
// ============================================================================

export interface UserSettings {
  _id?: ObjectId;
  user_id: string; // User email
  preferences: {
    theme: 'light' | 'dark' | 'system' | 'midnight' | 'nord' | 'tokyo';
    gradient_theme: 'default' | 'minimal' | 'professional' | 'ocean' | 'sunset';
    font_family: 'inter' | 'source-sans' | 'ibm-plex' | 'system';
    font_size: 'small' | 'medium' | 'large' | 'x-large';
    sidebar_collapsed: boolean;
    context_panel_visible: boolean;
    debug_mode: boolean;
    code_theme: string;
    memory_enabled: string;
    debug_mode_enabled: string;
    show_thinking_enabled: string;
    auto_scroll_enabled: string;
    show_timestamps_enabled: string;
    releaseNotesDismissedVersions?: string[];
    releaseNotesDismissedAnnouncementIds?: string[];
  };
  notifications: {
    email_enabled: boolean;
    in_app_enabled: boolean;
    conversation_shared: boolean;
    weekly_summary: boolean;
  };
  defaults: {
    default_model: string;
    default_agent_mode: string;
    auto_title_conversations: boolean;
  };
  updated_at: Date;
}

// Default settings for new users
export const DEFAULT_USER_SETTINGS: Omit<UserSettings, '_id' | 'user_id' | 'updated_at'> = {
  preferences: {
    theme: 'dark',
    gradient_theme: 'default',
    font_family: 'inter',
    font_size: 'medium',
    sidebar_collapsed: false,
    context_panel_visible: true,
    debug_mode: false,
    code_theme: 'onedark',
    memory_enabled: 'true',
    debug_mode_enabled: 'false',
    show_thinking_enabled: 'true',
    auto_scroll_enabled: 'true',
    show_timestamps_enabled: 'false',
  },
  notifications: {
    email_enabled: true,
    in_app_enabled: true,
    conversation_shared: true,
    weekly_summary: false,
  },
  defaults: {
    default_model: 'gpt-4o',
    default_agent_mode: 'auto',
    auto_title_conversations: true,
  },
};

// ============================================================================
// Conversation Bookmarks Collection
// ============================================================================

export interface ConversationBookmark {
  _id?: ObjectId;
  user_id: string;
  conversation_id: string;
  message_id?: string;
  note?: string;
  created_at: Date;
}

// ============================================================================
// Sharing Access Collection
// ============================================================================

export interface SharingAccess {
  _id?: ObjectId;
  conversation_id: string;
  granted_by: string;
  granted_to: string;
  permission: 'view' | 'comment';
  granted_at: Date;
  accessed_at?: Date;
  revoked_at?: Date;
}

// ============================================================================
// API Request/Response Types
// ============================================================================

// Conversation API
export interface CreateConversationRequest {
  title: string;
  client_type: ClientType; // Required: 'webui' | 'slack'
  agent_id?: string; // Optional: builds participants with this agent
  owner_id?: string; // Optional: trusted callers (e.g. Slack bot) can set on behalf of user
  idempotency_key?: string; // Maps integration-specific identity (e.g. Slack thread_ts) to conversation_id used by UI/checkpoints
  metadata?: Record<string, unknown>; // Optional: arbitrary key/values from client
  tags?: string[];
}

/** Response from POST /api/chat/conversations */
export interface CreateConversationResponse {
  conversation: Conversation;
  created: boolean; // true = new, false = existing (upsert matched)
}

export interface UpdateConversationRequest {
  title?: string;
  tags?: string[];
  is_archived?: boolean;
  is_pinned?: boolean;
}

export interface PatchConversationMetadataRequest {
  metadata: Record<string, unknown>;
}

export interface ShareConversationRequest {
  user_emails?: string[];
  team_ids?: string[];
  permission: 'view' | 'comment';
  enable_link?: boolean;
  link_expires?: string; // ISO date string
  is_public?: boolean;
  public_permission?: 'view' | 'comment'; // Permission when is_public is true
}

// Message API
export interface AddMessageRequest {
  message_id?: string; // Client-generated ID for cross-reference
  role: 'user' | 'assistant' | 'system';
  content: string;
  // Sender identity for shared conversations (optional for backward compatibility)
  sender_email?: string;
  sender_name?: string;
  sender_image?: string;
  metadata?: {
    turn_id: string;
    model?: string;
    tokens_used?: number;
    latency_ms?: number;
    agent_name?: string;
    is_final?: boolean;
    turn_status?: string; // "done" | "interrupted" | "waiting_for_input"
    is_interrupted?: boolean;
    task_id?: string;
    timeline_segments?: any[]; // TimelineSegment[] for plan/thinking/answer reconstruction
  };
  artifacts?: Artifact[];
  stream_events?: any[]; // Protocol-agnostic stream events for Dynamic Agents (tool_start, tool_end, etc.)
}

export interface UpdateMessageRequest {
  /** Update message content (e.g., after streaming completes with final content) */
  content?: string;
  /** Update metadata fields (e.g., is_final after streaming completes) */
  metadata?: {
    is_final?: boolean;
    is_interrupted?: boolean;
    task_id?: string;
    turn_id?: string;
  };
  /** Update message feedback (rating + optional comment) */
  feedback?: Pick<MessageFeedback, 'rating' | 'comment'>;
}

// Bookmark API
export interface CreateBookmarkRequest {
  conversation_id: string;
  message_id?: string;
  note?: string;
}

// User API
export interface UpdateUserRequest {
  name?: string;
  avatar_url?: string;
}

// Settings API
export interface UpdateSettingsRequest {
  preferences?: Partial<UserSettings['preferences']>;
  notifications?: Partial<UserSettings['notifications']>;
  defaults?: Partial<UserSettings['defaults']>;
}

// ============================================================================
// API Response Types
// ============================================================================

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  has_more: boolean;
}

export interface UserStats {
  total_conversations: number;
  total_messages: number;
  conversations_this_week: number;
  messages_this_week: number;
  favorite_agents: Array<{ name: string; count: number }>;
}

export interface UserActivity {
  timestamp: Date;
  action: string;
  resource_type: 'conversation' | 'message' | 'settings' | 'share';
  resource_id: string;
  details?: Record<string, any>;
}

// ============================================================================
// Audit Log Types (Admin-only)
// ============================================================================

export interface AuditConversation extends Conversation {
  message_count: number;
  last_message_at?: Date;
  status: 'active' | 'archived' | 'deleted';
}

export interface AuditLogFilters {
  owner_email?: string;
  search?: string;
  date_from?: string;
  date_to?: string;
  include_deleted?: boolean;
  status?: 'active' | 'archived' | 'deleted';
}

// ============================================================================
// Webex Bot Collections
// ============================================================================

/** Single-use nonce for Webex user ↔ Keycloak linking (expires after 10 minutes). */
export interface WebexLinkNonce {
  nonce: string;
  webex_user_id: string;
  created_at: Date;
  consumed?: boolean;
}

/** Operational metrics for Webex bot usage (space-level aggregates). */
export interface WebexUserMetrics {
  webex_user_id: string;
  workspace_id?: string;
  space_id?: string;
  event_count?: number;
  last_seen_at?: string;
  updated_at?: string;
}

// ============================================================================
// Service Accounts Collection
// ============================================================================
//
// Spec: docs/docs/specs/2026-06-05-service-accounts/data-model.md
//
// Three stores of record:
//   - Keycloak  → owns the confidential client + secret (the credential / identity)
//   - OpenFGA   → owns tuples on service_account:<sub> (access: ownership + scopes)
//   - MongoDB   → owns this document (display metadata only — NOT authoritative)
//
// The Mongo doc is a convenience/index layer. Access decisions never read it;
// they read OpenFGA. NO credential material is persisted here — no secret, no
// hash (contrast catalog_api_keys, which stores a hash). Keycloak owns the
// secret entirely and shows it once.

/** A single agent/tool grant snapshot. Display cache only — OpenFGA tuples are
 *  the source of truth for access. */
export interface ServiceAccountScope {
  type: 'agent' | 'tool';
  /** For agent: the agent id. For tool: "<server>/<toolname>" or "<server>/*". */
  ref: string;
  added_by: string; // Keycloak sub of who added this scope (audit).
  added_at: Date;
}

/** A user-minted machine identity backed by a dynamic Keycloak confidential
 *  client. Owned by a single team; managed by any member of that team. */
export interface ServiceAccount {
  _id?: ObjectId;
  sa_sub: string; // Keycloak service-account-user UUID — the OpenFGA subject id. UNIQUE.
  client_id: string; // Keycloak clientId, e.g. "caipe-sa-incident-bot-a1b2c3". UNIQUE.
  client_uuid: string; // Keycloak internal client UUID (for admin API calls: secret/delete).
  name: string; // Human-friendly name, unique among ACTIVE SAs within owning_team_id.
  description?: string;
  owning_team_id: string; // The single owning team (team slug/id used in OpenFGA team:<id>).
  created_by: string; // Keycloak sub of the creating user (audit/display).
  created_at: Date;
  status: 'active' | 'revoked';
  revoked_at?: Date | null;
  // Display cache ONLY — not authoritative. OpenFGA tuples are the source of truth for access.
  scopes_snapshot?: ServiceAccountScope[];
  /**
   * True only for the platform-wide unlinked service account bootstrapped at
   * startup. Used as a stable resolver flag: `{ is_platform_unlinked: true,
   * status: "active" }`. Never set on user-created SAs.
   * See: ui/src/lib/rbac/unlinked-service-account.ts (C2 contract).
   */
  is_platform_unlinked?: boolean;
}

/**
 * A "protected" service account cannot be revoked/deleted or moved to another
 * owning team. For now this is hardcoded to the platform unlinked SA; there is
 * no UI/API to set or unset it yet. Centralized here so backend guards and the
 * UI agree on the rule.
 */
export function isProtectedServiceAccount(
  sa: Pick<ServiceAccount, "is_platform_unlinked">,
): boolean {
  return sa.is_platform_unlinked === true;
}
