// MongoDB collection type definitions

import { ObjectId } from 'mongodb';

// ============================================================================
// User Collection
// ============================================================================

export interface User {
  _id?: ObjectId;
  email: string;
  name: string;
  avatar_url?: string;
  created_at: Date;
  updated_at: Date;
  last_login: Date;
  favorites?: string[]; // Array of agent config IDs
  metadata: {
    sso_provider: string;
    sso_id: string;
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

export interface Conversation {
  _id: string; // UUID for shareable links
  title: string;
  owner_id: string; // User email
  created_at: Date;
  updated_at: Date;
  metadata: {
    agent_version: string;
    model_used: string;
    total_messages: number;
    total_tokens?: number;
  };
  sharing: {
    is_public: boolean;
    shared_with: string[]; // Array of user emails
    shared_with_teams: string[]; // Array of team IDs
    share_link_enabled: boolean;
    share_link_expires?: Date;
  };
  tags: string[];
  is_archived: boolean;
  is_pinned: boolean;
  deleted_at?: Date | null; // Soft-delete timestamp; null = not deleted; auto-purged after 7 days
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
    model?: string;
    tokens_used?: number;
    latency_ms?: number;
    agent_name?: string;
    is_final?: boolean;
  };
  artifacts?: Artifact[];
  a2a_events?: any[]; // A2A events (tasks, tool calls, debug) serialized for persistence
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
  id?: string; // Client-generated UUID — ensures client and server share the same ID
  title: string;
  tags?: string[];
}

export interface UpdateConversationRequest {
  title?: string;
  tags?: string[];
  is_archived?: boolean;
  is_pinned?: boolean;
}

export interface ShareConversationRequest {
  user_emails?: string[];
  team_ids?: string[];
  permission: 'view' | 'comment';
  enable_link?: boolean;
  link_expires?: string; // ISO date string
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
  };
  artifacts?: Artifact[];
  a2a_events?: any[]; // A2A events (tasks, tool calls, debug)
}

export interface UpdateMessageRequest {
  feedback?: {
    rating: 'positive' | 'negative';
    comment?: string;
  };
  /** Update message content (e.g., after streaming completes with final content) */
  content?: string;
  /** Update metadata fields (e.g., is_final after streaming completes) */
  metadata?: {
    is_final?: boolean;
    is_interrupted?: boolean;
    task_id?: string;
    turn_id?: string;
  };
  /** Update A2A events (e.g., after streaming completes with full event history) */
  a2a_events?: any[];
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
  total_tokens_used: number;
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
