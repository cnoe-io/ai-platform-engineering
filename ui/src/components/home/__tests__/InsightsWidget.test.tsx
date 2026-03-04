/**
 * Unit tests for InsightsWidget component
 *
 * Tests:
 * - Loading state: shows skeleton loader
 * - Empty state: shows "Start chatting" message when stats is null
 * - Renders total conversations count
 * - Renders conversations this week
 * - Renders messages this week
 * - Renders top agents with usage counts
 * - Limits agents to top 3
 * - Shows singular "use" when agent count is 1
 * - "View all" link navigates to /insights
 * - Hides agents section when no favorite agents
 * - Renders data-testids for all key elements
 */

import React from 'react'
import { render, screen } from '@testing-library/react'

// ============================================================================
// Mocks
// ============================================================================

jest.mock('next/link', () => {
  return React.forwardRef(({ children, href, className, ...props }: any, ref: any) => (
    <a ref={ref} href={href} className={className} data-testid={props['data-testid'] || `link-${href}`} {...props}>
      {children}
    </a>
  ))
})

jest.mock('lucide-react', () => ({
  MessageSquare: (props: any) => <svg data-testid="icon-message-square" {...props} />,
  TrendingUp: (props: any) => <svg data-testid="icon-trending-up" {...props} />,
  Bot: (props: any) => <svg data-testid="icon-bot" {...props} />,
  ArrowRight: (props: any) => <svg data-testid="icon-arrow-right" {...props} />,
}))

jest.mock('@/lib/utils', () => ({
  cn: (...args: any[]) => args.filter(Boolean).join(' '),
}))

// ============================================================================
// Imports — after mocks
// ============================================================================

import { InsightsWidget } from '../InsightsWidget'

// ============================================================================
// Helpers
// ============================================================================

function makeStats(overrides: Record<string, any> = {}) {
  return {
    total_conversations: 42,
    conversations_this_week: 7,
    messages_this_week: 35,
    favorite_agents: [
      { name: 'github', count: 20 },
      { name: 'argocd', count: 15 },
      { name: 'aws', count: 10 },
    ],
    ...overrides,
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('InsightsWidget', () => {
  describe('loading state', () => {
    it('shows loading skeleton', () => {
      render(<InsightsWidget stats={null} loading={true} />)
      expect(screen.getByTestId('insights-widget-loading')).toBeInTheDocument()
    })

    it('does not render stats when loading', () => {
      render(<InsightsWidget stats={makeStats()} loading={true} />)
      expect(screen.queryByTestId('total-conversations')).not.toBeInTheDocument()
    })
  })

  describe('empty state', () => {
    it('shows "Start chatting" message when stats is null', () => {
      render(<InsightsWidget stats={null} loading={false} />)
      expect(screen.getByTestId('insights-widget-empty')).toBeInTheDocument()
      expect(screen.getByText('Start chatting to build your insights.')).toBeInTheDocument()
    })
  })

  describe('with stats', () => {
    it('renders the widget container', () => {
      render(<InsightsWidget stats={makeStats()} loading={false} />)
      expect(screen.getByTestId('insights-widget')).toBeInTheDocument()
    })

    it('renders total conversations', () => {
      render(<InsightsWidget stats={makeStats()} loading={false} />)
      expect(screen.getByTestId('total-conversations')).toHaveTextContent('42')
    })

    it('renders conversations this week', () => {
      render(<InsightsWidget stats={makeStats()} loading={false} />)
      expect(screen.getByTestId('conversations-this-week')).toHaveTextContent('7 this week')
    })

    it('renders messages this week', () => {
      render(<InsightsWidget stats={makeStats()} loading={false} />)
      expect(screen.getByTestId('messages-this-week-value')).toHaveTextContent('35')
    })

    it('renders the section title', () => {
      render(<InsightsWidget stats={makeStats()} loading={false} />)
      expect(screen.getByText('Your Insights')).toBeInTheDocument()
    })

    it('renders "View all" link to /insights', () => {
      render(<InsightsWidget stats={makeStats()} loading={false} />)
      const link = screen.getByTestId('view-all-insights')
      expect(link).toBeInTheDocument()
      expect(link).toHaveAttribute('href', '/insights')
    })
  })

  describe('favorite agents', () => {
    it('renders top agents with names and counts', () => {
      render(<InsightsWidget stats={makeStats()} loading={false} />)
      expect(screen.getByTestId('agent-github')).toBeInTheDocument()
      expect(screen.getByTestId('agent-argocd')).toBeInTheDocument()
      expect(screen.getByTestId('agent-aws')).toBeInTheDocument()
      expect(screen.getByText('20 uses')).toBeInTheDocument()
      expect(screen.getByText('15 uses')).toBeInTheDocument()
      expect(screen.getByText('10 uses')).toBeInTheDocument()
    })

    it('limits to top 3 agents', () => {
      const stats = makeStats({
        favorite_agents: [
          { name: 'github', count: 20 },
          { name: 'argocd', count: 15 },
          { name: 'aws', count: 10 },
          { name: 'slack', count: 5 },
        ],
      })
      render(<InsightsWidget stats={stats} loading={false} />)
      expect(screen.getByTestId('agent-github')).toBeInTheDocument()
      expect(screen.getByTestId('agent-argocd')).toBeInTheDocument()
      expect(screen.getByTestId('agent-aws')).toBeInTheDocument()
      expect(screen.queryByTestId('agent-slack')).not.toBeInTheDocument()
    })

    it('shows singular "use" when count is 1', () => {
      const stats = makeStats({
        favorite_agents: [{ name: 'github', count: 1 }],
      })
      render(<InsightsWidget stats={stats} loading={false} />)
      expect(screen.getByText('1 use')).toBeInTheDocument()
    })

    it('hides agents section when no favorite agents', () => {
      const stats = makeStats({ favorite_agents: [] })
      render(<InsightsWidget stats={stats} loading={false} />)
      expect(screen.queryByText('Top Agents')).not.toBeInTheDocument()
    })
  })
})
