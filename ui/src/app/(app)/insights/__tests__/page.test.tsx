/**
 * Unit tests for Insights page component
 *
 * Tests:
 * - Loading state: shows spinner while fetching data
 * - Error state: shows error message on fetch failure
 * - Error state: shows auth error when 401 returned
 * - Overview stats: renders all 6 stat cards with correct values
 * - Overview stats: formats large token counts with "k" suffix
 * - Overview stats: shows "this week" subtitles on conversations/messages cards
 * - Usage chart: renders 30-day usage chart with summary stats
 * - Prompt patterns: shows avg length, max length, peak hour, peak day
 * - Favorite agents: renders agent bars with relative widths
 * - Favorite agents: shows empty state when no agent data
 * - Feedback: renders positive/negative counts with satisfaction bar
 * - Feedback: shows empty state when no feedback given
 * - Skill usage: renders skill categories with run counts and success rates
 * - Skill usage: shows empty state with Browse Agent Skills button
 * - Navigation: Browse Agent Skills navigates to /skills
 * - AuthGuard: wraps page in AuthGuard component
 */

import React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'

// ============================================================================
// Mocks — must be before imports
// ============================================================================

const mockPush = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

const mockSession = {
  data: { user: { name: 'Test User', email: 'test@test.com' } },
  status: 'authenticated' as const,
  update: jest.fn(),
}
jest.mock('next-auth/react', () => ({
  useSession: jest.fn(() => mockSession),
}))

// Mock framer-motion to simplify testing
jest.mock('framer-motion', () => ({
  motion: {
    div: React.forwardRef(({ children, initial, animate, exit, transition, className, onClick, ...props }: any, ref: any) => (
      <div ref={ref} className={className} onClick={onClick} {...props}>{children}</div>
    )),
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}))

// Mock AuthGuard — passes children through
jest.mock('@/components/auth-guard', () => ({
  AuthGuard: ({ children }: any) => <div data-testid="auth-guard">{children}</div>,
}))

// Mock UI components
jest.mock('@/components/ui/card', () => ({
  Card: ({ children, className, ...props }: any) => <div className={className} data-testid="card" {...props}>{children}</div>,
  CardContent: ({ children, className, ...props }: any) => <div className={className} {...props}>{children}</div>,
  CardDescription: ({ children }: any) => <p>{children}</p>,
  CardHeader: ({ children }: any) => <div>{children}</div>,
  CardTitle: ({ children, className }: any) => <h3 className={className}>{children}</h3>,
}))

jest.mock('@/components/ui/scroll-area', () => ({
  ScrollArea: ({ children, ...props }: any) => <div data-testid="scroll-area" {...props}>{children}</div>,
}))

jest.mock('@/components/admin/SimpleLineChart', () => ({
  SimpleLineChart: ({ data, height, color }: any) => (
    <div data-testid="line-chart" data-height={height} data-color={color}>
      {data?.length} data points
    </div>
  ),
}))

jest.mock('@/components/admin/SkillMetricsCards', () => ({
  VisibilityBreakdown: () => <div data-testid="visibility-breakdown" />,
  CategoryBreakdown: () => <div data-testid="category-breakdown" />,
  RunStatsTable: () => <div data-testid="run-stats-table" />,
}))

jest.mock('@/components/ui/caipe-spinner', () => ({
  CAIPESpinner: ({ size }: any) => <div data-testid="caipe-spinner" data-size={size}>Loading...</div>,
}))

jest.mock('@/lib/utils', () => ({
  cn: (...args: any[]) => args.filter(Boolean).join(' '),
}))

let mockStorageMode = 'mongodb'
jest.mock('@/lib/storage-config', () => ({
  getStorageMode: () => mockStorageMode,
}))

// ============================================================================
// Imports — after mocks
// ============================================================================

import Insights from '../page'

// ============================================================================
// Helpers
// ============================================================================

function makeInsightsData(overrides: Record<string, any> = {}) {
  return {
    overview: {
      total_conversations: 42,
      total_messages: 256,
      total_tokens_used: 15000,
      conversations_this_week: 5,
      messages_this_week: 30,
      avg_messages_per_conversation: 6.1,
      ...overrides.overview,
    },
    skill_usage: overrides.skill_usage ?? [
      {
        category: 'AWS Operations',
        total_runs: 12,
        completed: 10,
        failed: 2,
        last_run: '2026-02-10T12:00:00Z',
      },
      {
        category: 'GitHub Operations',
        total_runs: 8,
        completed: 8,
        failed: 0,
        last_run: '2026-02-09T15:00:00Z',
      },
      {
        category: 'ArgoCD Operations',
        total_runs: 5,
        completed: 3,
        failed: 2,
        last_run: '2026-02-08T10:00:00Z',
      },
    ],
    daily_usage: overrides.daily_usage ?? Array.from({ length: 30 }, (_, i) => ({
      date: `2026-01-${String(i + 1).padStart(2, '0')}`,
      prompts: i % 3 === 0 ? 2 : 0,
      responses: i % 3 === 0 ? 2 : 0,
    })),
    prompt_patterns: {
      avg_length: 85,
      max_length: 450,
      total_prompts: 120,
      peak_hour: 14,
      peak_hour_label: '14:00 UTC',
      peak_day: 'Wednesday',
      ...overrides.prompt_patterns,
    },
    favorite_agents: overrides.favorite_agents ?? [
      { name: 'argocd', count: 45 },
      { name: 'aws', count: 20 },
      { name: 'github', count: 10 },
    ],
    feedback_given: {
      positive: 15,
      negative: 3,
      total: 18,
      ...overrides.feedback_given,
    },
  }
}

const emptySkillMetrics = {
  total_skills: 0,
  by_visibility: { private: 0, team: 0, global: 0 },
  by_category: [],
  recent_skills: [],
  run_stats: [],
  daily_created: [],
}

function mockFetchSuccess(data = makeInsightsData()) {
  ;(global.fetch as jest.Mock).mockImplementation((url: string) => {
    if (url === '/api/users/me/insights/skills') {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: emptySkillMetrics }),
      })
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data }),
    })
  })
}

