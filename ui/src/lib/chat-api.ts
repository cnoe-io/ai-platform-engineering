/**
 * Chat API Client for MongoDB Backend
 *
 * Provides methods to interact with MongoDB-backed chat history API.
 */

export interface User {
  _id: string;
  email: string;
  name: string;
  avatar_url?: string;
  preferences?: UserPreferences;
  created_at: string;
  last_login: string;
}

export interface UserPreferences {
  theme?: "light" | "dark" | "system";
  font_family?: string;
  notifications_enabled?: boolean;
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  turn_id?: string;
  is_final?: boolean;
  feedback?: MessageFeedback;
}

export interface MessageFeedback {
  rating?: "positive" | "negative";
  comment?: string;
  timestamp?: string;
}

export interface SharedUser {
  user_id: string;
  user_email: string;
  shared_at: string;
  shared_by: string;
  permissions: string[];
}

export interface Conversation {
  _id: string;
  title: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  messages: Message[];
  shared_with: SharedUser[];
  visibility: "private" | "shared";
  tags?: string[];
}

export interface CreateConversationRequest {
  title?: string;
  message: string;
}

export interface UpdateConversationRequest {
  title?: string;
}

export interface AddMessageRequest {
  role: "user" | "assistant";
  content: string;
  turn_id?: string;
  is_final?: boolean;
}

export interface ShareConversationRequest {
  user_emails: string[];
  permissions: string[];
}

export interface ShareStatus {
  conversation_id: string;
  is_owner: boolean;
  shared_with: SharedUser[];
  visibility: "private" | "shared";
}

export interface ConversationListResponse {
  conversations: Conversation[];
  total: number;
  page: number;
  page_size: number;
}

export interface Notification {
  _id: string;
  recipient_id: string;
  type: "conversation_shared";
  status: "unread" | "read" | "archived";
  created_at: string;
  data: {
    shared_by: {
      user_id: string;
      name: string;
      email: string;
      avatar_url?: string;
    };
    conversation: {
      id: string;
      title: string;
    };
    permissions: string[];
  };
  message: string;
  link: string;
}

export class ChatAPIClient {
  private baseUrl: string;
  private accessToken?: string;

  constructor(baseUrl: string = "/api", accessToken?: string) {
    this.baseUrl = baseUrl;
    this.accessToken = accessToken;
  }

  setAccessToken(token: string) {
    this.accessToken = token;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const headers: HeadersInit = {
      "Content-Type": "application/json",
      ...options.headers,
    };

    if (this.accessToken) {
      headers["Authorization"] = `Bearer ${this.accessToken}`;
    }

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: response.statusText }));
      throw new Error(error.detail || `HTTP ${response.status}: ${response.statusText}`);
    }

    return response.json();
  }

  // ============================================================================
  // Conversations
  // ============================================================================

  async createConversation(data: CreateConversationRequest): Promise<Conversation> {
    return this.request<Conversation>("/chat/conversations", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async getConversation(conversationId: string): Promise<Conversation> {
    return this.request<Conversation>(`/chat/conversations/${conversationId}`);
  }

  async listConversations(
    page: number = 1,
    page_size: number = 50,
    filter?: "owned" | "shared" | "all"
  ): Promise<ConversationListResponse> {
    const params = new URLSearchParams({
      page: page.toString(),
      page_size: page_size.toString(),
    });
    if (filter) {
      params.append("filter", filter);
    }
    return this.request<ConversationListResponse>(
      `/chat/conversations?${params.toString()}`
    );
  }

  async updateConversation(
    conversationId: string,
    data: UpdateConversationRequest
  ): Promise<Conversation> {
    return this.request<Conversation>(`/chat/conversations/${conversationId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async deleteConversation(conversationId: string): Promise<void> {
    await this.request<void>(`/chat/conversations/${conversationId}`, {
      method: "DELETE",
    });
  }

  // ============================================================================
  // Messages
  // ============================================================================

  async addMessage(
    conversationId: string,
    data: AddMessageRequest
  ): Promise<Conversation> {
    return this.request<Conversation>(
      `/chat/conversations/${conversationId}/messages`,
      {
        method: "POST",
        body: JSON.stringify(data),
      }
    );
  }

  // ============================================================================
  // Sharing
  // ============================================================================

  async shareConversation(
    conversationId: string,
    data: ShareConversationRequest
  ): Promise<ShareStatus> {
    return this.request<ShareStatus>(
      `/chat/conversations/${conversationId}/share`,
      {
        method: "POST",
        body: JSON.stringify(data),
      }
    );
  }

  async getShareStatus(conversationId: string): Promise<ShareStatus> {
    return this.request<ShareStatus>(
      `/chat/conversations/${conversationId}/share`
    );
  }

  async removeShare(
    conversationId: string,
    userId?: string
  ): Promise<{ success: boolean; message: string }> {
    const endpoint = userId
      ? `/chat/conversations/${conversationId}/share/${userId}`
      : `/chat/conversations/${conversationId}/share`;
    
    return this.request<{ success: boolean; message: string }>(endpoint, {
      method: "DELETE",
    });
  }

  // ============================================================================
  // User Profile & Preferences
  // ============================================================================

  async getCurrentUser(): Promise<User> {
    return this.request<User>("/users/me");
  }

  async updatePreferences(
    preferences: Partial<UserPreferences>
  ): Promise<User> {
    return this.request<User>("/users/me/preferences", {
      method: "PUT",
      body: JSON.stringify(preferences),
    });
  }

  // ============================================================================
  // Notifications
  // ============================================================================

  async getNotifications(
    status?: "unread" | "read" | "archived",
    limit: number = 50
  ): Promise<{ notifications: Notification[] }> {
    const params = new URLSearchParams({ limit: limit.toString() });
    if (status) {
      params.append("status", status);
    }
    return this.request<{ notifications: Notification[] }>(
      `/notifications?${params.toString()}`
    );
  }

  async getUnreadCount(): Promise<{ count: number }> {
    return this.request<{ count: number }>("/notifications/unread/count");
  }

  async markNotificationAsRead(
    notificationId: string
  ): Promise<{ success: boolean; message: string }> {
    return this.request<{ success: boolean; message: string }>(
      `/notifications/${notificationId}/read`,
      { method: "PUT" }
    );
  }

  async markAllNotificationsAsRead(): Promise<{
    success: boolean;
    message: string;
    count: number;
  }> {
    return this.request<{
      success: boolean;
      message: string;
      count: number;
    }>("/notifications/mark-all-read", { method: "PUT" });
  }

  async deleteNotification(
    notificationId: string
  ): Promise<{ success: boolean; message: string }> {
    return this.request<{ success: boolean; message: string }>(
      `/notifications/${notificationId}`,
      { method: "DELETE" }
    );
  }
}

// Singleton instance
let chatAPIInstance: ChatAPIClient | null = null;

export function getChatAPI(accessToken?: string): ChatAPIClient {
  if (!chatAPIInstance) {
    chatAPIInstance = new ChatAPIClient("/api", accessToken);
  } else if (accessToken) {
    chatAPIInstance.setAccessToken(accessToken);
  }
  return chatAPIInstance;
}
