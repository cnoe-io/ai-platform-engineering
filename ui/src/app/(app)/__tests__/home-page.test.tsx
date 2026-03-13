/**
 * Unit tests for the Home Page (app/(app)/page.tsx)
 *
 * Tests:
 * - AuthGuard: wraps page in AuthGuard
 * - Page structure: data-testid, "Powered by caipe.io" footer
 * - Welcome banner: personalized greeting, no preferences shortcut
 * - Capability cards: renders with ragEnabled from config
 * - Recent chats (MongoDB): fetches and displays conversations
 * - Recent chats (MongoDB): shows empty state when no conversations
 * - Shared conversations (MongoDB): fetches from getSharedConversations API
 * - Insights widget (MongoDB): fetches and renders user stats
 * - localStorage mode: hides shared conversations and insights widget
 * - localStorage mode: calls loadConversationsFromServer
 * - Not authenticated: does not fetch
 * - Error handling: handles API failures gracefully
 */

import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'

// ============================================================================
// Mocks — must be before imports
// ============================================================================

const mockSession = {
  data: { user: { name: 'Test User', email: 'test@test.com' } },
  status: 'authenticated' as const,
  update: jest.fn(),
}
jest.mock('next-auth/react', () => ({
  useSession: jest.fn(() => mockSession),
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}))

jest.mock('next/link', () => {
  return React.forwardRef(({ children, href, className, ...props }: any, ref: any) => (
    <a ref={ref} href={href} className={className} data-testid={props['data-testid'] || `link-${href}`} {...props}>
      {children}
    </a>
  ))
})

jest.mock('framer-motion', () => ({
  motion: {
    div: React.forwardRef(({ children, className, ...props }: any, ref: any) => (
      <div ref={ref} className={className} {...props}>{children}</div>
    )),
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}))

jest.mock('@/components/auth-guard', () => ({
  AuthGuard: ({ children }: any) => <div data-testid="auth-guard">{children}</div>,
}))

jest.mock('@/components/ui/scroll-area', () => ({
  ScrollArea: ({ children, ...props }: any) => <div data-testid={props['data-testid'] || 'scroll-area'} {...props}>{children}</div>,
}))

jest.mock('lucide-react', () => ({
  MessageSquare: (props: any) => <svg data-testid="icon-message-square" {...props} />,
  Users2: (props: any) => <svg data-testid="icon-users2" {...props} />,
  Users: (props: any) => <svg data-testid="icon-users" {...props} />,
  Globe: (props: any) => <svg data-testid="icon-globe" {...props} />,
  Clock: (props: any) => <svg data-testid="icon-clock" {...props} />,
  Plus: (props: any) => <svg data-testid="icon-plus" {...props} />,
  Sparkles: (props: any) => <svg data-testid="icon-sparkles" {...props} />,
  Zap: (props: any) => <svg data-testid="icon-zap" {...props} />,
  Database: (props: any) => <svg data-testid="icon-database" {...props} />,
  ArrowRight: (props: any) => <svg data-testid="icon-arrow-right" {...props} />,
  TrendingUp: (props: any) => <svg data-testid="icon-trending-up" {...props} />,
  Bot: (props: any) => <svg data-testid="icon-bot" {...props} />,
  Settings: (props: any) => <svg data-testid="icon-settings" {...props} />,
}))

jest.mock('@/lib/utils', () => ({
  cn: (...args: any[]) => args.filter(Boolean).join(' '),
}))

let mockStorageMode = 'mongodb'
jest.mock('@/lib/storage-config', () => ({
  getStorageMode: () => mockStorageMode,
}))

let mockRagEnabled = true
jest.mock('@/lib/config', () => ({
  config: {
    get ragEnabled() { return mockRagEnabled },
    showPoweredBy: true,
  },
}))

const mockLoadConversationsFromServer = jest.fn()
const mockLocalConversations: any[] = []
jest.mock('@/store/chat-store', () => ({
  useChatStore: () => ({
    conversations: mockLocalConversations,
    loadConversationsFromServer: mockLoadConversationsFromServer,
  }),
}))

// Mock apiClient
const mockGetConversations = jest.fn()
const mockGetSharedConversations = jest.fn()
const mockGetUserStats = jest.fn()
jest.mock('@/lib/api-client', () => ({
  apiClient: {
    getConversations: (...args: any[]) => mockGetConversations(...args),
    getSharedConversations: (...args: any[]) => mockGetSharedConversations(...args),
    getUserStats: (...args: any[]) => mockGetUserStats(...args),
  },
}))

// ============================================================================
// Imports — after mocks
// ============================================================================

import HomePage from '../page'

// ============================================================================
// Helpers
// ============================================================================

function makeConversationItems(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    _id: `conv-${i}`,
    title: `Conversation ${i + 1}`,
    owner_id: 'test@test.com',
    created_at: new Date(),
    updated_at: new Date(Date.now() - i * 3600000),
    metadata: { agent_version: '1.0', model_used: 'gpt-4', total_messages: (i + 1) * 2 },
    sharing: { is_public: false, shared_with: [], shared_with_teams: [], share_link_enabled: false },
    tags: [],
    is_archived: false,
    is_pinned: false,
  }))
}

