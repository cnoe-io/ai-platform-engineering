/**
 * Unit tests for ContextPanel component — parsing logic & rendering
 *
 * Tests:
 * - parseExecutionTasks: parses TODO-style execution plan from A2A events
 * - parseExecutionTasks: marks remaining tasks completed when streaming ends
 * - parseToolCalls: parses tool_start and tool_end events into ToolCall objects
 * - parseToolCalls: matches tool_end to running tools by name
 * - isActuallyStreaming: only truthy when store isStreaming AND conversation exists
 * - Layout: Execution Plan section visible independently of Tool Calls
 * - Layout: Tool Calls section visible independently of Execution Plan
 * - Layout: Empty state shown when no tasks or tools, with dynamic text
 * - Layout: Empty state during streaming says "Waiting for tasks..."
 * - Event badge count reflects conversation-specific events
 */

import React from 'react'
import { render, screen } from '@testing-library/react'

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

// Mock zustand/react/shallow
jest.mock('zustand/react/shallow', () => ({
  useShallow: (fn: any) => fn,
}))

// Chat store state — we control this per-test
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

// Mock utils
jest.mock('@/lib/utils', () => ({
  cn: (...args: any[]) => args.filter(Boolean).join(' '),
}))

// Mock UI components
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

jest.mock('@/components/ui/tabs', () => ({
  Tabs: ({ children, value, onValueChange, ...props }: any) => (
    <div data-testid="tabs" data-value={value} {...props}>{children}</div>
  ),
  TabsList: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  TabsTrigger: ({ children, value, ...props }: any) => (
    <button data-testid={`tab-${value}`} {...props}>{children}</button>
  ),
}))

jest.mock('@/components/a2a/A2AStreamPanel', () => ({
  A2AStreamPanel: () => <div data-testid="a2a-stream-panel">A2A Stream Panel</div>,
}))

jest.mock('@/components/shared/AgentLogos', () => ({
  AgentLogo: ({ agent }: any) => <div data-testid={`agent-logo-${agent}`}>{agent}</div>,
  getAgentLogo: (name: string) => ({
    displayName: name.charAt(0).toUpperCase() + name.slice(1) + ' Agent',
    emoji: '🤖',
    color: '#6366f1',
  }),
}))

// ============================================================================
// Imports — after mocks
// ============================================================================

import { ContextPanel } from '../ContextPanel'
import type { A2AEvent } from '@/types/a2a'

// ============================================================================
// Helpers
// ============================================================================

function createA2AEvent(overrides: Partial<A2AEvent> = {}): A2AEvent {
  return {
    id: `evt-${Math.random().toString(36).slice(2, 9)}`,
    timestamp: Date.now(),
    type: 'artifact',
    displayName: 'Test Event',
    displayContent: '',
    color: 'blue',
    icon: 'wrench',
    raw: {} as any,
    ...overrides,
  } as A2AEvent
}

function createExecutionPlanEvent(text: string): A2AEvent {
  return createA2AEvent({
    type: 'artifact',
    displayContent: text,
    artifact: {
      name: 'execution_plan_update',
      description: 'Execution Plan',
      text,
    },
  })
}

function createToolStartEvent(agent: string, tool: string): A2AEvent {
  return createA2AEvent({
    type: 'tool_start',
    displayContent: `🔧 ${agent}: Calling tool: ${tool}`,
    artifact: {
      name: 'tool_notification_start',
      description: `Tool call started: ${tool}`,
    },
  })
}

function createToolEndEvent(tool: string): A2AEvent {
  return createA2AEvent({
    type: 'tool_end',
    displayContent: `✅ Tool completed: ${tool}`,
    artifact: {
      name: 'tool_notification_end',
      description: `Tool call completed: ${tool}`,
    },
  })
}

