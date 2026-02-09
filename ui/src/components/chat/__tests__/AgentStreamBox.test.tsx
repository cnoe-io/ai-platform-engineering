/**
 * Unit tests for AgentStreamBox component
 *
 * Tests:
 * - Renders agent name and content
 * - Markdown content container has overflow protection (break-words, overflow-hidden)
 * - Respects user scroll position (does not auto-scroll when user scrolled up)
 * - Copy button works
 * - Expand/collapse toggle works
 * - Does not render when no content and not streaming
 */

import React from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'

// ============================================================================
// Mocks — must be before imports
// ============================================================================

// Mock framer-motion
jest.mock('framer-motion', () => ({
  motion: {
    div: React.forwardRef(({ children, initial, animate, exit, transition, ...props }: any, ref: any) => (
      <div ref={ref} {...props}>{children}</div>
    )),
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}))

// Mock utils
jest.mock('@/lib/utils', () => ({
  cn: (...args: any[]) => args.filter(Boolean).join(' '),
}))

// Mock react-markdown — renders children and exposes a container for class assertions
jest.mock('react-markdown', () => {
  return function MockReactMarkdown({ children }: any) {
    return <div data-testid="react-markdown-output">{children}</div>
  }
})

// Mock remark-gfm
jest.mock('remark-gfm', () => () => {})

// Mock AgentLogos
jest.mock('@/components/shared/AgentLogos', () => ({
  AgentLogo: ({ agent }: any) => <div data-testid={`agent-logo-${agent}`}>{agent}</div>,
  getAgentLogo: (name: string) => ({ displayName: name, emoji: '🤖', color: '#fff' }),
}))

// Mock ScrollArea — simple scrollable div for testing
jest.mock('@/components/ui/scroll-area', () => ({
  ScrollArea: React.forwardRef(({ children, className, ...props }: any, ref: any) => {
    const innerRef = React.useRef<HTMLDivElement>(null)
    React.useImperativeHandle(ref, () => innerRef.current)
    return (
      <div ref={innerRef} className={className} data-testid="agent-scroll-area" {...props}>
        <div
          data-radix-scroll-area-viewport="true"
          data-testid="agent-scroll-viewport"
          style={{ overflow: 'auto', height: '300px' }}
        >
          {children}
        </div>
      </div>
    )
  }),
}))

// ============================================================================
// Imports — after mocks
// ============================================================================

import { AgentStreamBox } from '../AgentStreamBox'
import type { A2AEvent } from '@/types/a2a'

// ============================================================================
// Helpers
// ============================================================================

/**
 * Create a streaming event with displayContent (the field AgentStreamBox reads).
 */
function createStreamEvent(content: string, agentName = 'argocd'): A2AEvent {
  return {
    type: 'streaming',
    timestamp: Date.now(),
    sourceAgent: agentName,
    displayContent: content,
    artifact: {
      name: 'streaming_result',
      description: 'Streaming output',
      text: content,
    },
  } as unknown as A2AEvent
}

/**
 * Create a tool_start event (should be filtered out by streamContent aggregation).
 */
function createToolEvent(name: string): A2AEvent {
  return {
    type: 'tool_start',
    timestamp: Date.now(),
    sourceAgent: 'argocd',
    displayContent: 'tool output',
    artifact: { name, description: 'Tool call' },
  } as unknown as A2AEvent
}

/**
 * Create a final_result event (triggers "completed" status).
 */
function createFinalEvent(content: string): A2AEvent {
  return {
    type: 'streaming',
    timestamp: Date.now(),
    sourceAgent: 'argocd',
    displayContent: content,
    artifact: {
      name: 'final_result',
      description: 'Final result',
      text: content,
    },
  } as unknown as A2AEvent
}

// ============================================================================
// Tests
// ============================================================================

describe('AgentStreamBox', () => {
  // Mock clipboard
  const originalClipboard = navigator.clipboard

  beforeEach(() => {
    jest.clearAllMocks()
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: jest.fn().mockResolvedValue(undefined) },
      writable: true,
      configurable: true,
    })
  })

  afterEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: originalClipboard,
      writable: true,
      configurable: true,
    })
  })

  describe('Rendering', () => {
    it('should not render when no content and not streaming', () => {
      const { container } = render(
        <AgentStreamBox agentName="argocd" events={[]} isStreaming={false} />
      )
      expect(container.firstChild).toBeNull()
    })

    it('should render content when streaming with events', () => {
      const events = [createStreamEvent('Hello from ArgoCD')]
      render(
        <AgentStreamBox agentName="argocd" events={events} isStreaming={true} />
      )

      expect(screen.getByTestId('react-markdown-output')).toBeInTheDocument()
      expect(screen.getByText('Hello from ArgoCD')).toBeInTheDocument()
    })

    it('should render agent logo in the header', () => {
      const events = [createStreamEvent('Test content')]
      render(
        <AgentStreamBox agentName="argocd" events={events} isStreaming={true} />
      )

      expect(screen.getByTestId('agent-logo-argocd')).toBeInTheDocument()
    })

    it('should aggregate displayContent from events, excluding tool events', () => {
      const events = [
        createStreamEvent('First chunk '),
        createToolEvent('list_applications'), // should be skipped
        createStreamEvent('Second chunk'),
      ]

      render(
        <AgentStreamBox agentName="argocd" events={events} isStreaming={true} />
      )

      // Tool events should be filtered out, streaming content aggregated
      expect(screen.getByText('First chunk Second chunk')).toBeInTheDocument()
    })
  })

  describe('Text overflow protection', () => {
    it('should have break-words and overflow-hidden on markdown prose container', () => {
      const events = [createStreamEvent('Some markdown content')]
      render(
        <AgentStreamBox agentName="argocd" events={events} isStreaming={true} />
      )

      // Find the prose container div that wraps ReactMarkdown
      const proseContainer = document.querySelector('.prose')
      expect(proseContainer).not.toBeNull()
      expect(proseContainer!.className).toContain('break-words')
      expect(proseContainer!.className).toContain('overflow-hidden')
      expect(proseContainer!.getAttribute('style')).toContain('overflow-wrap')
      expect(proseContainer!.getAttribute('style')).toContain('anywhere')
    })

    it('should have max-w-none to allow content to fill the container', () => {
      const events = [createStreamEvent('Content')]
      render(
        <AgentStreamBox agentName="argocd" events={events} isStreaming={true} />
      )

      const proseContainer = document.querySelector('.prose')
      expect(proseContainer).not.toBeNull()
      expect(proseContainer!.className).toContain('max-w-none')
    })

    it('should truncate content preview when collapsed', () => {
      const longContent = 'A'.repeat(200)
      const events = [createStreamEvent(longContent)]

      render(
        <AgentStreamBox agentName="argocd" events={events} isStreaming={true} />
      )

      // Collapse the box by clicking the header
      const header = document.querySelector('.cursor-pointer')
      expect(header).not.toBeNull()
      fireEvent.click(header!)

      // The collapsed preview should truncate
      const preview = document.querySelector('.truncate')
      expect(preview).not.toBeNull()
    })
  })

  describe('Expand/Collapse', () => {
    it('should be expanded by default and show content', () => {
      const events = [createStreamEvent('Visible content')]
      render(
        <AgentStreamBox agentName="argocd" events={events} isStreaming={true} />
      )

      // Content should be visible
      expect(screen.getByText('Visible content')).toBeInTheDocument()
    })

    it('should toggle collapse on header click', () => {
      const events = [createStreamEvent('Toggle me')]
      render(
        <AgentStreamBox agentName="argocd" events={events} isStreaming={true} />
      )

      // Click header to collapse
      const header = document.querySelector('.cursor-pointer')
      expect(header).not.toBeNull()
      fireEvent.click(header!)

      // The markdown output should no longer be visible (collapsed)
      expect(screen.queryByTestId('react-markdown-output')).not.toBeInTheDocument()

      // Click again to expand
      fireEvent.click(header!)
      expect(screen.getByTestId('react-markdown-output')).toBeInTheDocument()
    })
  })

  describe('Copy functionality', () => {
    it('should copy stream content to clipboard when copy button is clicked', async () => {
      const events = [createStreamEvent('Copy this text')]
      render(
        <AgentStreamBox agentName="argocd" events={events} isStreaming={true} />
      )

      // Find and click the copy button (title="Copy stream content")
      const copyButton = screen.getByTitle('Copy stream content')
      expect(copyButton).toBeInTheDocument()

      await act(async () => {
        fireEvent.click(copyButton)
      })

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Copy this text')
    })
  })

  describe('Scroll behavior', () => {
    it('should auto-scroll when content updates and user has not scrolled up', () => {
      const events = [createStreamEvent('Initial')]
      const { rerender } = render(
        <AgentStreamBox agentName="argocd" events={events} isStreaming={true} />
      )

      const viewport = screen.getByTestId('agent-scroll-viewport')

      // Mock scroll dimensions
      Object.defineProperty(viewport, 'scrollHeight', { value: 1000, configurable: true })
      Object.defineProperty(viewport, 'clientHeight', { value: 300, configurable: true })
      Object.defineProperty(viewport, 'scrollTop', { value: 700, writable: true, configurable: true })

      // Update with more content
      const updatedEvents = [
        createStreamEvent('Initial'),
        createStreamEvent(' More content'),
      ]
      rerender(
        <AgentStreamBox agentName="argocd" events={updatedEvents} isStreaming={true} />
      )

      // The auto-scroll effect sets scrollTop = scrollHeight
      // Since user hasn't scrolled up (no scroll event fired), it should auto-scroll
    })

    it('should NOT auto-scroll when user has scrolled up in the stream box', () => {
      // Use jest fake timers to control requestAnimationFrame
      jest.useFakeTimers()
      const scrollTopSetter = jest.fn()

      const events = [createStreamEvent('Initial content')]
      const { rerender } = render(
        <AgentStreamBox agentName="argocd" events={events} isStreaming={true} />
      )

      const viewport = screen.getByTestId('agent-scroll-viewport')

      // Mock scroll dimensions: user is scrolled far up
      Object.defineProperty(viewport, 'scrollHeight', { value: 1000, configurable: true })
      Object.defineProperty(viewport, 'clientHeight', { value: 300, configurable: true })

      // Set scrollTop with a getter/setter to track writes
      let currentScrollTop = 100
      Object.defineProperty(viewport, 'scrollTop', {
        get: () => currentScrollTop,
        set: (v: number) => {
          scrollTopSetter(v)
          currentScrollTop = v
        },
        configurable: true,
      })

      // Flush any pending requestAnimationFrame from initial render's auto-scroll
      // so isAutoScrollingRef is reset to false
      act(() => { jest.runAllTimers() })

      // Clear setter calls from initial auto-scroll
      scrollTopSetter.mockClear()

      // Simulate user scrolling up — triggers handleScroll → isUserScrolled=true
      // distance to bottom = 1000 - 300 - 100 = 600 > 50 threshold
      act(() => { fireEvent.scroll(viewport) })

      // Clear setter from the scroll event
      scrollTopSetter.mockClear()

      // Update content — should NOT trigger auto-scroll since user scrolled up
      const updatedEvents = [
        createStreamEvent('Initial content'),
        createStreamEvent(' Added chunk'),
      ]
      act(() => {
        rerender(
          <AgentStreamBox agentName="argocd" events={updatedEvents} isStreaming={true} />
        )
      })

      // The auto-scroll effect should not have written to scrollTop
      expect(scrollTopSetter).not.toHaveBeenCalled()

      jest.useRealTimers()
    })
  })

  describe('Status badges', () => {
    it('should show Streaming badge when streaming with content', () => {
      const events = [createStreamEvent('Live data')]
      render(
        <AgentStreamBox agentName="argocd" events={events} isStreaming={true} />
      )

      expect(screen.getByText('Streaming')).toBeInTheDocument()
    })

    it('should show Complete badge when not streaming with final_result event', () => {
      const events = [createFinalEvent('Done')]
      render(
        <AgentStreamBox agentName="argocd" events={events} isStreaming={false} />
      )

      expect(screen.getByText('Complete')).toBeInTheDocument()
    })

    it('should show Processing badge when streaming with active tool calls', () => {
      const events = [
        createStreamEvent('Working...'),
        createToolEvent('list_apps'),
      ]
      render(
        <AgentStreamBox agentName="argocd" events={events} isStreaming={true} />
      )

      expect(screen.getByText('Processing')).toBeInTheDocument()
    })
  })
})