function makeUserStats(overrides: Record<string, any> = {}) {
  return {
    total_conversations: 42,
    total_messages: 256,
    total_tokens_used: 15000,
    conversations_this_week: 7,
    messages_this_week: 35,
    favorite_agents: [
      { name: 'github', count: 20 },
      { name: 'argocd', count: 10 },
    ],
    ...overrides,
  }
}

function setupMockAPIs(opts: {
  conversations?: any[];
  shared?: any[];
  stats?: any;
} = {}) {
  mockGetConversations.mockResolvedValue({
    items: opts.conversations ?? makeConversationItems(3),
    total: (opts.conversations ?? makeConversationItems(3)).length,
    page: 1,
    page_size: 8,
    has_more: false,
  })
  mockGetSharedConversations.mockResolvedValue({
    items: opts.shared ?? [],
    total: (opts.shared ?? []).length,
    page: 1,
    page_size: 20,
    has_more: false,
  })
  mockGetUserStats.mockResolvedValue(opts.stats ?? makeUserStats())
}

// ============================================================================
// Tests
// ============================================================================

describe('HomePage', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockSession.status = 'authenticated' as const
    mockSession.data = { user: { name: 'Test User', email: 'test@test.com' } } as any
    mockStorageMode = 'mongodb'
    mockRagEnabled = true
    mockLocalConversations.length = 0
  })

  describe('page structure', () => {
    it('wraps the page in AuthGuard', () => {
      setupMockAPIs()
      render(<HomePage />)
      expect(screen.getByTestId('auth-guard')).toBeInTheDocument()
    })

    it('renders with data-testid="home-page"', () => {
      setupMockAPIs()
      render(<HomePage />)
      expect(screen.getByTestId('home-page')).toBeInTheDocument()
    })

    it('renders "Powered by caipe.io" footer', () => {
      setupMockAPIs()
      render(<HomePage />)
      expect(screen.getByText(/Powered by/)).toBeInTheDocument()
      const link = screen.getByText('caipe.io')
      expect(link).toBeInTheDocument()
      expect(link.closest('a')).toHaveAttribute('href', 'https://caipe.io')
      expect(link.closest('a')).toHaveAttribute('target', '_blank')
      expect(link.closest('a')).toHaveAttribute('rel', 'noopener noreferrer')
    })

    it('does not render preferences shortcut on welcome banner', () => {
      setupMockAPIs()
      render(<HomePage />)
      expect(screen.queryByTestId('preferences-shortcut')).not.toBeInTheDocument()
    })
  })

  describe('Welcome banner', () => {
    it('shows personalized greeting with user name', () => {
      setupMockAPIs()
      render(<HomePage />)
      expect(screen.getByTestId('welcome-banner')).toBeInTheDocument()
      expect(screen.getByText('Welcome back, Test')).toBeInTheDocument()
    })

    it('shows generic greeting when no session', () => {
      mockSession.data = null as any
      setupMockAPIs()
      render(<HomePage />)
      expect(screen.getByText('Welcome to CAIPE')).toBeInTheDocument()
    })
  })

  describe('Capability cards', () => {
    it('renders capability cards', () => {
      setupMockAPIs()
      render(<HomePage />)
      expect(screen.getByTestId('capability-cards')).toBeInTheDocument()
    })

    it('shows Knowledge Bases when RAG is enabled', () => {
      mockRagEnabled = true
      setupMockAPIs()
      render(<HomePage />)
      expect(screen.getByTestId('capability-card-knowledge-bases')).toBeInTheDocument()
    })

    it('hides Knowledge Bases when RAG is disabled', () => {
      mockRagEnabled = false
      setupMockAPIs()
      render(<HomePage />)
      expect(screen.queryByTestId('capability-card-knowledge-bases')).not.toBeInTheDocument()
    })
  })

  describe('Recent chats (MongoDB mode)', () => {
    it('fetches and renders recent conversations', async () => {
      setupMockAPIs()
      render(<HomePage />)

      await waitFor(() => {
        expect(screen.getByText('Conversation 1')).toBeInTheDocument()
        expect(screen.getByText('Conversation 2')).toBeInTheDocument()
        expect(screen.getByText('Conversation 3')).toBeInTheDocument()
      })
    })

    it('calls getConversations with page_size 8', async () => {
      setupMockAPIs()
      render(<HomePage />)

      await waitFor(() => {
        expect(mockGetConversations).toHaveBeenCalledWith({ page_size: 8 })
      })
    })

    it('shows empty state when no conversations', async () => {
      setupMockAPIs({ conversations: [] })
      render(<HomePage />)

      await waitFor(() => {
        expect(screen.getByTestId('recent-chats-empty')).toBeInTheDocument()
      })
    })
  })

  describe('Shared conversations (MongoDB mode)', () => {
    it('fetches shared conversations', async () => {
      setupMockAPIs()
      render(<HomePage />)

      await waitFor(() => {
        expect(mockGetSharedConversations).toHaveBeenCalledWith({ page_size: 20 })
      })
    })

    it('renders SharedConversations section', async () => {
      setupMockAPIs()
      render(<HomePage />)

      await waitFor(() => {
        expect(screen.getByTestId('shared-conversations')).toBeInTheDocument()
      })
    })
  })

  describe('Insights widget (MongoDB mode)', () => {
    it('fetches user stats', async () => {
      setupMockAPIs()
      render(<HomePage />)

      await waitFor(() => {
        expect(mockGetUserStats).toHaveBeenCalled()
      })
    })

    it('renders stats in the widget', async () => {
      setupMockAPIs()
      render(<HomePage />)

      await waitFor(() => {
        expect(screen.getByTestId('insights-widget')).toBeInTheDocument()
        expect(screen.getByTestId('total-conversations')).toHaveTextContent('42')
      })
    })
  })

  describe('localStorage mode', () => {
    beforeEach(() => {
      mockStorageMode = 'localStorage'
    })

    it('does not render shared conversations section', () => {
      setupMockAPIs()
      render(<HomePage />)
      expect(screen.queryByTestId('shared-conversations')).not.toBeInTheDocument()
    })

    it('does not render insights widget', () => {
      setupMockAPIs()
      render(<HomePage />)
      expect(screen.queryByTestId('insights-widget')).not.toBeInTheDocument()
    })

    it('does not call getSharedConversations', () => {
      setupMockAPIs()
      render(<HomePage />)
      expect(mockGetSharedConversations).not.toHaveBeenCalled()
    })

    it('does not call getUserStats', () => {
      setupMockAPIs()
      render(<HomePage />)
      expect(mockGetUserStats).not.toHaveBeenCalled()
    })

    it('calls loadConversationsFromServer', async () => {
      setupMockAPIs()
      render(<HomePage />)

      await waitFor(() => {
        expect(mockLoadConversationsFromServer).toHaveBeenCalled()
      })
    })

    it('still renders recent chats', async () => {
      mockLocalConversations.push(
        {
          id: 'local-1',
          title: 'Local Chat 1',
          createdAt: new Date(),
          updatedAt: new Date(),
          messages: [{ id: '1' }, { id: '2' }],
          a2aEvents: [],
          sseEvents: [],
        },
      )
      setupMockAPIs()
      render(<HomePage />)

      await waitFor(() => {
        expect(screen.getByText('Local Chat 1')).toBeInTheDocument()
      })
    })

    it('still renders capability cards', () => {
      setupMockAPIs()
      render(<HomePage />)
      expect(screen.getByTestId('capability-cards')).toBeInTheDocument()
    })

    it('still renders welcome banner', () => {
      setupMockAPIs()
      render(<HomePage />)
      expect(screen.getByTestId('welcome-banner')).toBeInTheDocument()
    })
  })

  describe('not authenticated', () => {
    it('does not fetch conversations when not authenticated', () => {
      mockSession.status = 'loading' as any
      setupMockAPIs()
      render(<HomePage />)
      expect(mockGetConversations).not.toHaveBeenCalled()
      expect(mockGetSharedConversations).not.toHaveBeenCalled()
      expect(mockGetUserStats).not.toHaveBeenCalled()
    })
  })

  describe('error handling', () => {
    it('handles getConversations failure gracefully', async () => {
      mockGetConversations.mockRejectedValue(new Error('Network error'))
      mockGetSharedConversations.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 20, has_more: false })
      mockGetUserStats.mockResolvedValue(makeUserStats())

      render(<HomePage />)

      await waitFor(() => {
        expect(screen.getByTestId('recent-chats')).toBeInTheDocument()
      })
    })

    it('handles getSharedConversations failure gracefully', async () => {
      setupMockAPIs()
      mockGetSharedConversations.mockRejectedValue(new Error('Network error'))

      render(<HomePage />)

      await waitFor(() => {
        expect(screen.getByTestId('shared-conversations')).toBeInTheDocument()
      })
    })

    it('handles getUserStats failure gracefully', async () => {
      setupMockAPIs()
      mockGetUserStats.mockRejectedValue(new Error('Network error'))

      render(<HomePage />)

      await waitFor(() => {
        expect(screen.getByTestId('recent-chats')).toBeInTheDocument()
      })
    })
  })
})