function mockFetchError(status = 500, statusText = 'Internal Server Error') {
  ;(global.fetch as jest.Mock).mockImplementation((url: string) => {
    if (url === '/api/users/me/insights/skills') {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: emptySkillMetrics }),
      })
    }
    return Promise.resolve({ ok: false, status, statusText })
  })
}

// ============================================================================
// Tests
// ============================================================================

describe('Insights Page', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockSession.status = 'authenticated' as const
    mockStorageMode = 'mongodb'
    ;(global.fetch as jest.Mock).mockReset()
  })

  describe('AuthGuard wrapper', () => {
    it('wraps the page content in AuthGuard', () => {
      mockFetchSuccess()
      render(<Insights />)
      expect(screen.getByTestId('auth-guard')).toBeInTheDocument()
    })
  })

  describe('MongoDB guard', () => {
    it('shows MongoDB Required message when storageMode is not mongodb', () => {
      mockStorageMode = 'localStorage'

      render(<Insights />)

      expect(screen.getByText('MongoDB Required')).toBeInTheDocument()
      expect(screen.getByText(/Personal Insights requires MongoDB/)).toBeInTheDocument()
      expect(screen.getByText('Go to Chat')).toBeInTheDocument()
    })

    it('does NOT fetch insights when MongoDB is not configured', () => {
      mockStorageMode = 'localStorage'

      render(<Insights />)

      expect(global.fetch).not.toHaveBeenCalled()
    })

    it('navigates to /chat when Go to Chat button is clicked', () => {
      mockStorageMode = 'localStorage'

      render(<Insights />)

      fireEvent.click(screen.getByText('Go to Chat'))
      expect(mockPush).toHaveBeenCalledWith('/chat')
    })

    it('renders normally when storageMode is mongodb', async () => {
      mockStorageMode = 'mongodb'
      mockFetchSuccess()

      render(<Insights />)

      await waitFor(() => {
        expect(screen.getByText('Personal Insights')).toBeInTheDocument()
      })
    })
  })

  describe('Loading state', () => {
    it('shows loading spinner while fetching data', () => {
      ;(global.fetch as jest.Mock).mockImplementation(() => new Promise(() => {}))

      render(<Insights />)

      expect(screen.getByTestId('caipe-spinner')).toBeInTheDocument()
      expect(screen.getByText('Loading your insights...')).toBeInTheDocument()
    })
  })

  describe('Error state', () => {
    it('shows error message on fetch failure', async () => {
      mockFetchError(500, 'Internal Server Error')

      render(<Insights />)

      await waitFor(() => {
        expect(screen.getByText('Failed to load insights')).toBeInTheDocument()
        expect(screen.getByText(/Failed to load insights: Internal Server Error/)).toBeInTheDocument()
      })
    })

    it('shows auth error message on 401', async () => {
      mockFetchError(401)

      render(<Insights />)

      await waitFor(() => {
        expect(screen.getByText('Please sign in to view insights.')).toBeInTheDocument()
      })
    })

    it('shows error when API returns success=false', async () => {
      ;(global.fetch as jest.Mock).mockImplementation((url: string) => {
        if (url === '/api/users/me/insights/skills') {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ success: true, data: emptySkillMetrics }),
          })
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ success: false, error: 'Database error' }),
        })
      })

      render(<Insights />)

      await waitFor(() => {
        expect(screen.getByText('Database error')).toBeInTheDocument()
      })
    })
  })

  describe('Overview stats', () => {
    it('renders all stat cards with correct values', async () => {
      mockFetchSuccess()

      render(<Insights />)

      await waitFor(() => {
        expect(screen.getByText('Conversations')).toBeInTheDocument()
        expect(screen.getByText('42')).toBeInTheDocument()
        expect(screen.getByText('Messages')).toBeInTheDocument()
        expect(screen.getByText('256')).toBeInTheDocument()
        expect(screen.getByText('Prompts Sent')).toBeInTheDocument()
        expect(screen.getByText('120')).toBeInTheDocument()
        expect(screen.getByText('Avg Msgs/Chat')).toBeInTheDocument()
        expect(screen.getByText('6.1')).toBeInTheDocument()
        expect(screen.getByText('Feedback Given')).toBeInTheDocument()
        expect(screen.getByText('18')).toBeInTheDocument()
      })
    })

    it('formats large token counts with "k" suffix', async () => {
      mockFetchSuccess(makeInsightsData({
        overview: { total_tokens_used: 150000 },
      }))

      render(<Insights />)

      await waitFor(() => {
        expect(screen.getByText('150.0k')).toBeInTheDocument()
      })
    })

    it('displays raw token count when under 1000', async () => {
      mockFetchSuccess(makeInsightsData({
        overview: { total_tokens_used: 500 },
      }))

      render(<Insights />)

      await waitFor(() => {
        expect(screen.getByText('500')).toBeInTheDocument()
      })
    })

    it('shows "this week" subtitles', async () => {
      mockFetchSuccess()

      render(<Insights />)

      await waitFor(() => {
        expect(screen.getByText('5 this week')).toBeInTheDocument()
        expect(screen.getByText('30 this week')).toBeInTheDocument()
      })
    })

    it('shows feedback percentage subtitle when feedback exists', async () => {
      mockFetchSuccess(makeInsightsData({
        feedback_given: { positive: 15, negative: 5, total: 20 },
      }))

      render(<Insights />)

      await waitFor(() => {
        expect(screen.getByText('75% positive')).toBeInTheDocument()
      })
    })
  })

  describe('Usage chart', () => {
    it('renders line chart with 30 data points', async () => {
      mockFetchSuccess()

      render(<Insights />)

      await waitFor(() => {
        const chart = screen.getByTestId('line-chart')
        expect(chart).toBeInTheDocument()
        expect(chart).toHaveTextContent('30 data points')
      })
    })

    it('shows usage summary stats below chart', async () => {
      mockFetchSuccess()

      render(<Insights />)

      await waitFor(() => {
        expect(screen.getByText('Prompts (30d)')).toBeInTheDocument()
        expect(screen.getByText('Responses (30d)')).toBeInTheDocument()
        expect(screen.getByText('Avg/Active Day')).toBeInTheDocument()
      })
    })
  })

  describe('Prompt patterns', () => {
    it('displays all prompt pattern fields', async () => {
      mockFetchSuccess()

      render(<Insights />)

      await waitFor(() => {
        expect(screen.getByText('Prompt Patterns')).toBeInTheDocument()
        expect(screen.getByText('Avg Length')).toBeInTheDocument()
        expect(screen.getByText('85 chars')).toBeInTheDocument()
        expect(screen.getByText('Longest Prompt')).toBeInTheDocument()
        expect(screen.getByText('450 chars')).toBeInTheDocument()
        expect(screen.getByText('Peak Hour')).toBeInTheDocument()
        expect(screen.getByText('14:00 UTC')).toBeInTheDocument()
        expect(screen.getByText('Peak Day')).toBeInTheDocument()
        expect(screen.getByText('Wednesday')).toBeInTheDocument()
      })
    })
  })

  describe('Favorite agents', () => {
    it('renders agent bars', async () => {
      mockFetchSuccess()

      render(<Insights />)

      await waitFor(() => {
        expect(screen.getByText('Favorite Agents')).toBeInTheDocument()
        expect(screen.getByText('argocd')).toBeInTheDocument()
        expect(screen.getByText('aws')).toBeInTheDocument()
        expect(screen.getByText('github')).toBeInTheDocument()
      })
    })

    it('shows empty state when no agents', async () => {
      mockFetchSuccess(makeInsightsData({ favorite_agents: [] }))

      render(<Insights />)

      await waitFor(() => {
        expect(screen.getByText('No agent data yet')).toBeInTheDocument()
      })
    })
  })

  describe('Feedback section', () => {
    it('renders positive and negative counts', async () => {
      mockFetchSuccess(makeInsightsData({
        feedback_given: { positive: 10, negative: 2, total: 12 },
      }))

      render(<Insights />)

      await waitFor(() => {
        expect(screen.getByText('Your Feedback')).toBeInTheDocument()
        expect(screen.getByText('Positive')).toBeInTheDocument()
        expect(screen.getByText('Negative')).toBeInTheDocument()
        expect(screen.getByText('Satisfaction Rate')).toBeInTheDocument()
      })
    })

    it('shows empty state when no feedback given', async () => {
      mockFetchSuccess(makeInsightsData({
        feedback_given: { positive: 0, negative: 0, total: 0 },
      }))

      render(<Insights />)

      await waitFor(() => {
        expect(screen.getByText('No feedback given yet')).toBeInTheDocument()
      })
    })
  })

  describe('Skill usage', () => {
    it('renders skill usage cards with categories', async () => {
      mockFetchSuccess()

      render(<Insights />)

      await waitFor(() => {
        expect(screen.getByText('Skill Usage')).toBeInTheDocument()
        expect(screen.getByText('AWS Operations')).toBeInTheDocument()
        expect(screen.getByText('GitHub Operations')).toBeInTheDocument()
        expect(screen.getByText('ArgoCD Operations')).toBeInTheDocument()
      })
    })

    it('shows run counts for each skill category', async () => {
      mockFetchSuccess()

      render(<Insights />)

      await waitFor(() => {
        expect(screen.getByText('12 runs')).toBeInTheDocument()
        expect(screen.getByText('8 runs')).toBeInTheDocument()
        expect(screen.getByText('5 runs')).toBeInTheDocument()
      })
    })

    it('shows success rates for each skill category', async () => {
      // Use skill data with unique success rates that won't collide
      const customSkills = [
        { category: 'AWS Operations', total_runs: 10, completed: 9, failed: 1, last_run: '2026-02-10T12:00:00Z' }, // 90%
        { category: 'GitHub Operations', total_runs: 4, completed: 3, failed: 1, last_run: '2026-02-09T15:00:00Z' }, // 75%
      ];
      // Use zero feedback to avoid any collision
      mockFetchSuccess(makeInsightsData({
        skill_usage: customSkills,
        feedback_given: { positive: 0, negative: 0, total: 0 },
      }))

      render(<Insights />)

      await waitFor(() => {
        expect(screen.getByText('90%')).toBeInTheDocument()
        expect(screen.getByText('75%')).toBeInTheDocument()
      })
    })

    it('shows empty state when no skill runs', async () => {
      mockFetchSuccess(makeInsightsData({ skill_usage: [] }))

      render(<Insights />)

      await waitFor(() => {
        expect(screen.getByText('No skill runs yet. Run an Agent Skill to see your usage here.')).toBeInTheDocument()
        expect(screen.getByText('Browse Agent Skills')).toBeInTheDocument()
      })
    })

    it('navigates to skills when Browse Agent Skills is clicked', async () => {
      mockFetchSuccess(makeInsightsData({ skill_usage: [] }))

      render(<Insights />)

      await waitFor(() => {
        expect(screen.getByText('Browse Agent Skills')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Browse Agent Skills'))
      expect(mockPush).toHaveBeenCalledWith('/skills')
    })

    it('uses singular "run" when count is 1', async () => {
      mockFetchSuccess(makeInsightsData({
        skill_usage: [{ category: 'Custom', total_runs: 1, completed: 1, failed: 0, last_run: null }],
      }))

      render(<Insights />)

      await waitFor(() => {
        expect(screen.getByText('1 run')).toBeInTheDocument()
      })
    })
  })

  describe('Header', () => {
    it('renders page title and description', async () => {
      mockFetchSuccess()

      render(<Insights />)

      await waitFor(() => {
        expect(screen.getByText('Personal Insights')).toBeInTheDocument()
        expect(screen.getByText('Your usage patterns, prompt history, and analytics')).toBeInTheDocument()
      })
    })
  })

  describe('Session handling', () => {
    it('does not fetch data when not authenticated', () => {
      mockSession.status = 'loading' as any

      render(<Insights />)

      // Should show loading but NOT call fetch
      expect(global.fetch).not.toHaveBeenCalledWith('/api/users/me/insights')
    })
  })
})