function makeConversation(id: string, events: A2AEvent[] = []) {
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

const defaultProps = {
  debugMode: false,
  onDebugModeChange: jest.fn(),
  collapsed: false,
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

  describe('parseExecutionTasks (via rendering)', () => {
    it('should parse TODO-style execution plan events into task cards', () => {
      const planText = '⏳ [ArgoCD] List all applications\n✅ [AWS] Query EC2 instances\n🔄 [CAIPE] Synthesize findings'
      const events = [createExecutionPlanEvent(planText)]
      const conv = makeConversation('conv-1', events)

      setStoreState({
        isStreaming: true,
        activeConversationId: 'conv-1',
        conversations: [conv],
      })

      render(<ContextPanel {...defaultProps} />)

      expect(screen.getByText('List all applications')).toBeInTheDocument()
      expect(screen.getByText('Query EC2 instances')).toBeInTheDocument()
      expect(screen.getByText('Synthesize findings')).toBeInTheDocument()
    })

    it('should show progress bar with correct completion count', () => {
      const planText = '✅ [ArgoCD] List all applications\n✅ [AWS] Query EC2 instances\n⏳ [CAIPE] Synthesize findings'
      const events = [createExecutionPlanEvent(planText)]
      const conv = makeConversation('conv-1', events)

      setStoreState({
        isStreaming: true,
        activeConversationId: 'conv-1',
        conversations: [conv],
      })

      render(<ContextPanel {...defaultProps} />)

      expect(screen.getByText('2/3 completed')).toBeInTheDocument()
    })

    it('should mark remaining tasks as completed when streaming ends (except failed)', () => {
      const planText = '⏳ [ArgoCD] List all applications\n❌ [AWS] Query EC2 instances'
      const events = [createExecutionPlanEvent(planText)]
      const conv = makeConversation('conv-1', events)

      setStoreState({
        isStreaming: false, // Streaming ended
        activeConversationId: 'conv-1',
        conversations: [conv],
      })

      render(<ContextPanel {...defaultProps} />)

      // Progress should show 1/2 (the pending task becomes completed, the failed stays failed)
      expect(screen.getByText('1/2 completed')).toBeInTheDocument()
    })

    it('should update task status from execution_plan_status_update events', () => {
      const initialPlan = '⏳ [ArgoCD] List all applications'
      const statusUpdate = '✅ [ArgoCD] List all applications'
      const events = [
        createExecutionPlanEvent(initialPlan),
        createA2AEvent({
          type: 'artifact',
          displayContent: statusUpdate,
          artifact: {
            name: 'execution_plan_status_update',
            description: 'Status update',
            text: statusUpdate,
          },
        }),
      ]
      const conv = makeConversation('conv-1', events)

      setStoreState({
        isStreaming: true,
        activeConversationId: 'conv-1',
        conversations: [conv],
      })

      render(<ContextPanel {...defaultProps} />)

      // Task should now be completed (updated by second event)
      expect(screen.getByText('1/1 completed')).toBeInTheDocument()
    })
  })

  describe('parseToolCalls (via rendering)', () => {
    it('should show active tool calls during streaming', () => {
      const events = [
        createToolStartEvent('ArgoCD', 'list_applications'),
      ]
      const conv = makeConversation('conv-1', events)

      setStoreState({
        isStreaming: true,
        activeConversationId: 'conv-1',
        conversations: [conv],
      })

      render(<ContextPanel {...defaultProps} />)

      expect(screen.getByText('Active Tool Calls')).toBeInTheDocument()
      expect(screen.getByText('list_applications')).toBeInTheDocument()
    })

    it('should move tool to completed when tool_end arrives', () => {
      const events = [
        createToolStartEvent('ArgoCD', 'list_applications'),
        createToolEndEvent('list_applications'),
      ]
      const conv = makeConversation('conv-1', events)

      setStoreState({
        isStreaming: true,
        activeConversationId: 'conv-1',
        conversations: [conv],
      })

      render(<ContextPanel {...defaultProps} />)

      // Tool should now be in "Completed" section
      expect(screen.getByText(/Completed/)).toBeInTheDocument()
    })

    it('should mark all tools as completed when streaming ends', () => {
      const events = [
        createToolStartEvent('ArgoCD', 'list_applications'),
        // No tool_end event — but streaming is done
      ]
      const conv = makeConversation('conv-1', events)

      setStoreState({
        isStreaming: false, // Streaming ended
        activeConversationId: 'conv-1',
        conversations: [conv],
      })

      render(<ContextPanel {...defaultProps} />)

      // After streaming ends, all tools should be completed
      expect(screen.getByText(/Completed/)).toBeInTheDocument()
      expect(screen.queryByText('Active Tool Calls')).not.toBeInTheDocument()
    })
  })

  describe('isActuallyStreaming logic', () => {
    it('should show "Live" indicator when isStreaming=true and conversation exists', () => {
      const conv = makeConversation('conv-1', [])

      setStoreState({
        isStreaming: true,
        activeConversationId: 'conv-1',
        conversations: [conv],
      })

      render(<ContextPanel {...defaultProps} />)

      expect(screen.getByText('Live')).toBeInTheDocument()
    })

    it('should NOT show "Live" indicator when isStreaming=false', () => {
      const conv = makeConversation('conv-1', [])

      setStoreState({
        isStreaming: false,
        activeConversationId: 'conv-1',
        conversations: [conv],
      })

      render(<ContextPanel {...defaultProps} />)

      expect(screen.queryByText('Live')).not.toBeInTheDocument()
    })

    it('should NOT show "Live" indicator when no conversation exists', () => {
      setStoreState({
        isStreaming: true,
        activeConversationId: 'conv-missing',
        conversations: [], // No matching conversation
      })

      render(<ContextPanel {...defaultProps} />)

      expect(screen.queryByText('Live')).not.toBeInTheDocument()
    })
  })

  describe('Independent layout sections', () => {
    it('should show Execution Plan independently without tool calls', () => {
      const planText = '⏳ [ArgoCD] List all applications'
      const events = [createExecutionPlanEvent(planText)]
      const conv = makeConversation('conv-1', events)

      setStoreState({
        isStreaming: true,
        activeConversationId: 'conv-1',
        conversations: [conv],
      })

      render(<ContextPanel {...defaultProps} />)

      expect(screen.getByText('Execution Plan')).toBeInTheDocument()
      expect(screen.getByText('List all applications')).toBeInTheDocument()
      expect(screen.queryByText('Active Tool Calls')).not.toBeInTheDocument()
    })

    it('should show Tool Calls independently without execution plan', () => {
      const events = [
        createToolStartEvent('ArgoCD', 'list_applications'),
      ]
      const conv = makeConversation('conv-1', events)

      setStoreState({
        isStreaming: true,
        activeConversationId: 'conv-1',
        conversations: [conv],
      })

      render(<ContextPanel {...defaultProps} />)

      expect(screen.getByText('Active Tool Calls')).toBeInTheDocument()
      expect(screen.queryByText('Execution Plan')).not.toBeInTheDocument()
    })

    it('should show both Execution Plan and Tool Calls when both exist', () => {
      const planText = '🔄 [ArgoCD] List all applications'
      const events = [
        createExecutionPlanEvent(planText),
        createToolStartEvent('ArgoCD', 'list_applications'),
      ]
      const conv = makeConversation('conv-1', events)

      setStoreState({
        isStreaming: true,
        activeConversationId: 'conv-1',
        conversations: [conv],
      })

      render(<ContextPanel {...defaultProps} />)

      expect(screen.getByText('Execution Plan')).toBeInTheDocument()
      expect(screen.getByText('Active Tool Calls')).toBeInTheDocument()
    })
  })

  describe('Empty state', () => {
    it('should show "Waiting for tasks..." during streaming with no tasks', () => {
      const conv = makeConversation('conv-1', [])

      setStoreState({
        isStreaming: true,
        activeConversationId: 'conv-1',
        conversations: [conv],
      })

      render(<ContextPanel {...defaultProps} />)

      expect(screen.getByText('Waiting for tasks...')).toBeInTheDocument()
      expect(screen.getByText('The agent is working — tasks will appear shortly')).toBeInTheDocument()
    })

    it('should show "No active tasks" when not streaming and no tasks', () => {
      const conv = makeConversation('conv-1', [])

      setStoreState({
        isStreaming: false,
        activeConversationId: 'conv-1',
        conversations: [conv],
      })

      render(<ContextPanel {...defaultProps} />)

      expect(screen.getByText('No active tasks')).toBeInTheDocument()
      expect(screen.getByText('Task plans will appear here during execution')).toBeInTheDocument()
    })
  })

  describe('Event badge count', () => {
    it('should show event count badge on Debug tab for conversation-specific events', () => {
      const events = [
        createA2AEvent({ id: 'evt-1' }),
        createA2AEvent({ id: 'evt-2' }),
        createA2AEvent({ id: 'evt-3' }),
      ]
      const conv = makeConversation('conv-1', events)

      setStoreState({
        isStreaming: false,
        activeConversationId: 'conv-1',
        conversations: [conv],
      })

      render(<ContextPanel {...defaultProps} />)

      // Find the badge with count "3"
      expect(screen.getByText('3')).toBeInTheDocument()
    })
  })

  describe('Collapsed state', () => {
    it('should not render content when collapsed', () => {
      const planText = '⏳ [ArgoCD] List all applications'
      const events = [createExecutionPlanEvent(planText)]
      const conv = makeConversation('conv-1', events)

      setStoreState({
        isStreaming: true,
        activeConversationId: 'conv-1',
        conversations: [conv],
      })

      render(<ContextPanel {...defaultProps} collapsed={true} />)

      // Content should be hidden when collapsed
      expect(screen.queryByText('Execution Plan')).not.toBeInTheDocument()
      expect(screen.queryByText('List all applications')).not.toBeInTheDocument()
    })
  })
})
