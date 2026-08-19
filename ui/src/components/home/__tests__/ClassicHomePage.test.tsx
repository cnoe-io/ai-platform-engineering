/**
 * Unit tests for ClassicHomePage — the pre-widget-system Home layout, kept
 * as an opt-out via HomeExperienceToggle.
 *
 * Tests:
 * - Renders "Powered by caipe.io" footer
 * - Renders a toggle to switch to the new experience
 * - Capability cards: shows/hides Knowledge Bases based on RAG flag
 * - Recent chats (MongoDB): fetches and displays conversations
 * - Shared conversations (MongoDB): fetches from getSharedConversations API
 * - Insights widget (MongoDB): fetches and renders user stats
 * - localStorage mode: hides shared conversations and insights widget
 * - localStorage mode: still renders recent chats via the local store
 */

import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'

// ============================================================================
// Mocks
// ============================================================================

jest.mock('next-auth/react', () => ({
  useSession: () => ({
    data: { user: { name: 'Test User', email: 'test@example.com' } },
    status: 'authenticated',
  }),
}))

jest.mock('next/link', () => {
  // eslint-disable-next-line react/display-name
  return React.forwardRef(({ children, href, className, ...props }: unknown, ref: unknown) => (
    <a ref={ref} href={href} className={className} data-testid={props['data-testid'] || `link-${href}`} {...props}>
      {children}
    </a>
  ))
})

jest.mock('lucide-react', () => {
  // eslint-disable-next-line react/display-name
  const stub = (name: string) => (props: unknown) => <svg data-testid={`icon-${name}`} {...props} />
  return new Proxy({}, { get: (_t, prop: string) => stub(prop) })
})

jest.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
  formatRelativeTimeCompact: () => 'Just now',
}))

let mockStorageMode = 'mongodb'
jest.mock('@/lib/storage-config', () => ({
  getStorageMode: () => mockStorageMode,
}))

let mockRagEnabled = true
jest.mock('@/lib/config', () => ({
  config: { get ragEnabled() { return mockRagEnabled } },
}))

const mockLoadConversationsFromServer = jest.fn()
const mockLocalConversations: unknown[] = []
jest.mock('@/store/chat-store', () => ({
  useChatStore: () => ({
    conversations: mockLocalConversations,
    loadConversationsFromServer: mockLoadConversationsFromServer,
  }),
}))

const mockSetExperience = jest.fn()
jest.mock('@/store/home-widgets-store', () => ({
  useHomeWidgetsStore: (selector: (state: unknown) => unknown) =>
    selector({ setExperience: mockSetExperience }),
}))

const mockGetConversations = jest.fn()
const mockGetSharedConversations = jest.fn()
const mockGetUserStats = jest.fn()
jest.mock('@/lib/api-client', () => ({
  apiClient: {
    getConversations: (...args: unknown[]) => mockGetConversations(...args),
    getSharedConversations: (...args: unknown[]) => mockGetSharedConversations(...args),
    getUserStats: (...args: unknown[]) => mockGetUserStats(...args),
  },
}))

// ============================================================================
// Imports — after mocks
// ============================================================================

import { ClassicHomePage } from '../ClassicHomePage'

// ============================================================================
// Helpers
// ============================================================================

function makeConversationItems(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    _id: `conv-${i}`,
    title: `Conversation ${i + 1}`,
    owner_id: 'test@test.com',
    updated_at: new Date(Date.now() - i * 3600000),
    metadata: { total_messages: (i + 1) * 2 },
    agent_name: i === 0 ? 'Release Manager' : undefined,
    sharing: { shared_with: [], shared_with_teams: [] },
  }))
}

function makeUserStats(overrides: Record<string, unknown> = {}) {
  return {
    total_conversations: 42,
    conversations_this_week: 7,
    messages_this_week: 35,
    favorite_agents: [{ name: 'github', count: 20 }],
    ...overrides,
  }
}

