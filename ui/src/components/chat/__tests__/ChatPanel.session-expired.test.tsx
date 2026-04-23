/**
 * Unit tests: session-expired errors must not be persisted in chat history.
 *
 * When the A2A client receives a 401, it throws "Session expired: …".
 * The TokenExpiryGuard already handles the UX (modal + redirect), so
 * appendToMessage must NOT be called for that error class.  All other
 * errors (network failure, backend 500, etc.) must still appear inline.
 *
 * Tests:
 * - Stream error: session-expired is NOT appended to chat
 * - Stream error: non-session-expired error IS appended to chat
 */

import React from 'react'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'

// ============================================================================
// Polyfills (jsdom gaps)
// ============================================================================

Element.prototype.scrollIntoView = jest.fn()

// ============================================================================
// Tracked mocks — stable references so we can assert on them
// ============================================================================

const mockAppendToMessage = jest.fn()
const mockUpdateMessage = jest.fn()
const mockAddMessage = jest.fn(() => 'assistant-msg-1')
const mockGetActiveConversation = jest.fn()
const mockIsConversationStreaming = jest.fn(() => false)
const mockSetConversationStreaming = jest.fn()

// ============================================================================
// Module mocks — must be declared before imports
// ============================================================================

jest.mock('next-auth/react', () => ({
  useSession: jest.fn(() => ({
    data: { user: { name: 'Test', email: 'test@test.com' }, accessToken: 'tok' },
    status: 'authenticated',
    update: jest.fn(),
  })),
}))

jest.mock('@/store/chat-store', () => {
  const mockUseChatStore: any = jest.fn(() => ({
    activeConversationId: 'conv-1',
    getActiveConversation: mockGetActiveConversation,
    createConversation: jest.fn(() => 'conv-1'),
    addMessage: mockAddMessage,
    updateMessage: mockUpdateMessage,
    appendToMessage: mockAppendToMessage,
    addEventToMessage: jest.fn(),
    addA2AEvent: jest.fn(),
    clearA2AEvents: jest.fn(),
    addSSEEvent: jest.fn(),
    clearSSEEvents: jest.fn(),
    setConversationStreaming: mockSetConversationStreaming,
    isConversationStreaming: mockIsConversationStreaming,
    cancelConversationRequest: jest.fn(),
    updateMessageFeedback: jest.fn(),
    consumePendingMessage: jest.fn(() => null),
    recoverInterruptedTask: jest.fn(),
    evictOldMessageContent: jest.fn(),
    loadMessagesFromServer: jest.fn(),
    updateConversationTitle: jest.fn(),
  }))
  mockUseChatStore.getState = jest.fn(() => ({ conversations: [] }))
  return { useChatStore: mockUseChatStore }
})

jest.mock('@/lib/a2a-sdk-client', () => ({
  A2ASDKClient: jest.fn(),
  toStoreEvent: jest.fn((e: any, id: string) => ({ ...e, id })),
}))

jest.mock('@/lib/config', () => ({
  getConfig: jest.fn((key: string) => {
    const cfg: Record<string, any> = {
      appName: 'Test App',
      tagline: 'Tagline',
      description: 'Desc',
      ssoEnabled: false,
    }
    return cfg[key] ?? null
  }),
}))

