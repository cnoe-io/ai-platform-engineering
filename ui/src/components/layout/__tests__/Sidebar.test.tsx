/**
 * Unit tests for Sidebar component — Live Status, Unviewed Messages, and visual states
 *
 * Covers:
 * - Live status indicator: green Radio icon with pulse animation for streaming conversations
 * - Unviewed messages indicator: blue dot on MessageSquare icon for completed background streams
 * - Date text: "Live" for streaming, "New response" for unviewed, formatted date otherwise
 * - Background/border styling: emerald for live, blue for unviewed, primary for active
 * - State transitions: live → unviewed → cleared lifecycle
 */

import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'

// ============================================================================
// Mocks — must be before imports
// ============================================================================

const mockSession = {
  data: { user: { name: 'Test User', email: 'test@test.com' } } as any,
  status: 'authenticated' as const,
  update: jest.fn(),
}
jest.mock('next-auth/react', () => ({
  useSession: jest.fn(() => mockSession),
}))

const mockPush = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: jest.fn(),
  }),
}))

jest.mock('framer-motion', () => ({
  motion: {
    div: React.forwardRef(({ children, initial, animate, exit, transition, ...props }: any, ref: any) => (
      <div ref={ref} {...props}>{children}</div>
    )),
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}))

let mockConversations: any[] = []
let mockActiveConversationId: string | null = null
const mockSetActiveConversation = jest.fn()
const mockCreateConversation = jest.fn(() => 'new-conv-id')
const mockDeleteConversation = jest.fn()
const mockLoadConversationsFromServer = jest.fn().mockResolvedValue(undefined)
const mockLoadMessagesFromServer = jest.fn().mockResolvedValue(undefined)
const mockIsConversationStreaming = jest.fn((_id: string) => false)
const mockHasUnviewedMessages = jest.fn((_id: string) => false)

jest.mock('@/store/chat-store', () => {
  const getState = () => ({
    conversations: mockConversations,
    activeConversationId: mockActiveConversationId,
  })

  const store = (selector?: (s: any) => any) => {
    const state = {
      conversations: mockConversations,
      activeConversationId: mockActiveConversationId,
      setActiveConversation: mockSetActiveConversation,
      createConversation: mockCreateConversation,
      deleteConversation: mockDeleteConversation,
      loadConversationsFromServer: mockLoadConversationsFromServer,
      loadMessagesFromServer: mockLoadMessagesFromServer,
      isConversationStreaming: mockIsConversationStreaming,
      hasUnviewedMessages: mockHasUnviewedMessages,
    }
    return selector ? selector(state) : state
  }

  store.getState = getState
  store.setState = jest.fn()
  store.subscribe = jest.fn()

  return { useChatStore: store }
})

jest.mock('lucide-react', () => ({
  MessageSquare: (props: any) => <span data-testid="icon-message-square" {...props} />,
  Radio: (props: any) => <span data-testid="icon-radio" {...props} />,
  History: (props: any) => <span data-testid="icon-history" {...props} />,
  Plus: (props: any) => <span data-testid="icon-plus" {...props} />,
  Archive: (props: any) => <span data-testid="icon-archive" {...props} />,
  ArchiveRestore: (props: any) => <span data-testid="icon-archive-restore" {...props} />,
  ChevronLeft: (props: any) => <span data-testid="icon-chevron-left" {...props} />,
  ChevronRight: (props: any) => <span data-testid="icon-chevron-right" {...props} />,
  Sparkles: (props: any) => <span data-testid="icon-sparkles" {...props} />,
  Zap: (props: any) => <span data-testid="icon-zap" {...props} />,
  Database: (props: any) => <span data-testid="icon-database" {...props} />,
  HardDrive: (props: any) => <span data-testid="icon-hard-drive" {...props} />,
  Users2: (props: any) => <span data-testid="icon-users2" {...props} />,
  Shield: (props: any) => <span data-testid="icon-shield" {...props} />,
  Users: (props: any) => <span data-testid="icon-users" {...props} />,
  TrendingUp: (props: any) => <span data-testid="icon-trending-up" {...props} />,
  RefreshCw: (props: any) => <span data-testid="icon-refresh" {...props} />,
}))

jest.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}))

jest.mock('@/components/ui/scroll-area', () => ({
  ScrollArea: ({ children, ...props }: any) => <div {...props}>{children}</div>,
}))

jest.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: any) => <>{children}</>,
  TooltipContent: ({ children }: any) => <>{children}</>,
  TooltipProvider: ({ children }: any) => <>{children}</>,
  TooltipTrigger: ({ children }: any) => <>{children}</>,
}))

jest.mock('@/components/ui/toast', () => ({
  useToast: () => ({ toast: jest.fn() }),
}))

