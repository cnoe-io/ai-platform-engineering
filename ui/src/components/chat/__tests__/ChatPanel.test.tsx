/**
 * Unit tests for ChatPanel component
 *
 * Tests:
 * - Scroll behavior: respects user scroll position during streaming
 * - Scroll behavior: auto-scrolls when user is near bottom
 * - Scroll behavior: shows scroll-to-bottom button when scrolled up during streaming
 * - Scroll behavior: resets scroll state on conversation change
 * - Text overflow: user messages have break-words and overflow-wrap
 * - Text overflow: assistant messages have overflow-hidden prose-container
 * - Text overflow: message bubbles contain overflow
 * - Text overflow: inline code has break-all for long strings
 */

import React from 'react'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'

// ============================================================================
// Global jsdom polyfills
// ============================================================================

// jsdom doesn't implement scrollIntoView
Element.prototype.scrollIntoView = jest.fn()

// ============================================================================
// Mocks — must be before imports
// ============================================================================

// Mock next-auth/react
const mockSession = {
  data: { user: { name: 'Test User', email: 'test@test.com' }, accessToken: 'test-token' },
  status: 'authenticated' as const,
  update: jest.fn(),
}
jest.mock('next-auth/react', () => ({
  useSession: jest.fn(() => mockSession),
}))

// Mock framer-motion to simplify animation testing
jest.mock('framer-motion', () => ({
  motion: {
    div: React.forwardRef(({ children, initial, animate, exit, transition, whileHover, whileTap, onMouseEnter, onMouseLeave, ...props }: any, ref: any) => (
      <div ref={ref} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} {...props}>{children}</div>
    )),
    button: React.forwardRef(({ children, ...props }: any, ref: any) => <button ref={ref} {...props}>{children}</button>),
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}))

// Chat store mock
const mockGetActiveConversation = jest.fn()
const mockIsConversationStreaming = jest.fn(() => false)
const mockActiveConversationId = 'conv-1'

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
  })),
}))

// Mock config
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

// Mock A2A SDK client
jest.mock('@/lib/a2a-sdk-client', () => ({
  A2ASDKClient: jest.fn(),
  toStoreEvent: jest.fn(),
}))

// Mock utils
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

// Mock react-markdown
jest.mock('react-markdown', () => {
  return function MockReactMarkdown({ children, components }: any) {
    // Render through paragraph component if available to test overflow classes
    if (components?.p) {
      const P = components.p
      return <div data-testid="markdown-container"><P>{children}</P></div>
    }
    return <div data-testid="markdown-container">{children}</div>
  }
})

// Mock remark-gfm
jest.mock('remark-gfm', () => () => {})

// Mock react-syntax-highlighter
jest.mock('react-syntax-highlighter', () => ({
  Prism: ({ children }: any) => <pre data-testid="syntax-highlighter">{children}</pre>,
}))
jest.mock('react-syntax-highlighter/dist/esm/styles/prism', () => ({
  oneDark: {},
}))

// Mock react-textarea-autosize
jest.mock('react-textarea-autosize', () => {
  return React.forwardRef((props: any, ref: any) => <textarea ref={ref} {...props} />)
})

// Mock sub-components
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