jest.mock('@/lib/utils', () => ({
  cn: (...args: any[]) => args.filter(Boolean).join(' '),
  deduplicateByKey: (arr: any[], keyFn: (i: any) => string) => {
    const seen = new Set<string>()
    return arr.filter((item: any) => {
      const key = keyFn(item)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  },
}))

jest.mock('framer-motion', () => ({
  motion: {
    div: React.forwardRef(({ children, ...p }: any, ref: any) => <div ref={ref} {...p}>{children}</div>),
    button: React.forwardRef(({ children, ...p }: any, ref: any) => <button ref={ref} {...p}>{children}</button>),
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}))

jest.mock('react-markdown', () => ({ children }: any) => <div>{children}</div>)
jest.mock('remark-gfm', () => () => {})
jest.mock('react-syntax-highlighter', () => ({
  Prism: ({ children }: any) => <pre>{children}</pre>,
}))

// Mock MarkdownRenderer to avoid shiki ESM resolution issues in Jest
jest.mock('@/components/shared/timeline/MarkdownRenderer', () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <span>{content}</span>,
}))
jest.mock('react-syntax-highlighter/dist/esm/styles/prism', () => ({ oneDark: {} }))
jest.mock('react-textarea-autosize', () =>
  React.forwardRef((props: any, ref: any) => <textarea ref={ref} {...props} />)
)

jest.mock('../FeedbackButton', () => ({ FeedbackButton: () => null }))
jest.mock('../CustomCallButtons', () => ({ DEFAULT_AGENTS: [], CustomCall: () => null }))
jest.mock('@/components/shared/AgentLogos', () => ({ AGENT_LOGOS: {} }))
jest.mock('../MetadataInputForm', () => ({ MetadataInputForm: () => null }))
jest.mock('../AgentStreamBox', () => ({
  AgentStreamBox: () => <div data-testid="agent-stream-box" />,
}))

jest.mock('@/components/ui/scroll-area', () => ({
  ScrollArea: React.forwardRef(({ children, viewportRef, ...props }: any, ref: any) => {
    const setRef = React.useCallback((node: HTMLDivElement | null) => {
      if (viewportRef) viewportRef.current = node
    }, [viewportRef])
    return (
      <div ref={ref} data-testid="scroll-area" {...props}>
        <div ref={setRef} data-testid="scroll-viewport">{children}</div>
      </div>
    )
  }),
}))

jest.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: any) => <>{children}</>,
  TooltipContent: ({ children }: any) => <div>{children}</div>,
  TooltipProvider: ({ children }: any) => <>{children}</>,
  TooltipTrigger: React.forwardRef(({ children, ...props }: any, ref: any) => (
    <div ref={ref} data-testid="tooltip-trigger" {...props}>
      {children}
    </div>
  )),
}))

jest.mock('@/components/ui/button', () => ({
  Button: React.forwardRef(({ children, ...p }: any, ref: any) => <button ref={ref} {...p}>{children}</button>),
}))

// ============================================================================
// Imports — after mocks
// ============================================================================

import { SupervisorChatPanel as ChatPanel } from '../ChatPanel'
import { A2ASDKClient } from '@/lib/a2a-sdk-client'

// ============================================================================
// Helpers
// ============================================================================

function setupA2AClientToThrow(errorMessage: string) {
  ;(A2ASDKClient as jest.Mock).mockImplementation(() => ({
    abort: jest.fn(),
    sendMessageStream: jest.fn().mockImplementation(async function* () {
      throw new Error(errorMessage)
    }),
  }))
}

async function renderAndSendMessage(message = 'hello world') {
  mockGetActiveConversation.mockReturnValue({
    id: 'conv-1',
    title: 'Test',
    messages: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  })

  render(<ChatPanel endpoint="/api/test" />)

  const textarea = screen.getByRole('textbox')
  fireEvent.change(textarea, { target: { value: message } })

  await act(async () => {
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter', charCode: 13 })
    // Flush microtask queue so the async submitMessage catch block runs
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

// ============================================================================
// Tests
// ============================================================================

describe('ChatPanel — session-expired error suppression', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockIsConversationStreaming.mockReturnValue(false)
    mockAddMessage.mockReturnValue('assistant-msg-1')
  })

  it('does NOT append "Session expired" error to chat history', async () => {
    setupA2AClientToThrow(
      'Session expired: Your authentication token has expired. Please save your work and log in again.'
    )

    await renderAndSendMessage()

    await waitFor(() => {
      const calls = mockAppendToMessage.mock.calls
      const hasSessionExpiredMsg = calls.some(
        (args) => typeof args[2] === 'string' && args[2].includes('Session expired')
      )
      expect(hasSessionExpiredMsg).toBe(false)
    })
  })

  it('DOES surface non-session-expired errors in the chat message', async () => {
    setupA2AClientToThrow('Network error: connection refused')

    await renderAndSendMessage()

    await waitFor(() => {
      // Errors are surfaced via updateMessage (replaces placeholder with error content)
      expect(mockUpdateMessage).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ isError: true })
      )
    })
  })

  it('does not suppress errors that merely contain "session" elsewhere in the message', async () => {
    setupA2AClientToThrow('Invalid session configuration detected')

    await renderAndSendMessage()

    await waitFor(() => {
      expect(mockUpdateMessage).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ isError: true })
      )
    })
  })
})
