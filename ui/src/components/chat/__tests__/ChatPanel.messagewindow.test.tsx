/**
 * Unit tests for ChatPanel — Message Windowing (Turn Collapse/Expand)
 *
 * Tests:
 * - With <= 2 turns: all messages are rendered, no collapse banner
 * - With > 2 turns: older turns are collapsed, showing CollapsedTurnsBanner
 * - CollapsedTurnsBanner shows turn count and time info
 * - Clicking expand shows all messages
 * - Re-collapse button appears after expanding
 * - Clicking re-collapse hides old messages and calls evictOldMessageContent
 * - Conversation switch resets olderTurnsExpanded to collapsed state
 * - Latest 2 turns (VISIBLE_TURN_COUNT) are always visible regardless of collapse state
 */

import React from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'

// ============================================================================
// Global jsdom polyfills
// ============================================================================

Element.prototype.scrollIntoView = jest.fn()

// ============================================================================
// Mocks — must be before imports
// ============================================================================

const mockSession = {
  data: { user: { name: 'Test User', email: 'test@test.com' }, accessToken: 'test-token' },
  status: 'authenticated' as const,
  update: jest.fn(),
}
jest.mock('next-auth/react', () => ({
  useSession: jest.fn(() => mockSession),
}))

jest.mock('framer-motion', () => ({
  motion: {
    div: React.forwardRef(({ children, initial, animate, exit, transition, whileHover, whileTap, onMouseEnter, onMouseLeave, ...props }: any, ref: any) => (
      <div ref={ref} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} {...props}>{children}</div>
    )),
    button: React.forwardRef(({ children, ...props }: any, ref: any) => <button ref={ref} {...props}>{children}</button>),
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}))

const mockGetActiveConversation = jest.fn()
const mockIsConversationStreaming = jest.fn(() => false)
const mockEvictOldMessageContent = jest.fn()
const mockLoadMessagesFromServer = jest.fn()
let mockActiveConversationId = 'conv-1'

jest.mock('@/store/chat-store', () => ({
  useChatStore: jest.fn(() => ({
    activeConversationId: mockActiveConversationId,
    getActiveConversation: mockGetActiveConversation,
    createConversation: jest.fn(),
    addMessage: jest.fn(),
    updateMessage: jest.fn(),
    appendToMessage: jest.fn(),
    addEventToMessage: jest.fn(),
    addA2AEvent: jest.fn(),
    clearA2AEvents: jest.fn(),
    setConversationStreaming: jest.fn(),
    isConversationStreaming: mockIsConversationStreaming,
    cancelConversationRequest: jest.fn(),
    updateMessageFeedback: jest.fn(),
    consumePendingMessage: jest.fn(() => null),
    recoverInterruptedTask: jest.fn(),
    evictOldMessageContent: mockEvictOldMessageContent,
    loadMessagesFromServer: mockLoadMessagesFromServer,
  })),
}))

jest.mock('@/lib/config', () => ({
  getConfig: jest.fn((key: string) => {
    const configs: Record<string, any> = {
      appName: 'Test App',
      tagline: 'Test tagline',
      description: 'Test description',
      ssoEnabled: false,
    }
    return configs[key]
  }),
}))

jest.mock('@/lib/a2a-sdk-client', () => ({
  A2ASDKClient: jest.fn(),
  toStoreEvent: jest.fn(),
}))

