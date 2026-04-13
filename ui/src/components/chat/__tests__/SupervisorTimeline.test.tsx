/**
 * Tests for SupervisorTimeline — the structured execution timeline rendered
 * inside assistant messages during A2A streaming.
 *
 * SupervisorTimeline receives pre-built SupervisorTimelineSegment[] from SupervisorChatPanel
 * (built by SupervisorTimelineManager). These tests verify the rendering logic:
 * plan steps with status indicators, tool call grouping, final answer
 * display, and the machinery collapse/expand behavior.
 */

import React from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { SupervisorTimelineSegment, PlanStep, ToolCallInfo } from '@/types/a2a'

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

jest.mock('@/lib/utils', () => ({
  cn: (...args: any[]) => args.filter(Boolean).join(' '),
}))

jest.mock('@/components/shared/AgentLogos', () => ({
  getAgentLogo: (name: string) => ({
    displayName: name.charAt(0).toUpperCase() + name.slice(1) + ' Agent',
    emoji: '',
    color: '#6366f1',
  }),
  AgentLogo: ({ agent, size, showFallback }: any) =>
    showFallback === false ? null : <span data-testid={`agent-logo-${agent}`} />,
}))

// Mock react-markdown to render text directly (avoids ESM issues in Jest)
jest.mock('react-markdown', () => ({
  __esModule: true,
  default: ({ children }: { children: string }) => <span>{children}</span>,
}))

jest.mock('remark-gfm', () => ({
  __esModule: true,
  default: () => {},
}))

jest.mock('@/components/chat/MarkdownComponents', () => ({
  assistantMarkdownComponents: {},
  assistantProseClassName: 'prose',
}))

// Mock MarkdownRenderer to avoid shiki ESM resolution issues in Jest
jest.mock('@/components/shared/timeline/MarkdownRenderer', () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <span>{content}</span>,
}))

// ============================================================================
// Imports
// ============================================================================

import { SupervisorTimeline } from '../SupervisorTimeline'

// ============================================================================
// Helpers
// ============================================================================

function makePlanSegment(steps: PlanStep[]): SupervisorTimelineSegment {
  return {
    id: 'plan-1',
    type: 'execution_plan',
    timestamp: new Date(),
    planSteps: steps,
  }
}

function makeToolSegment(
  id: string,
  agent: string,
  tool: string,
  status: ToolCallInfo['status'] = 'running',
  planStepId?: string,
): SupervisorTimelineSegment {
  return {
    id,
    type: 'tool_call',
    timestamp: new Date(),
    toolCall: { id, agent, tool, status, planStepId },
  }
}

function makeFinalAnswer(content: string, isStreaming = false): SupervisorTimelineSegment {
  return {
    id: 'answer-1',
    type: 'final_answer',
    timestamp: new Date(),
    content,
    isStreaming,
  }
}