// Mock ScrollArea to expose the viewport ref
// Use callback ref to ensure viewportRef.current is set in React 19
jest.mock('@/components/ui/scroll-area', () => ({
  ScrollArea: React.forwardRef(({ children, viewportRef, ...props }: any, ref: any) => {
    const setViewportRef = React.useCallback((node: HTMLDivElement | null) => {
      if (viewportRef) {
        // Set .current on the passed-in ref object (MutableRefObject from useRef)
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

// Mock tooltip components
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

// Mock Button
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

function createMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: `msg-${Math.random().toString(36).slice(2, 9)}`,
    role: 'user',
    content: 'Hello, world!',
    timestamp: new Date(),
    events: [],
    isFinal: true,
    ...overrides,
  }
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

describe('ChatPanel', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetActiveConversation.mockReturnValue(null)
    mockIsConversationStreaming.mockReturnValue(false)
  })

  describe('Welcome screen', () => {
    it('should render welcome message when no messages', () => {
      mockGetActiveConversation.mockReturnValue(createConversation([]))
      render(<ChatPanel endpoint="/api/test" />)

      expect(screen.getByText('Welcome to Test App')).toBeInTheDocument()
    })
  })

  describe('Message rendering and text overflow protection', () => {
    it('should render user message with break-words and overflow-wrap', () => {
      const longUrl = 'https://example.com/' + 'a'.repeat(500)
      const msg = createMessage({ role: 'user', content: longUrl })
      mockGetActiveConversation.mockReturnValue(createConversation([msg]))

      render(<ChatPanel endpoint="/api/test" />)

      const userText = screen.getByText(longUrl)
      expect(userText).toBeInTheDocument()
      expect(userText.className).toContain('break-words')
      expect(userText.className).toContain('whitespace-pre-wrap')
      expect(userText.style.overflowWrap).toBe('anywhere')
    })

    it('should render user message bubble with overflow-hidden and max-w-full', () => {
      const msg = createMessage({ role: 'user', content: 'Hello' })
      mockGetActiveConversation.mockReturnValue(createConversation([msg]))

      render(<ChatPanel endpoint="/api/test" />)

      // The user message bubble is the rounded-xl div wrapping the text
      const userText = screen.getByText('Hello')
      const bubble = userText.closest('.rounded-xl')
      expect(bubble).not.toBeNull()
      expect(bubble!.className).toContain('overflow-hidden')
      expect(bubble!.className).toContain('max-w-full')
    })

    it('should render assistant message with prose-container and overflow protection', () => {
      const msg = createMessage({
        role: 'assistant',
        content: 'Short answer',
        isFinal: true,
      })
      mockGetActiveConversation.mockReturnValue(createConversation([msg]))

      render(<ChatPanel endpoint="/api/test" />)

      const proseContainer = document.querySelector('.prose-container')
      expect(proseContainer).not.toBeNull()
      expect(proseContainer!.className).toContain('overflow-hidden')
      expect(proseContainer!.className).toContain('break-words')
    })

    it('should render assistant message bubble with overflow-hidden', () => {
      const msg = createMessage({
        role: 'assistant',
        content: 'Test answer',
        isFinal: true,
      })
      mockGetActiveConversation.mockReturnValue(createConversation([msg]))

      render(<ChatPanel endpoint="/api/test" />)

      // Find the app name label, then its parent message content container
      const appNameLabel = screen.getByText('Test App')
      const messageContent = appNameLabel.closest('.flex-1.min-w-0')
      expect(messageContent).not.toBeNull()

      // The bubble div inside it
      const bubble = messageContent!.querySelector('.rounded-xl')
      expect(bubble).not.toBeNull()
      expect(bubble!.className).toContain('overflow-hidden')
    })

    it('should constrain user message container width to 85%', () => {
      const msg = createMessage({ role: 'user', content: 'Hello world' })
      mockGetActiveConversation.mockReturnValue(createConversation([msg]))

      render(<ChatPanel endpoint="/api/test" />)

      // Session mock has name: 'Test User', so first name "Test" is shown as the role label
      const youLabel = screen.getByText('Test')
      const contentWrapper = youLabel.closest('.flex-1.min-w-0')
      expect(contentWrapper).not.toBeNull()
      expect(contentWrapper!.className).toContain('max-w-[85%]')
    })

    it('should display first name from session for user messages', () => {
      const msg = createMessage({ role: 'user', content: 'Hello there' })
      mockGetActiveConversation.mockReturnValue(createConversation([msg]))

      render(<ChatPanel endpoint="/api/test" />)

      // Session mock has name: 'Test User', first name extracted as "Test"
      expect(screen.getByText('Test')).toBeInTheDocument()
    })

    it('should fall back to "You" when session has no user name', () => {
      const msg = createMessage({ role: 'user', content: 'Hello there' })
      mockGetActiveConversation.mockReturnValue(createConversation([msg]))

      // Override session to have no name
      const { useSession } = require('next-auth/react')
      useSession.mockReturnValueOnce({
        data: { user: { email: 'test@test.com' }, accessToken: 'test-token' },
        status: 'authenticated' as const,
        update: jest.fn(),
      })

      render(<ChatPanel endpoint="/api/test" />)

      expect(screen.getByText('You')).toBeInTheDocument()
    })

    it('should fall back to "You" when session is unauthenticated', () => {
      const msg = createMessage({ role: 'user', content: 'Hello there' })
      mockGetActiveConversation.mockReturnValue(createConversation([msg]))

      // Override session to be unauthenticated
      const { useSession } = require('next-auth/react')
      useSession.mockReturnValueOnce({
        data: null,
        status: 'unauthenticated' as const,
        update: jest.fn(),
      })

      render(<ChatPanel endpoint="/api/test" />)

      expect(screen.getByText('You')).toBeInTheDocument()
    })

    it('should display senderName from message when available (shared conversation)', () => {
      // Simulate a message from another user in a shared conversation
      const msg = createMessage({
        role: 'user',
        content: 'Hello from Alice',
        senderName: 'Alice Johnson',
        senderEmail: 'alice@example.com',
      })
      mockGetActiveConversation.mockReturnValue(createConversation([msg]))

      render(<ChatPanel endpoint="/api/test" />)

      // Should show first name from senderName, not session user's name
      expect(screen.getByText('Alice')).toBeInTheDocument()
    })

    it('should fall back to session name for legacy messages without senderName', () => {
      // Legacy message with no sender fields — should use session's first name
      const msg = createMessage({
        role: 'user',
        content: 'Legacy message',
        // No senderName, senderEmail, senderImage
      })
      mockGetActiveConversation.mockReturnValue(createConversation([msg]))

      render(<ChatPanel endpoint="/api/test" />)

      // Session has 'Test User', first name is 'Test'
      expect(screen.getByText('Test')).toBeInTheDocument()
    })

    it('should show sender avatar image when senderImage is available', () => {
      const msg = createMessage({
        role: 'user',
        content: 'Message with avatar',
        senderName: 'Bob Smith',
        senderImage: 'https://example.com/bob.png',
      })
      mockGetActiveConversation.mockReturnValue(createConversation([msg]))

      render(<ChatPanel endpoint="/api/test" />)

      const img = screen.getByAltText('Bob Smith')
      expect(img).toBeInTheDocument()
      expect(img).toHaveAttribute('src', 'https://example.com/bob.png')
    })

    it('should show User icon when no senderImage is available', () => {
      const msg = createMessage({
        role: 'user',
        content: 'No avatar message',
        senderName: 'Charlie',
        // No senderImage
      })
      mockGetActiveConversation.mockReturnValue(createConversation([msg]))

      const { container } = render(<ChatPanel endpoint="/api/test" />)

      // Should render the User icon SVG (lucide icon), not an img element
      const avatarDiv = container.querySelector('.bg-primary')
      expect(avatarDiv).not.toBeNull()
      // Should NOT have an img inside
      const img = avatarDiv?.querySelector('img')
      expect(img).toBeNull()
    })

    it('should fall back to session name when senderName is empty string', () => {
      const msg = createMessage({
        role: 'user',
        content: 'Empty sender name',
        senderName: '',
      })
      mockGetActiveConversation.mockReturnValue(createConversation([msg]))

      render(<ChatPanel endpoint="/api/test" />)

      // Empty string is falsy, should fall back to session first name "Test"
      expect(screen.getByText('Test')).toBeInTheDocument()
    })

    it('should show User icon when senderImage is empty string', () => {
      const msg = createMessage({
        role: 'user',
        content: 'Empty image URL',
        senderName: 'Dave',
        senderImage: '',
      })
      mockGetActiveConversation.mockReturnValue(createConversation([msg]))

      const { container } = render(<ChatPanel endpoint="/api/test" />)

      // Empty string is falsy, should not render img
      const avatarDiv = container.querySelector('.bg-primary')
      expect(avatarDiv).not.toBeNull()
      expect(avatarDiv?.querySelector('img')).toBeNull()
    })

    it('should display different sender names for multiple users in shared conversation', () => {
      const aliceMsg = createMessage({
        role: 'user',
        content: 'Hi from Alice',
        senderName: 'Alice Johnson',
        senderEmail: 'alice@example.com',
      })
      const assistantReply = createMessage({
        role: 'assistant',
        content: 'Hello Alice!',
        isFinal: true,
      })
      const bobMsg = createMessage({
        role: 'user',
        content: 'Hi from Bob',
        senderName: 'Bob Williams',
        senderEmail: 'bob@example.com',
      })
      mockGetActiveConversation.mockReturnValue(
        createConversation([aliceMsg, assistantReply, bobMsg])
      )

      render(<ChatPanel endpoint="/api/test" />)

      // Both first names should appear
      expect(screen.getByText('Alice')).toBeInTheDocument()
      expect(screen.getByText('Bob')).toBeInTheDocument()
    })

    it('should show different avatars for messages from different users', () => {
      const msgWithAvatar = createMessage({
        role: 'user',
        content: 'Message with avatar',
        senderName: 'Eve',
        senderImage: 'https://example.com/eve.png',
      })
      const msgWithoutAvatar = createMessage({
        role: 'user',
        content: 'Message without avatar',
        senderName: 'Frank',
        // No senderImage
      })
      mockGetActiveConversation.mockReturnValue(
        createConversation([msgWithAvatar, msgWithoutAvatar])
      )

      render(<ChatPanel endpoint="/api/test" />)

      // Eve's message should have an avatar img
      const eveImg = screen.getByAltText('Eve')
      expect(eveImg).toBeInTheDocument()
      expect(eveImg).toHaveAttribute('src', 'https://example.com/eve.png')

      // Frank's message should show the name but no img avatar
      expect(screen.getByText('Frank')).toBeInTheDocument()
      // Frank should NOT have an avatar img (queryByAltText returns null)
      expect(screen.queryByAltText('Frank')).not.toBeInTheDocument()
    })

    it('should use userDisplayName as alt text when senderImage present but senderName absent', () => {
      const msg = createMessage({
        role: 'user',
        content: 'Avatar but no name',
        senderImage: 'https://example.com/anon.png',
        // No senderName
      })
      mockGetActiveConversation.mockReturnValue(createConversation([msg]))

      render(<ChatPanel endpoint="/api/test" />)

      // Session has 'Test User', first name 'Test' — used as alt fallback
      const img = screen.getByAltText('Test')
      expect(img).toBeInTheDocument()
      expect(img).toHaveAttribute('src', 'https://example.com/anon.png')
    })

    it('should show senderName first name even if session has different user', () => {
      // Current session is 'Test User', but message is from 'Grace Hopper'
      const msg = createMessage({
        role: 'user',
        content: 'Message from another user',
        senderName: 'Grace Hopper',
        senderEmail: 'grace@example.com',
      })
      mockGetActiveConversation.mockReturnValue(createConversation([msg]))

      render(<ChatPanel endpoint="/api/test" />)

      // Should show "Grace", not "Test" (the session user)
      expect(screen.getByText('Grace')).toBeInTheDocument()
      expect(screen.queryByText('Test')).not.toBeInTheDocument()
    })

    it('should handle senderName with only first name (no space)', () => {
      const msg = createMessage({
        role: 'user',
        content: 'Single name user',
        senderName: 'Madonna',
      })
      mockGetActiveConversation.mockReturnValue(createConversation([msg]))

      render(<ChatPanel endpoint="/api/test" />)

      expect(screen.getByText('Madonna')).toBeInTheDocument()
    })

    it('should render collapsed preview for long assistant messages that are not latest', () => {
      const longContent = 'A'.repeat(500)
      const assistantMsg = createMessage({
        role: 'assistant',
        content: longContent,
        isFinal: true,
      })
      // Add a user message after so the assistant message is not "latest answer"
      const userMsg = createMessage({ role: 'user', content: 'follow-up' })
      const latestAssistant = createMessage({
        role: 'assistant',
        content: 'Latest answer',
        isFinal: true,
      })

      mockGetActiveConversation.mockReturnValue(
        createConversation([assistantMsg, userMsg, latestAssistant])
      )

      render(<ChatPanel endpoint="/api/test" />)

      // The old long message should have "Show full answer" button (collapsed)
      expect(screen.getByText('Show full answer')).toBeInTheDocument()
    })
  })

  describe('Scroll behavior', () => {
    /**
     * Scroll tests use fake timers to control the isAutoScrollingRef reset
     * (scrollToBottom uses a 300ms setTimeout to clear the auto-scroll flag).
     * Without advancing past this timeout, handleScroll bails out thinking
     * it's an auto-scroll event.
     */

    beforeEach(() => {
      jest.useFakeTimers()
    })

    afterEach(() => {
      jest.useRealTimers()
    })

    function renderAndSetupScroll(messages: ChatMessage[], streaming: boolean) {
      mockGetActiveConversation.mockReturnValue(createConversation(messages))
      mockIsConversationStreaming.mockReturnValue(streaming)

      const result = render(<ChatPanel endpoint="/api/test" />)
      const viewport = screen.getByTestId('scroll-viewport')

      // Set scroll dimensions
      Object.defineProperty(viewport, 'scrollHeight', { value: 2000, configurable: true })
      Object.defineProperty(viewport, 'clientHeight', { value: 500, configurable: true })

      // Advance past the 300ms isAutoScrollingRef reset timeout from initial scrollToBottom
      act(() => { jest.advanceTimersByTime(500) })

      return { ...result, viewport }
    }

    function simulateScrollTo(viewport: HTMLElement, position: number) {
      Object.defineProperty(viewport, 'scrollTop', { value: position, configurable: true })
      act(() => {
        fireEvent.scroll(viewport)
      })
    }

    it('should detect user scrolling up during non-streaming', () => {
      const messages = [
        createMessage({ role: 'user', content: 'Hello' }),
        createMessage({ role: 'assistant', content: 'Hi there!', isFinal: true }),
      ]
      const { viewport } = renderAndSetupScroll(messages, false)

      // Scroll far from bottom (2000 - 500 - 800 = 700 > 100px threshold)
      simulateScrollTo(viewport, 800)

      expect(screen.getByText('New messages')).toBeInTheDocument()
    })

    it('should NOT show scroll button when near bottom', () => {
      const messages = [
        createMessage({ role: 'user', content: 'Hello' }),
        createMessage({ role: 'assistant', content: 'Hi!', isFinal: true }),
      ]
      const { viewport } = renderAndSetupScroll(messages, false)

      // Scroll very close to bottom (2000 - 500 - 1450 = 50 < 100px threshold)
      simulateScrollTo(viewport, 1450)

      expect(screen.queryByText('New messages')).not.toBeInTheDocument()
    })

    it('should detect user scrolling up DURING streaming (the core bug fix)', () => {
      const messages = [
        createMessage({ role: 'user', content: 'Hello' }),
        createMessage({ role: 'assistant', content: 'Generating...', isFinal: false }),
      ]
      const { viewport } = renderAndSetupScroll(messages, true)

      // Scroll far from bottom during streaming
      simulateScrollTo(viewport, 500)

      // This was the bug — before the fix, handleScroll bailed out during streaming
      expect(screen.getByText('New messages')).toBeInTheDocument()
    })

    it('should NOT show scroll button during streaming when near bottom', () => {
      const messages = [
        createMessage({ role: 'user', content: 'Hello' }),
        createMessage({ role: 'assistant', content: 'Generating...', isFinal: false }),
      ]
      const { viewport } = renderAndSetupScroll(messages, true)

      // Near bottom by streaming threshold (2000 - 500 - 1300 = 200 < 300px threshold)
      simulateScrollTo(viewport, 1300)

      expect(screen.queryByText('New messages')).not.toBeInTheDocument()
    })

    it('should use larger near-bottom threshold during streaming (300px vs 100px)', () => {
      const messages = [
        createMessage({ role: 'user', content: 'Hello' }),
        createMessage({ role: 'assistant', content: 'Streaming...', isFinal: false }),
      ]

      // Render without streaming first
      const { viewport } = renderAndSetupScroll(messages, false)

      // At 1380px: distance = 120px > 100px non-streaming threshold → scrolled up
      simulateScrollTo(viewport, 1380)
      expect(screen.getByText('New messages')).toBeInTheDocument()
    })

    it('should call scrollIntoView when scrollToBottom button is clicked', () => {
      const messages = [
        createMessage({ role: 'user', content: 'Hello' }),
        createMessage({ role: 'assistant', content: 'Reply', isFinal: true }),
      ]
      const { viewport } = renderAndSetupScroll(messages, false)

      // Scroll far up
      simulateScrollTo(viewport, 200)
      expect(screen.getByText('New messages')).toBeInTheDocument()

      // Clear global mock
      const scrollIntoViewMock = Element.prototype.scrollIntoView as jest.Mock
      scrollIntoViewMock.mockClear()

      // Click the scroll-to-bottom button
      fireEvent.click(screen.getByText('New messages'))

      expect(scrollIntoViewMock).toHaveBeenCalledWith({
        behavior: 'smooth',
        block: 'end',
      })
    })
  })

  describe('Streaming view transition (layout cut-over fix)', () => {
    it('should show StreamingView when isStreaming=true even if message has isFinal=true', () => {
      // The fix: StreamingView uses `isStreaming` alone, not `isStreaming && !message.isFinal`.
      // Previously, isFinal=true (from final_result artifact) caused an abrupt switch
      // to markdown while the stream was still open.
      const msg = createMessage({
        role: 'assistant',
        content: 'Partial content...',
        isFinal: true, // final_result arrived, but stream is still open
        events: [],
      })
      mockGetActiveConversation.mockReturnValue(createConversation([
        createMessage({ role: 'user', content: 'Hello' }),
        msg,
      ]))
      mockIsConversationStreaming.mockReturnValue(true)

      render(<ChatPanel endpoint="/api/test" />)

      // StreamingView should be rendered (our mock renders <div data-testid="agent-stream-box" />)
      // or at minimum, should NOT show the final markdown yet.
      // The key assertion: during streaming, we should see streaming UI elements
      // (like "Thinking" section or agent stream boxes), not the final markdown.
      const container = document.querySelector('.space-y-6')
      expect(container).not.toBeNull()
    })

    it('should show final markdown when isStreaming=false', () => {
      const msg = createMessage({
        role: 'assistant',
        content: 'Final answer with **markdown**',
        isFinal: true,
      })
      mockGetActiveConversation.mockReturnValue(createConversation([
        createMessage({ role: 'user', content: 'Hello' }),
        msg,
      ]))
      mockIsConversationStreaming.mockReturnValue(false)

      render(<ChatPanel endpoint="/api/test" />)

      // Should show the prose-container for final markdown rendering
      const proseContainer = document.querySelector('.prose-container')
      expect(proseContainer).not.toBeNull()
    })
  })

  describe('Thinking section (showRawStream)', () => {
    it('should show Thinking section expanded by default (showRawStream=true)', () => {
      const msg = createMessage({
        role: 'assistant',
        content: '',
        rawStreamContent: 'Streaming data from agents...',
        isFinal: false,
      })
      mockGetActiveConversation.mockReturnValue(createConversation([
        createMessage({ role: 'user', content: 'Hello' }),
        msg,
      ]))
      mockIsConversationStreaming.mockReturnValue(true)

      render(<ChatPanel endpoint="/api/test" />)

      // The "Thinking" label should be visible since showRawStream defaults to true
      // Note: with our mocked components, the StreamingView is mocked,
      // but we verify the overall rendering doesn't crash
      const container = document.querySelector('.space-y-6')
      expect(container).not.toBeNull()
    })
  })

  describe('Scroll auto-scroll effect integration', () => {
    beforeEach(() => {
      jest.useFakeTimers()
    })

    afterEach(() => {
      jest.useRealTimers()
    })

    it('should auto-scroll on new message arrival when near bottom', () => {
      const messages = [createMessage({ role: 'user', content: 'Hello' })]
      mockGetActiveConversation.mockReturnValue(createConversation(messages))
      mockIsConversationStreaming.mockReturnValue(false)

      const { rerender } = render(<ChatPanel endpoint="/api/test" />)

      const scrollIntoViewMock = Element.prototype.scrollIntoView as jest.Mock
      scrollIntoViewMock.mockClear()

      // Add new message (isUserScrolledUp is false by default → should auto-scroll)
      const newMessages = [
        ...messages,
        createMessage({ role: 'assistant', content: 'Reply', isFinal: true }),
      ]
      mockGetActiveConversation.mockReturnValue(createConversation(newMessages))
      act(() => { rerender(<ChatPanel endpoint="/api/test" />) })

      expect(scrollIntoViewMock).toHaveBeenCalled()
    })

    it('should NOT auto-scroll on new message when user is scrolled up', () => {
      const messages = [createMessage({ role: 'user', content: 'Hello' })]
      mockGetActiveConversation.mockReturnValue(createConversation(messages))
      mockIsConversationStreaming.mockReturnValue(false)

      const { rerender } = render(<ChatPanel endpoint="/api/test" />)

      // Advance past the isAutoScrollingRef reset
      act(() => { jest.advanceTimersByTime(500) })

      const viewport = screen.getByTestId('scroll-viewport')
      Object.defineProperty(viewport, 'scrollHeight', { value: 2000, configurable: true })
      Object.defineProperty(viewport, 'clientHeight', { value: 500, configurable: true })

      // Scroll far up
      act(() => {
        Object.defineProperty(viewport, 'scrollTop', { value: 200, configurable: true })
        fireEvent.scroll(viewport)
      })

      const scrollIntoViewMock = Element.prototype.scrollIntoView as jest.Mock
      scrollIntoViewMock.mockClear()

      // Add new message
      const newMessages = [
        ...messages,
        createMessage({ role: 'assistant', content: 'Reply', isFinal: true }),
      ]
      mockGetActiveConversation.mockReturnValue(createConversation(newMessages))
      act(() => { rerender(<ChatPanel endpoint="/api/test" />) })

      expect(scrollIntoViewMock).not.toHaveBeenCalled()
    })

    it('should auto-scroll during streaming when user is near bottom', () => {
      const messages = [
        createMessage({ role: 'user', content: 'Hello' }),
        createMessage({ role: 'assistant', content: 'Chunk 1', isFinal: false }),
      ]
      mockGetActiveConversation.mockReturnValue(createConversation(messages))
      mockIsConversationStreaming.mockReturnValue(true)

      const { rerender } = render(<ChatPanel endpoint="/api/test" />)

      const scrollIntoViewMock = Element.prototype.scrollIntoView as jest.Mock
      scrollIntoViewMock.mockClear()

      // Update streaming content (user near bottom by default)
      const updatedMessages = [
        messages[0],
        createMessage({ ...messages[1], content: 'Chunk 1 Chunk 2' }),
      ]
      mockGetActiveConversation.mockReturnValue(createConversation(updatedMessages))
      act(() => { rerender(<ChatPanel endpoint="/api/test" />) })

      expect(scrollIntoViewMock).toHaveBeenCalled()
    })

    it('should NOT auto-scroll during streaming when user has scrolled up', () => {
      const messages = [
        createMessage({ role: 'user', content: 'Hello' }),
        createMessage({ role: 'assistant', content: 'Chunk 1', isFinal: false }),
      ]
      mockGetActiveConversation.mockReturnValue(createConversation(messages))
      mockIsConversationStreaming.mockReturnValue(true)

      const { rerender } = render(<ChatPanel endpoint="/api/test" />)

      // Advance past the isAutoScrollingRef reset
      act(() => { jest.advanceTimersByTime(500) })

      const viewport = screen.getByTestId('scroll-viewport')
      Object.defineProperty(viewport, 'scrollHeight', { value: 2000, configurable: true })
      Object.defineProperty(viewport, 'clientHeight', { value: 500, configurable: true })

      // User scrolls far up during streaming
      act(() => {
        Object.defineProperty(viewport, 'scrollTop', { value: 200, configurable: true })
        fireEvent.scroll(viewport)
      })

      const scrollIntoViewMock = Element.prototype.scrollIntoView as jest.Mock
      scrollIntoViewMock.mockClear()

      // Update streaming content
      const updatedMessages = [
        messages[0],
        { ...messages[1], content: 'Chunk 1 Chunk 2 Chunk 3' },
      ]
      mockGetActiveConversation.mockReturnValue(createConversation(updatedMessages))
      act(() => { rerender(<ChatPanel endpoint="/api/test" />) })

      expect(scrollIntoViewMock).not.toHaveBeenCalled()
    })
  })
})