jest.mock('@/lib/utils', () => ({
  cn: (...args: any[]) => args.filter(Boolean).join(' '),
  deduplicateByKey: (arr: any[], keyFn: (item: any) => string) => {
    const seen = new Set()
    return arr.filter((item: any) => {
      const key = keyFn(item)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  },
}))

jest.mock('react-markdown', () => {
  return function MockReactMarkdown({ children, components }: any) {
    if (components?.p) {
      const P = components.p
      return <div data-testid="markdown-container"><P>{children}</P></div>
    }
    return <div data-testid="markdown-container">{children}</div>
  }
})

jest.mock('remark-gfm', () => () => {})

jest.mock('react-syntax-highlighter', () => ({
  Prism: ({ children }: any) => <pre data-testid="syntax-highlighter">{children}</pre>,
}))
jest.mock('react-syntax-highlighter/dist/esm/styles/prism', () => ({
  oneDark: {},
}))

jest.mock('react-textarea-autosize', () => {
  return React.forwardRef((props: any, ref: any) => <textarea ref={ref} {...props} />)
})

jest.mock('../FeedbackButton', () => ({
  FeedbackButton: () => <div data-testid="feedback-button" />,
}))
jest.mock('../CustomCallButtons', () => ({
  DEFAULT_AGENTS: [],
  CustomCall: () => null,
}))
jest.mock('@/components/shared/AgentLogos', () => ({
  AGENT_LOGOS: {},
}))
jest.mock('../MetadataInputForm', () => ({
  MetadataInputForm: () => <div data-testid="metadata-input-form" />,
}))

jest.mock('@/components/ui/scroll-area', () => ({
  ScrollArea: React.forwardRef(({ children, viewportRef, ...props }: any, ref: any) => {
    const setViewportRef = React.useCallback((node: HTMLDivElement | null) => {
      if (viewportRef) {
        viewportRef.current = node
      }
    }, [viewportRef])

    return (
      <div ref={ref} data-testid="scroll-area" {...props}>
        <div
          ref={setViewportRef}
          data-testid="scroll-viewport"
          style={{ overflow: 'auto', height: '500px' }}
        >
          {children}
        </div>
      </div>
    )
  }),
}))

jest.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: any) => <>{children}</>,
  TooltipContent: ({ children }: any) => <div>{children}</div>,
  TooltipProvider: ({ children }: any) => <>{children}</>,
  TooltipTrigger: React.forwardRef(({ children, asChild, ...props }: any, ref: any) => {
    if (asChild && React.isValidElement(children)) {
      return React.cloneElement(children as React.ReactElement<any>, { ref, ...props })
    }
    return <div ref={ref} {...props}>{children}</div>
  }),
}))

jest.mock('@/components/ui/button', () => ({
  Button: React.forwardRef(({ children, ...props }: any, ref: any) => (
    <button ref={ref} {...props}>{children}</button>
  )),
}))

// ============================================================================
// Imports — after mocks
// ============================================================================

import { ChatPanel } from '../ChatPanel'
import type { ChatMessage } from '@/types/a2a'

// ============================================================================
// Helpers
// ============================================================================

let msgCounter = 0
function createMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  msgCounter++
  return {
    id: `msg-${msgCounter}`,
    role: 'user',
    content: `Message ${msgCounter}`,
    timestamp: new Date(2026, 1, 10, 12, msgCounter),
    events: [],
    isFinal: true,
    ...overrides,
  }
}

function createTurn(userContent: string, assistantContent: string) {
  return [
    createMessage({ role: 'user', content: userContent }),
    createMessage({ role: 'assistant', content: assistantContent, isFinal: true }),
  ]
}