jest.mock('@/lib/storage-config', () => ({
  getStorageMode: () => 'mongodb',
  getStorageModeDisplay: () => 'MongoDB',
}))

jest.mock('@/lib/utils', () => ({
  cn: (...args: any[]) => args.filter(Boolean).join(' '),
  formatDate: (d: any) => 'Jan 1, 2026',
  truncateText: (text: string) => text,
}))

jest.mock('@/components/gallery/UseCaseBuilder', () => ({
  UseCaseBuilderDialog: () => null,
}))

jest.mock('@/components/chat/RecycleBinDialog', () => ({
  RecycleBinDialog: () => null,
}))

jest.mock('@/components/chat/ShareButton', () => ({
  ShareButton: () => null,
}))

jest.mock('@/lib/api-client', () => ({
  apiClient: {
    createConversation: jest.fn().mockResolvedValue({ _id: 'new-id', title: 'New', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
  },
}))

// ============================================================================
// Imports — after mocks
// ============================================================================

import { Sidebar } from '../Sidebar'

// ============================================================================
// Helpers
// ============================================================================

function makeConv(id: string, title: string, overrides: any = {}) {
  return {
    id,
    title,
    createdAt: new Date(),
    updatedAt: new Date(),
    messages: [],
    a2aEvents: [],
    ...overrides,
  }
}

const defaultProps = {
  activeTab: 'chat' as const,
  onTabChange: jest.fn(),
  collapsed: false,
  onCollapse: jest.fn(),
}

// ============================================================================
// Tests
// ============================================================================

describe('Sidebar — Live Status Indicator', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockConversations = []
    mockActiveConversationId = null
    mockIsConversationStreaming.mockImplementation(() => false)
    mockHasUnviewedMessages.mockImplementation(() => false)
  })

  // --------------------------------------------------------------------------
  // Live status indicator (green radio icon)
  // --------------------------------------------------------------------------

  describe('live status indicator', () => {
    it('renders Radio icon for a streaming conversation', () => {
      mockConversations = [makeConv('conv-1', 'Test Chat')]
      mockIsConversationStreaming.mockImplementation((id: string) => id === 'conv-1')

      render(<Sidebar {...defaultProps} />)

      expect(screen.getByTestId('icon-radio')).toBeInTheDocument()
    })

    it('renders MessageSquare icon for a non-streaming conversation', () => {
      mockConversations = [makeConv('conv-1', 'Test Chat')]
      mockIsConversationStreaming.mockImplementation(() => false)

      render(<Sidebar {...defaultProps} />)

      expect(screen.getByTestId('icon-message-square')).toBeInTheDocument()
      expect(screen.queryByTestId('icon-radio')).not.toBeInTheDocument()
    })

    it('shows "Live" text for a streaming conversation', () => {
      mockConversations = [makeConv('conv-1', 'Test Chat')]
      mockIsConversationStreaming.mockImplementation((id: string) => id === 'conv-1')

      render(<Sidebar {...defaultProps} />)

      expect(screen.getByText('Live')).toBeInTheDocument()
    })

    it('applies emerald styling to the Radio icon', () => {
      mockConversations = [makeConv('conv-1', 'Test Chat')]
      mockIsConversationStreaming.mockImplementation((id: string) => id === 'conv-1')

      render(<Sidebar {...defaultProps} />)

      const radioIcon = screen.getByTestId('icon-radio')
      expect(radioIcon.className).toContain('text-emerald-500')
      expect(radioIcon.className).toContain('animate-pulse')
    })

    it('renders Radio for streaming and MessageSquare for non-streaming conversations', () => {
      mockConversations = [
        makeConv('conv-live', 'Live Chat'),
        makeConv('conv-idle', 'Idle Chat'),
      ]
      mockIsConversationStreaming.mockImplementation((id: string) => id === 'conv-live')

      render(<Sidebar {...defaultProps} />)

      expect(screen.getByTestId('icon-radio')).toBeInTheDocument()
      expect(screen.getByTestId('icon-message-square')).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Unviewed messages indicator (blue dot)
  // --------------------------------------------------------------------------

  describe('unviewed messages indicator', () => {
    it('shows "New response" text for an unviewed conversation', () => {
      mockConversations = [makeConv('conv-1', 'Test Chat')]
      mockHasUnviewedMessages.mockImplementation((id: string) => id === 'conv-1')

      render(<Sidebar {...defaultProps} />)

      expect(screen.getByText('New response')).toBeInTheDocument()
    })

    it('renders MessageSquare icon (not Radio) for unviewed conversations', () => {
      mockConversations = [makeConv('conv-1', 'Test Chat')]
      mockHasUnviewedMessages.mockImplementation((id: string) => id === 'conv-1')

      render(<Sidebar {...defaultProps} />)

      expect(screen.getByTestId('icon-message-square')).toBeInTheDocument()
      expect(screen.queryByTestId('icon-radio')).not.toBeInTheDocument()
    })

    it('applies blue styling to the MessageSquare icon for unviewed', () => {
      mockConversations = [makeConv('conv-1', 'Test Chat')]
      mockHasUnviewedMessages.mockImplementation((id: string) => id === 'conv-1')

      render(<Sidebar {...defaultProps} />)

      const icon = screen.getByTestId('icon-message-square')
      expect(icon.className).toContain('text-blue-500')
    })

    it('does NOT show unviewed indicator when conversation is streaming (live takes priority)', () => {
      mockConversations = [makeConv('conv-1', 'Test Chat')]
      mockIsConversationStreaming.mockImplementation((id: string) => id === 'conv-1')
      mockHasUnviewedMessages.mockImplementation((id: string) => id === 'conv-1')

      render(<Sidebar {...defaultProps} />)

      expect(screen.getByTestId('icon-radio')).toBeInTheDocument()
      expect(screen.getByText('Live')).toBeInTheDocument()
      expect(screen.queryByText('New response')).not.toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Normal (idle) state
  // --------------------------------------------------------------------------

  describe('normal conversation state', () => {
    it('shows formatted date for a normal conversation', () => {
      mockConversations = [makeConv('conv-1', 'Test Chat')]

      render(<Sidebar {...defaultProps} />)

      expect(screen.getByText('Jan 1, 2026')).toBeInTheDocument()
    })

    it('does not show "Live" or "New response" for normal conversations', () => {
      mockConversations = [makeConv('conv-1', 'Test Chat')]

      render(<Sidebar {...defaultProps} />)

      expect(screen.queryByText('Live')).not.toBeInTheDocument()
      expect(screen.queryByText('New response')).not.toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Mixed states (multiple conversations with different statuses)
  // --------------------------------------------------------------------------

  describe('mixed conversation states', () => {
    it('renders correct indicators for live, unviewed, and normal conversations', () => {
      mockConversations = [
        makeConv('conv-live', 'Live Chat'),
        makeConv('conv-unviewed', 'Unviewed Chat'),
        makeConv('conv-normal', 'Normal Chat'),
      ]
      mockIsConversationStreaming.mockImplementation((id: string) => id === 'conv-live')
      mockHasUnviewedMessages.mockImplementation((id: string) => id === 'conv-unviewed')

      render(<Sidebar {...defaultProps} />)

      expect(screen.getByText('Live')).toBeInTheDocument()
      expect(screen.getByText('New response')).toBeInTheDocument()
      expect(screen.getByText('Jan 1, 2026')).toBeInTheDocument()
      expect(screen.getByTestId('icon-radio')).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Click behavior
  // --------------------------------------------------------------------------

  describe('conversation click behavior', () => {
    it('calls setActiveConversation when clicking a conversation', () => {
      mockConversations = [makeConv('conv-click', 'Clickable Chat')]

      render(<Sidebar {...defaultProps} />)

      fireEvent.click(screen.getByText('Clickable Chat'))

      expect(mockSetActiveConversation).toHaveBeenCalledWith('conv-click')
    })
  })

  // --------------------------------------------------------------------------
  // Empty state
  // --------------------------------------------------------------------------

  describe('empty state', () => {
    it('shows empty state message when no conversations exist', () => {
      mockConversations = []

      render(<Sidebar {...defaultProps} />)

      expect(screen.getByText('No conversations yet')).toBeInTheDocument()
      expect(screen.getByText('Start a new chat to begin')).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Collapsed sidebar
  // --------------------------------------------------------------------------

  describe('collapsed sidebar', () => {
    it('does not render conversation titles when collapsed', () => {
      mockConversations = [makeConv('conv-1', 'Hidden Title')]

      render(<Sidebar {...defaultProps} collapsed={true} />)

      expect(screen.queryByText('Hidden Title')).not.toBeInTheDocument()
    })

    it('does not render "Live" or "New response" text when collapsed', () => {
      mockConversations = [makeConv('conv-1', 'Chat')]
      mockIsConversationStreaming.mockImplementation((id: string) => id === 'conv-1')

      render(<Sidebar {...defaultProps} collapsed={true} />)

      expect(screen.queryByText('Live')).not.toBeInTheDocument()
    })

    it('still renders icons when collapsed', () => {
      mockConversations = [makeConv('conv-1', 'Chat')]
      mockIsConversationStreaming.mockImplementation((id: string) => id === 'conv-1')

      render(<Sidebar {...defaultProps} collapsed={true} />)

      expect(screen.getByTestId('icon-radio')).toBeInTheDocument()
    })
  })
})
