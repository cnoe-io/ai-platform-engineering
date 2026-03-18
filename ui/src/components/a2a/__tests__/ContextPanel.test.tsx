/**
 * Unit tests for ContextPanel — now a debug-only A2A event viewer.
 *
 * The ContextPanel no longer renders execution plans, tool calls, or tasks.
 * Those are handled by AgentTimeline inside ChatPanel.
 * ContextPanel only shows the raw A2A debug stream, event count badge,
 * and live/collapsed states.
 */

import React from 'react'
import { render, screen } from '@testing-library/react'

// ============================================================================
// Mocks
// ============================================================================

jest.mock('framer-motion', () => ({
  motion: {
    div: React.forwardRef(({ children, initial, animate, exit, transition, ...props }: any, ref: any) => (
      <div ref={ref} {...props}>{children}</div>
    )),
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}))

jest.mock('zustand/react/shallow', () => ({
  useShallow: (fn: any) => fn,
}))

let mockStoreState: Record<string, any> = {
  isStreaming: false,
  activeConversationId: null,
  conversations: [],
}

jest.mock('@/store/chat-store', () => ({
  useChatStore: (selector: any) => {
    if (typeof selector === 'function') return selector(mockStoreState)
    return mockStoreState
  },
}))

jest.mock('@/lib/utils', () => ({
  cn: (...args: any[]) => args.filter(Boolean).join(' '),
}))

jest.mock('@/components/ui/scroll-area', () => ({
  ScrollArea: ({ children, ...props }: any) => <div data-testid="scroll-area" {...props}>{children}</div>,
}))

jest.mock('@/components/ui/badge', () => ({
  Badge: ({ children, ...props }: any) => <span data-testid="badge" {...props}>{children}</span>,
}))

jest.mock('@/components/ui/button', () => ({
  Button: React.forwardRef(({ children, ...props }: any, ref: any) => (
    <button ref={ref} {...props}>{children}</button>
  )),
}))

jest.mock('@/components/a2a/A2AStreamPanel', () => ({
  A2AStreamPanel: () => <div data-testid="a2a-stream-panel">A2A Stream Panel</div>,
}))

// ============================================================================
// Imports
// ============================================================================

import { ContextPanel } from '../ContextPanel'

// ============================================================================
// Helpers
// ============================================================================

function makeConversation(id: string, eventCount: number) {
  const events = Array.from({ length: eventCount }, (_, i) => ({
    id: `evt-${i}`,
    timestamp: Date.now(),
    type: 'artifact' as const,
    displayName: 'Event',
    displayContent: '',
    color: 'blue',
    icon: 'wrench',
    raw: {},
  }))
  return {
    id,
    title: 'Test',
    messages: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    a2aEvents: events,
  }
}

function setStoreState(overrides: Partial<typeof mockStoreState>) {
  Object.assign(mockStoreState, overrides)
}

// ============================================================================
// Tests
// ============================================================================

describe('ContextPanel', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockStoreState = {
      isStreaming: false,
      activeConversationId: null,
      conversations: [],
    }
  })

  it('should show event count badge matching conversation a2aEvents length', () => {
    setStoreState({
      activeConversationId: 'conv-1',
      conversations: [makeConversation('conv-1', 7)],
    })

    render(<ContextPanel collapsed={false} />)

    expect(screen.getByText('7')).toBeInTheDocument()
  })

  it('should show Live indicator only when streaming with an active conversation', () => {
    setStoreState({
      isStreaming: true,
      activeConversationId: 'conv-1',
      conversations: [makeConversation('conv-1', 0)],
    })

    const { rerender } = render(<ContextPanel collapsed={false} />)
    expect(screen.getByText('Live')).toBeInTheDocument()

    // Stop streaming - Live should disappear
    setStoreState({ isStreaming: false })
    rerender(<ContextPanel collapsed={false} />)
    expect(screen.queryByText('Live')).not.toBeInTheDocument()
  })

  it('should hide A2AStreamPanel content when collapsed', () => {
    setStoreState({
      activeConversationId: 'conv-1',
      conversations: [makeConversation('conv-1', 3)],
    })

    const { rerender } = render(<ContextPanel collapsed={false} />)
    expect(screen.getByTestId('a2a-stream-panel')).toBeInTheDocument()

    rerender(<ContextPanel collapsed={true} />)
    expect(screen.queryByTestId('a2a-stream-panel')).not.toBeInTheDocument()
  })
})