function makeThinking(content: string, id = 'thinking-1', planStepId?: string): SupervisorTimelineSegment {
  return {
    id,
    type: 'thinking',
    timestamp: new Date(),
    content,
    isStreaming: false,
    planStepId,
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('SupervisorTimeline', () => {
  describe('plan rendering with nested tools', () => {
    it('renders plan steps with correct status and nests tools under their plan step', () => {
      const steps: PlanStep[] = [
        { id: 's1', agent: 'ArgoCD', description: 'List all applications', status: 'completed' },
        { id: 's2', agent: 'AWS', description: 'Query EC2 instances', status: 'in_progress' },
        { id: 's3', agent: 'Supervisor', description: 'Synthesize findings', status: 'pending' },
      ]

      const segments: SupervisorTimelineSegment[] = [
        makePlanSegment(steps),
        // Tool nested under step s1
        makeToolSegment('tool-1', 'ArgoCD', 'list_apps', 'completed', 's1'),
        // Tool nested under step s2
        makeToolSegment('tool-2', 'AWS', 'describe_instances', 'running', 's2'),
      ]

      render(<SupervisorTimeline segments={segments} isStreaming={true} />)

      // All plan step descriptions are rendered
      expect(screen.getByText('List all applications')).toBeInTheDocument()
      expect(screen.getByText('Query EC2 instances')).toBeInTheDocument()
      expect(screen.getByText('Synthesize findings')).toBeInTheDocument()

      // Plan header shows completion count (1 completed out of 3)
      expect(screen.getByText('1/3')).toBeInTheDocument()

      // Tool names are rendered nested under their steps
      expect(screen.getByText('list_apps')).toBeInTheDocument()
      expect(screen.getByText('describe_instances')).toBeInTheDocument()
    })
  })

  describe('standalone tool grouping', () => {
    it('groups adjacent standalone tools into a single dropdown with a count', () => {
      // Tools without planStepId are standalone — adjacent ones get grouped
      const segments: SupervisorTimelineSegment[] = [
        makeToolSegment('tool-1', 'ArgoCD', 'list_apps', 'completed'),
        makeToolSegment('tool-2', 'AWS', 'describe_ec2', 'completed'),
        makeToolSegment('tool-3', 'Slack', 'send_message', 'running'),
      ]

      render(<SupervisorTimeline segments={segments} isStreaming={true} />)

      // The group header shows "3 tools"
      expect(screen.getByText('3 tools')).toBeInTheDocument()

      // All tool names are visible (group is expanded by default during streaming)
      expect(screen.getByText('list_apps')).toBeInTheDocument()
      expect(screen.getByText('describe_ec2')).toBeInTheDocument()
      expect(screen.getByText('send_message')).toBeInTheDocument()

      // Completion counter shows 2/3
      expect(screen.getByText('2/3')).toBeInTheDocument()
    })
  })

  describe('final answer rendering', () => {
    it('renders final answer content when streaming and when done', () => {
      const segments = [makeFinalAnswer('Here is the analysis...', true)]

      const { rerender } = render(
        <SupervisorTimeline segments={segments} isStreaming={true} />
      )

      // Content is rendered during streaming
      expect(screen.getByText('Here is the analysis...')).toBeInTheDocument()

      // After streaming ends, content is still rendered
      const doneSegments = [makeFinalAnswer('Here is the analysis...', false)]
      rerender(<SupervisorTimeline segments={doneSegments} isStreaming={false} />)

      expect(screen.getByText('Here is the analysis...')).toBeInTheDocument()
    })
  })

  describe('machinery collapse after streaming', () => {
    it('shows summary bar with stats after streaming ends, hiding machinery by default', async () => {
      const user = userEvent.setup()

      const steps: PlanStep[] = [
        { id: 's1', agent: 'ArgoCD', description: 'Deploy app', status: 'completed' },
      ]
      const segments: SupervisorTimelineSegment[] = [
        makePlanSegment(steps),
        makeToolSegment('tool-1', 'ArgoCD', 'deploy', 'completed'),
        makeFinalAnswer('Deployment complete.'),
      ]

      // Start streaming — machinery is visible
      const { rerender } = render(
        <SupervisorTimeline segments={segments} isStreaming={true} />
      )
      expect(screen.getByText('Deploy app')).toBeInTheDocument()
      expect(screen.getByText('deploy')).toBeInTheDocument()

      // Stop streaming — machinery auto-collapses, summary bar appears
      rerender(<SupervisorTimeline segments={segments} isStreaming={false} durationSec={5} />)

      // Summary bar shows stats
      expect(screen.getByText(/1 step/)).toBeInTheDocument()
      expect(screen.getByText(/1 tool/)).toBeInTheDocument()
      expect(screen.getByText(/5s/)).toBeInTheDocument()

      // Machinery is collapsed — plan step text is hidden
      expect(screen.queryByText('Deploy app')).not.toBeInTheDocument()

      // Click summary to re-expand
      await user.click(screen.getByText(/1 step/))
      expect(screen.getByText('Deploy app')).toBeInTheDocument()

      // Final answer is always visible regardless of collapse
      expect(screen.getByText('Deployment complete.')).toBeInTheDocument()
    })
  })
})
