/**
 * Unit tests for LiveStreamBanner component
 *
 * Covers:
 * - Hidden when no conversations are streaming
 * - Visible with singular message for 1 streaming conversation
 * - Visible with plural message for multiple streaming conversations
 * - Navigates directly when exactly one response is active
 * - Opens a destination chooser when multiple responses are active
 * - Contains accessibility attributes (role="status", aria-live)
 */

import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'

// ============================================================================
// Mocks — must be before imports
// ============================================================================

let mockStreamingConversations = new Map<string, unknown>()
let mockConversations: Array<{ id: string; title: string }> = []
let mockTomeChats: Record<string, unknown> = {}

jest.mock('@/store/chat-store', () => {
  const store = (selector?: (s: unknown) => unknown) => {
    const state = {
      streamingConversations: mockStreamingConversations,
      conversations: mockConversations,
    }
    return selector ? selector(state) : state
  }

  store.getState = () => ({ streamingConversations: mockStreamingConversations })
  store.setState = jest.fn()
  store.subscribe = jest.fn()

  return { useChatStore: store }
})

jest.mock('@/store/tome-chat-store', () => ({
  useTomeChatStore: (selector: (state: unknown) => unknown) =>
    selector({ chats: mockTomeChats }),
}))

jest.mock('lucide-react', () => ({
  Radio: (props: unknown) => <span data-testid="icon-radio" {...props} />,
  MessageSquare: (props: unknown) => <span data-testid="icon-message" {...props} />,
  ChevronRight: (props: unknown) => <span data-testid="icon-chevron" {...props} />,
}))

// ============================================================================
// Imports — after mocks
// ============================================================================

import { LiveStreamBanner } from '../LiveStreamBanner'

// ============================================================================
// Tests
// ============================================================================

describe('LiveStreamBanner', () => {
  beforeEach(() => {
    mockStreamingConversations = new Map()
    mockConversations = []
    mockTomeChats = {}
  })

  it('renders nothing when no conversations are streaming', () => {
    const { container } = render(<LiveStreamBanner />)

    expect(container.firstChild).toBeNull()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('renders singular message for 1 streaming conversation', () => {
    mockStreamingConversations = new Map([
      ['conv-1', { conversationId: 'conv-1', messageId: 'msg-1', client: {} }],
    ])

    render(<LiveStreamBanner />)

    expect(screen.getByText(/1 live response in progress/)).toBeInTheDocument()
  })

  it('renders plural message for multiple streaming conversations', () => {
    mockStreamingConversations = new Map([
      ['conv-1', { conversationId: 'conv-1', messageId: 'msg-1', client: {} }],
      ['conv-2', { conversationId: 'conv-2', messageId: 'msg-2', client: {} }],
    ])

    render(<LiveStreamBanner />)

    expect(screen.getByText(/2 live responses in progress/)).toBeInTheDocument()
  })

  it('includes active TOME agent streams in the global count', () => {
    mockTomeChats = {
      'example-project:active': {
        streaming: true,
        streamDestination: {
          href: '/projects/example-project/tome',
          label: 'Example Project',
        },
      },
    }

    render(<LiveStreamBanner />)

    expect(
      screen.getByText('1 live response in progress. Click to navigate'),
    ).toBeInTheDocument()
  })

  it('combines CAIPE and TOME streams', () => {
    mockStreamingConversations = new Map([
      ['conv-1', { conversationId: 'conv-1', messageId: 'msg-1', client: {} }],
    ])
    mockTomeChats = {
      'example-project:active': {
        streaming: true,
        streamDestination: {
          href: '/projects/example-project/tome',
          label: 'Example Project',
        },
      },
    }

    render(<LiveStreamBanner />)

    expect(
      screen.getByText('2 live responses in progress. Click to navigate'),
    ).toBeInTheDocument()
  })

  it('shows label text matching streaming count', () => {
    mockStreamingConversations = new Map([
      ['conv-1', { conversationId: 'conv-1', messageId: 'msg-1', client: {} }],
    ])

    render(<LiveStreamBanner />)

    expect(
      screen.getByText('1 live response in progress. Click to navigate'),
    ).toBeInTheDocument()
  })

  it('has accessible role="status" and aria-live="polite"', () => {
    mockStreamingConversations = new Map([
      ['conv-1', { conversationId: 'conv-1', messageId: 'msg-1', client: {} }],
    ])

    render(<LiveStreamBanner />)

    const banner = screen.getByRole('status')
    expect(banner).toBeInTheDocument()
    expect(banner).toHaveAttribute('aria-live', 'polite')
  })

  it('renders the Radio icon', () => {
    mockStreamingConversations = new Map([
      ['conv-1', { conversationId: 'conv-1', messageId: 'msg-1', client: {} }],
    ])

    render(<LiveStreamBanner />)

    expect(screen.getByTestId('icon-radio')).toBeInTheDocument()
  })

  it('navigates directly to the only active CAIPE conversation', () => {
    mockStreamingConversations = new Map([
      ['conv-1', { conversationId: 'conv-1', messageId: 'msg-1', client: {} }],
    ])
    mockConversations = [{ id: 'conv-1', title: 'Deployment help' }]

    render(<LiveStreamBanner />)
    expect(
      screen.getByRole('link', {
        name: /1 live response in progress.*Deployment help/i,
      }),
    ).toHaveAttribute('href', '/chat/conv-1')
  })

  it('navigates directly to the only active TOME agent chat', () => {
    mockTomeChats = {
      'example-project:active': {
        streaming: true,
        streamDestination: {
          href: '/projects/example-project/tome',
          label: 'Example Project',
        },
      },
    }

    render(<LiveStreamBanner />)
    expect(
      screen.getByRole('link', {
        name: /1 live response in progress.*Example Project/i,
      }),
    ).toHaveAttribute('href', '/projects/example-project/tome')
  })

  it('shows a chooser and navigates to the selected response when multiple are active', () => {
    mockStreamingConversations = new Map([
      ['conv-1', { conversationId: 'conv-1', messageId: 'msg-1', client: {} }],
    ])
    mockConversations = [{ id: 'conv-1', title: 'Deployment help' }]
    mockTomeChats = {
      'example-project:active': {
        streaming: true,
        streamDestination: {
          href: '/projects/example-project/tome',
          label: 'Example Project',
        },
      },
    }

    render(<LiveStreamBanner />)
    fireEvent.click(
      screen.getByRole('button', {
        name: /2 live responses in progress.*choose a response/i,
      }),
    )

    expect(screen.getByText('Live responses')).toBeInTheDocument()
    expect(screen.getByText('Deployment help')).toBeInTheDocument()
    expect(screen.getByText('CAIPE chat')).toBeInTheDocument()
    expect(screen.getByText('Example Project')).toBeInTheDocument()
    expect(screen.getByText('TOME agent')).toBeInTheDocument()

    expect(
      screen.getByRole('link', { name: /Example Project TOME agent/i }),
    ).toHaveAttribute('href', '/projects/example-project/tome')
  })
})