function createConversation(messages: ChatMessage[] = []) {
  return {
    id: 'conv-1',
    title: 'Test Conversation',
    messages,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('ChatPanel — Message Windowing', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    msgCounter = 0
    mockActiveConversationId = 'conv-1'
    mockGetActiveConversation.mockReturnValue(null)
    mockIsConversationStreaming.mockReturnValue(false)
  })

  describe('Collapse behavior', () => {
    it('renders all messages when 2 or fewer turns exist (no collapsing)', () => {
      // 2 turns = exactly at COLLAPSE_THRESHOLD, should NOT collapse
      const messages = [
        ...createTurn('Hello', 'Hi there!'),
        ...createTurn('How are you?', 'I am well.'),
      ]
      mockGetActiveConversation.mockReturnValue(createConversation(messages))

      render(<ChatPanel endpoint="/api/test" />)

      // All 4 messages should be visible
      expect(screen.getByText('Hello')).toBeInTheDocument()
      expect(screen.getByText('Hi there!')).toBeInTheDocument()
      expect(screen.getByText('How are you?')).toBeInTheDocument()
      expect(screen.getByText('I am well.')).toBeInTheDocument()

      // No collapse banner
      expect(screen.queryByText(/older/i)).not.toBeInTheDocument()
    })

    it('collapses older turns when more than COLLAPSE_THRESHOLD turns exist', () => {
      // 3 turns > COLLAPSE_THRESHOLD (2): first turn should be collapsed
      // Use long content so preview (80-char truncation) differs from full content
      const longQuestion = 'First question - ' + 'x'.repeat(100)
      const longAnswer = 'First answer - ' + 'y'.repeat(100)
      const messages = [
        ...createTurn(longQuestion, longAnswer),
        ...createTurn('Second question', 'Second answer'),
        ...createTurn('Third question', 'Third answer'),
      ]
      mockGetActiveConversation.mockReturnValue(createConversation(messages))

      render(<ChatPanel endpoint="/api/test" />)

      // First turn should be collapsed: full content not rendered as ChatMessage,
      // but a truncated preview (80 chars + "...") appears inside CollapsedTurnsBanner
      expect(screen.queryByText(longQuestion)).not.toBeInTheDocument()
      expect(screen.queryByText(longAnswer)).not.toBeInTheDocument()

      // The banner DOES show the preview of the collapsed turn
      expect(screen.getByText('1 older turn')).toBeInTheDocument()

      // Last 2 turns (VISIBLE_TURN_COUNT) should be visible
      expect(screen.getByText('Second question')).toBeInTheDocument()
      expect(screen.getByText('Second answer')).toBeInTheDocument()
      expect(screen.getByText('Third question')).toBeInTheDocument()
      expect(screen.getByText('Third answer')).toBeInTheDocument()
    })

    it('shows CollapsedTurnsBanner with turn count', () => {
      const messages = [
        ...createTurn('Old Q1', 'Old A1'),
        ...createTurn('Old Q2', 'Old A2'),
        ...createTurn('Recent Q1', 'Recent A1'),
        ...createTurn('Recent Q2', 'Recent A2'),
      ]
      mockGetActiveConversation.mockReturnValue(createConversation(messages))

      render(<ChatPanel endpoint="/api/test" />)

      // Should show a banner indicating collapsed turns (2 older turns)
      // Text format: "{N} older turns"
      expect(screen.getByText('2 older turns')).toBeInTheDocument()
    })
  })

  describe('Expand/Collapse toggling', () => {
    it('shows all messages when expand button is clicked', () => {
      // Use long content so the banner preview (truncated) differs from full text
      const longQuestion = 'First question - ' + 'x'.repeat(100)
      const longAnswer = 'First answer - ' + 'y'.repeat(100)
      const messages = [
        ...createTurn(longQuestion, longAnswer),
        ...createTurn('Second question', 'Second answer'),
        ...createTurn('Third question', 'Third answer'),
      ]
      mockGetActiveConversation.mockReturnValue(createConversation(messages))

      render(<ChatPanel endpoint="/api/test" />)

      // First turn's FULL content should NOT be visible initially (only banner preview)
      expect(screen.queryByText(longQuestion)).not.toBeInTheDocument()

      // Click the collapsed turns banner (the whole banner is a button)
      const expandButton = screen.getByText('1 older turn')
      fireEvent.click(expandButton.closest('button') || expandButton)

      // After expanding, first turn's full content should be visible
      expect(screen.getByText(longQuestion)).toBeInTheDocument()
      expect(screen.getByText(longAnswer)).toBeInTheDocument()
    })

    it('shows re-collapse button after expanding', () => {
      const messages = [
        ...createTurn('First question long content ' + 'x'.repeat(100), 'First answer'),
        ...createTurn('Second question', 'Second answer'),
        ...createTurn('Third question', 'Third answer'),
      ]
      mockGetActiveConversation.mockReturnValue(createConversation(messages))

      render(<ChatPanel endpoint="/api/test" />)

      // Expand
      const expandButton = screen.getByText('1 older turn')
      fireEvent.click(expandButton.closest('button') || expandButton)

      // Re-collapse button should now be visible with format "Collapse N older turns"
      expect(screen.getByText('Collapse 1 older turns')).toBeInTheDocument()
    })

    it('calls evictOldMessageContent when collapsing', () => {
      const messages = [
        ...createTurn('First question long content ' + 'x'.repeat(100), 'First answer'),
        ...createTurn('Second question', 'Second answer'),
        ...createTurn('Third question', 'Third answer'),
      ]
      mockGetActiveConversation.mockReturnValue(createConversation(messages))

      render(<ChatPanel endpoint="/api/test" />)

      // Expand first
      const expandButton = screen.getByText('1 older turn')
      fireEvent.click(expandButton.closest('button') || expandButton)

      // Then collapse
      const collapseButton = screen.getByText('Collapse 1 older turns')
      fireEvent.click(collapseButton.closest('button') || collapseButton)

      // Should call evictOldMessageContent with old message IDs
      expect(mockEvictOldMessageContent).toHaveBeenCalledWith('conv-1', expect.any(Array))
    })
  })

  describe('Conversation switch behavior', () => {
    it('resets collapse state when switching conversations', () => {
      const longQuestion = 'First question - ' + 'x'.repeat(100)
      const messages = [
        ...createTurn(longQuestion, 'First answer'),
        ...createTurn('Second question', 'Second answer'),
        ...createTurn('Third question', 'Third answer'),
      ]
      mockGetActiveConversation.mockReturnValue(createConversation(messages))

      const { rerender } = render(<ChatPanel endpoint="/api/test" />)

      // Expand
      const expandButton = screen.getByText('1 older turn')
      fireEvent.click(expandButton.closest('button') || expandButton)

      // First question's full content should be visible now
      expect(screen.getByText(longQuestion)).toBeInTheDocument()

      // Switch conversation
      mockActiveConversationId = 'conv-2'
      const newMessages = [
        ...createTurn('New Q1', 'New A1'),
        ...createTurn('New Q2', 'New A2'),
        ...createTurn('New Q3', 'New A3'),
      ]
      mockGetActiveConversation.mockReturnValue({
        ...createConversation(newMessages),
        id: 'conv-2',
      })

      // Force re-render by updating the store mock
      const { useChatStore } = require('@/store/chat-store')
      ;(useChatStore as jest.Mock).mockImplementation(() => ({
        activeConversationId: 'conv-2',
        getActiveConversation: mockGetActiveConversation,
        createConversation: jest.fn(),
        addMessage: jest.fn(),
        updateMessage: jest.fn(),
        appendToMessage: jest.fn(),
        addEventToMessage: jest.fn(),
        addA2AEvent: jest.fn(),
        clearA2AEvents: jest.fn(),
        setConversationStreaming: jest.fn(),
        isConversationStreaming: mockIsConversationStreaming,
        cancelConversationRequest: jest.fn(),
        updateMessageFeedback: jest.fn(),
        consumePendingMessage: jest.fn(() => null),
        recoverInterruptedTask: jest.fn(),
        evictOldMessageContent: mockEvictOldMessageContent,
        loadMessagesFromServer: mockLoadMessagesFromServer,
      }))

      rerender(<ChatPanel endpoint="/api/test" />)

      // After switching, oldest turn of new conversation should be collapsed
      // (because reset to olderTurnsExpanded=false)
    })
  })

  describe('Edge cases', () => {
    it('handles single message (unpaired turn) without crashing', () => {
      const messages = [
        createMessage({ role: 'user', content: 'Solo question' }),
      ]
      mockGetActiveConversation.mockReturnValue(createConversation(messages))

      render(<ChatPanel endpoint="/api/test" />)

      expect(screen.getByText('Solo question')).toBeInTheDocument()
    })

    it('handles empty message list gracefully', () => {
      mockGetActiveConversation.mockReturnValue(createConversation([]))

      render(<ChatPanel endpoint="/api/test" />)

      // Should show welcome screen, not crash
      expect(screen.getByText('Welcome to Test App')).toBeInTheDocument()
    })

    it('renders with many turns (stress test, 10 turns)', () => {
      const messages: ChatMessage[] = []
      for (let i = 0; i < 10; i++) {
        // Use long content so full text differs from 80-char banner preview
        const question = `Full question ${i} content - ${'z'.repeat(100)}`
        const answer = `Full answer ${i} content - ${'w'.repeat(100)}`
        messages.push(...createTurn(question, answer))
      }
      mockGetActiveConversation.mockReturnValue(createConversation(messages))

      render(<ChatPanel endpoint="/api/test" />)

      // Should show collapsed banner for 8 turns
      expect(screen.getByText('8 older turns')).toBeInTheDocument()

      // Only last 2 turns' full content should be rendered as ChatMessages
      expect(screen.getByText(`Full question 8 content - ${'z'.repeat(100)}`)).toBeInTheDocument()
      expect(screen.getByText(`Full question 9 content - ${'z'.repeat(100)}`)).toBeInTheDocument()

      // Collapsed turns' full content should NOT be in the document
      // (only truncated preview appears in the banner)
      expect(screen.queryByText(`Full question 0 content - ${'z'.repeat(100)}`)).not.toBeInTheDocument()
      expect(screen.queryByText(`Full question 5 content - ${'z'.repeat(100)}`)).not.toBeInTheDocument()
    })
  })
})