function setupMockAPIs(opts: { conversations?: unknown[]; shared?: unknown[]; stats?: unknown } = {}) {
  mockGetConversations.mockResolvedValue({ items: opts.conversations ?? makeConversationItems(3) })
  mockGetSharedConversations.mockResolvedValue({ items: opts.shared ?? [] })
  mockGetUserStats.mockResolvedValue(opts.stats ?? makeUserStats())
}

// ============================================================================
// Tests
// ============================================================================

describe('ClassicHomePage', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockStorageMode = 'mongodb'
    mockRagEnabled = true
    mockLocalConversations.length = 0
  })

  it('renders "Powered by caipe.io" footer', () => {
    setupMockAPIs()
    render(<ClassicHomePage />)
    const link = screen.getByText('caipe.io')
    expect(link.closest('a')).toHaveAttribute('href', 'https://caipe.io')
  })

  it('renders a toggle to switch to the new experience', () => {
    setupMockAPIs()
    render(<ClassicHomePage />)
    screen.getByTestId('switch-to-new-home').click()
    expect(mockSetExperience).toHaveBeenCalledWith('new')
  })

  describe('Capability cards', () => {
    it('shows Knowledge Bases when RAG is enabled', () => {
      mockRagEnabled = true
      setupMockAPIs()
      render(<ClassicHomePage />)
      expect(screen.getByTestId('capability-card-knowledge-bases')).toBeInTheDocument()
    })

    it('hides Knowledge Bases when RAG is disabled', () => {
      mockRagEnabled = false
      setupMockAPIs()
      render(<ClassicHomePage />)
      expect(screen.queryByTestId('capability-card-knowledge-bases')).not.toBeInTheDocument()
    })
  })

  describe('Recent chats (MongoDB mode)', () => {
    it('fetches and renders recent conversations', async () => {
      setupMockAPIs()
      render(<ClassicHomePage />)
      await waitFor(() => {
        expect(screen.getByText('Conversation 1')).toBeInTheDocument()
        expect(screen.getByText('Conversation 3')).toBeInTheDocument()
      })
    })

    it('shows the agent for recent conversations when present', async () => {
      setupMockAPIs()
      render(<ClassicHomePage />)
      await waitFor(() => {
        expect(screen.getByText('Release Manager')).toBeInTheDocument()
      })
    })
  })

  describe('Shared conversations (MongoDB mode)', () => {
    it('fetches shared conversations', async () => {
      setupMockAPIs()
      render(<ClassicHomePage />)
      await waitFor(() => {
        expect(mockGetSharedConversations).toHaveBeenCalledWith({ page_size: 20 })
      })
    })

    it('renders SharedConversations section', () => {
      setupMockAPIs()
      render(<ClassicHomePage />)
      expect(screen.getByTestId('shared-conversations')).toBeInTheDocument()
    })
  })

  describe('Insights widget (MongoDB mode)', () => {
    it('fetches user stats and renders them', async () => {
      setupMockAPIs()
      render(<ClassicHomePage />)
      await waitFor(() => {
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
      render(<ClassicHomePage />)
      expect(screen.queryByTestId('shared-conversations')).not.toBeInTheDocument()
    })

    it('does not render insights widget', () => {
      setupMockAPIs()
      render(<ClassicHomePage />)
      expect(screen.queryByTestId('insights-widget')).not.toBeInTheDocument()
    })

    it('calls loadConversationsFromServer', async () => {
      setupMockAPIs()
      render(<ClassicHomePage />)
      await waitFor(() => expect(mockLoadConversationsFromServer).toHaveBeenCalled())
    })

    it('still renders recent chats from the local store', async () => {
      mockLocalConversations.push({
        id: 'local-1',
        title: 'Local Chat 1',
        updatedAt: new Date(),
        messages: [{ id: '1' }, { id: '2' }],
      })
      setupMockAPIs()
      render(<ClassicHomePage />)
      await waitFor(() => expect(screen.getByText('Local Chat 1')).toBeInTheDocument())
    })
  })
})
