// Client-side API SDK for calling MongoDB backend APIs

import type {
  Conversation,
  Message,
  User,
  UserSettings,
  CreateConversationRequest,
  UpdateConversationRequest,
  ShareConversationRequest,
  AddMessageRequest,
  UpdateMessageRequest,
  CreateBookmarkRequest,
  UpdateUserRequest,
  UpdateSettingsRequest,
  ApiResponse,
  PaginatedResponse,
  UserStats,
  ConversationBookmark,
  UserPublicInfo,
} from '@/types/mongodb';

class APIClient {
  private baseURL: string;

  constructor(baseURL: string = '') {
    this.baseURL = baseURL;
  }

  private async request<T>(
    endpoint: string,
    options?: RequestInit
  ): Promise<T> {
    const url = `${this.baseURL}${endpoint}`;
    console.log(`[APIClient] Making request to: ${url}`);
    
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });

    console.log(`[APIClient] Response status: ${response.status} ${response.statusText}`);

    if (!response.ok) {
      const errorText = await response.text();
      
      // Don't log 401 errors as errors - they're expected when auth is not configured
      if (response.status === 401) {
        console.log(`[APIClient] Authentication required for ${endpoint} - user not logged in`);
      } else {
        console.error(`[APIClient] Error response:`, {
          status: response.status,
          statusText: response.statusText,
          body: errorText
        });
      }
      
      let error;
      try {
        error = JSON.parse(errorText);
      } catch {
        error = { error: response.statusText || errorText };
      }
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    const responseText = await response.text();
    console.log(`[APIClient] Response body:`, responseText.substring(0, 500));
    
    let result: ApiResponse<T>;
    try {
      result = JSON.parse(responseText);
    } catch (parseError) {
      console.error(`[APIClient] Failed to parse JSON:`, {
        error: parseError,
        responseText: responseText.substring(0, 500)
      });
      throw new Error('Invalid JSON response from server');
    }

    console.log(`[APIClient] Parsed result:`, {
      success: result.success,
      hasData: !!result.data,
      dataType: typeof result.data,
      error: result.error
    });

    if (!result.success) {
      throw new Error(result.error || 'Request failed');
    }

    if (result.data === undefined || result.data === null) {
      console.error(`[APIClient] Result data is undefined/null:`, {
        result,
        success: result.success,
        error: result.error,
        hasData: result.data !== undefined,
        dataValue: result.data
      });
      throw new Error(result.error || 'Response data is undefined');
    }

    console.log(`[APIClient] Returning data:`, {
      dataType: typeof result.data,
      isArray: Array.isArray(result.data),
      keys: result.data ? Object.keys(result.data) : [],
      preview: JSON.stringify(result.data).substring(0, 200)
    });

    return result.data as T;
  }

  // ========================================================================
  // Conversations
  // ========================================================================

  async getConversations(params?: {
    page?: number;
    page_size?: number;
    archived?: boolean;
    pinned?: boolean;
  }): Promise<PaginatedResponse<Conversation>> {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set('page', params.page.toString());
    if (params?.page_size) searchParams.set('page_size', params.page_size.toString());
    if (params?.archived !== undefined) searchParams.set('archived', params.archived.toString());
    if (params?.pinned !== undefined) searchParams.set('pinned', params.pinned.toString());

    return this.request(`/api/chat/conversations?${searchParams}`);
  }

  async createConversation(
    data: CreateConversationRequest
  ): Promise<Conversation> {
    return this.request('/api/chat/conversations', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getConversation(id: string): Promise<Conversation> {
    return this.request(`/api/chat/conversations/${id}`);
  }

  async updateConversation(
    id: string,
    data: UpdateConversationRequest
  ): Promise<Conversation> {
    return this.request(`/api/chat/conversations/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteConversation(id: string): Promise<{ deleted: boolean }> {
    return this.request(`/api/chat/conversations/${id}`, {
      method: 'DELETE',
    });
  }

  async archiveConversation(id: string): Promise<Conversation> {
    return this.request(`/api/chat/conversations/${id}/archive`, {
      method: 'POST',
    });
  }

  async pinConversation(id: string): Promise<Conversation> {
    return this.request(`/api/chat/conversations/${id}/pin`, {
      method: 'POST',
    });
  }

  // ========================================================================
  // Messages
  // ========================================================================

  async getMessages(
    conversationId: string,
    params?: { page?: number; page_size?: number }
  ): Promise<PaginatedResponse<Message>> {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set('page', params.page.toString());
    if (params?.page_size) searchParams.set('page_size', params.page_size.toString());

    return this.request(
      `/api/chat/conversations/${conversationId}/messages?${searchParams}`
    );
  }

  async addMessage(
    conversationId: string,
    data: AddMessageRequest
  ): Promise<Message> {
    return this.request(`/api/chat/conversations/${conversationId}/messages`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateMessage(
    messageId: string,
    data: UpdateMessageRequest
  ): Promise<Message> {
    return this.request(`/api/chat/messages/${messageId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  // ========================================================================
  // Sharing
  // ========================================================================

  async shareConversation(
    conversationId: string,
    data: ShareConversationRequest
  ): Promise<Conversation> {
    return this.request(`/api/chat/conversations/${conversationId}/share`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getSharedConversations(params?: {
    page?: number;
    page_size?: number;
  }): Promise<PaginatedResponse<Conversation>> {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set('page', params.page.toString());
    if (params?.page_size) searchParams.set('page_size', params.page_size.toString());

    return this.request(`/api/chat/shared?${searchParams}`);
  }

  // ========================================================================
  // Bookmarks
  // ========================================================================

  async getBookmarks(params?: {
    page?: number;
    page_size?: number;
  }): Promise<PaginatedResponse<ConversationBookmark>> {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set('page', params.page.toString());
    if (params?.page_size) searchParams.set('page_size', params.page_size.toString());

    return this.request(`/api/chat/bookmarks?${searchParams}`);
  }

  async createBookmark(data: CreateBookmarkRequest): Promise<ConversationBookmark> {
    return this.request('/api/chat/bookmarks', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // ========================================================================
  // Search
  // ========================================================================

  async searchConversations(params: {
    q?: string;
    tags?: string[];
    page?: number;
    page_size?: number;
  }): Promise<PaginatedResponse<Conversation>> {
    const searchParams = new URLSearchParams();
    if (params.q) searchParams.set('q', params.q);
    if (params.tags?.length) searchParams.set('tags', params.tags.join(','));
    if (params.page) searchParams.set('page', params.page.toString());
    if (params.page_size) searchParams.set('page_size', params.page_size.toString());

    return this.request(`/api/chat/search?${searchParams}`);
  }

  // ========================================================================
  // Users
  // ========================================================================

  async getCurrentUser(): Promise<User> {
    return this.request('/api/users/me');
  }

  async updateCurrentUser(data: UpdateUserRequest): Promise<User> {
    return this.request('/api/users/me', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async searchUsers(query: string): Promise<UserPublicInfo[]> {
    const searchParams = new URLSearchParams({ q: query });
    return this.request(`/api/users/search?${searchParams}`);
  }

  async getUserStats(): Promise<UserStats> {
    return this.request('/api/users/me/stats');
  }

  // ========================================================================
  // Settings
  // ========================================================================

  async getSettings(): Promise<UserSettings> {
    return this.request('/api/settings');
  }

  async updateSettings(data: UpdateSettingsRequest): Promise<UserSettings> {
    return this.request('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async updatePreferences(
    preferences: Partial<UserSettings['preferences']>
  ): Promise<UserSettings> {
    return this.request('/api/settings/preferences', {
      method: 'PATCH',
      body: JSON.stringify(preferences),
    });
  }

  async updateNotifications(
    notifications: Partial<UserSettings['notifications']>
  ): Promise<UserSettings> {
    return this.request('/api/settings/notifications', {
      method: 'PATCH',
      body: JSON.stringify(notifications),
    });
  }

  async updateDefaults(
    defaults: Partial<UserSettings['defaults']>
  ): Promise<UserSettings> {
    return this.request('/api/settings/defaults', {
      method: 'PATCH',
      body: JSON.stringify(defaults),
    });
  }
}

// Export singleton instance
export const apiClient = new APIClient();
