/**
 * Tests for Admin Dashboard page
 *
 * Covers:
 * - Loading state
 * - Error state with retry
 * - Read-only badge and descriptions for non-admin users
 * - Admin actions visibility (role change, team CRUD) for admin users
 * - Admin actions hidden for read-only users
 * - Data rendering (stats cards, user list, team list)
 */

import React from 'react';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';

// ============================================================================
// Mocks
// ============================================================================

let mockIsAdmin = false;
jest.mock('@/hooks/use-admin-role', () => ({
  useAdminRole: () => ({ isAdmin: mockIsAdmin, loading: false }),
}));

const mockSessionStatus = { status: 'authenticated' as const };
jest.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { email: 'test@example.com' } }, ...mockSessionStatus }),
}));

jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), refresh: jest.fn() }),
  usePathname: () => '/admin',
}));

jest.mock('@/components/auth-guard', () => ({
  AuthGuard: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock('@/components/ui/caipe-spinner', () => ({
  CAIPESpinner: ({ message }: { message: string }) => <div data-testid="spinner">{message}</div>,
}));

jest.mock('@/components/ui/scroll-area', () => ({
  ScrollArea: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

jest.mock('@/components/admin/SimpleLineChart', () => ({
  SimpleLineChart: () => <div data-testid="line-chart" />,
}));

jest.mock('@/components/admin/MetricsTab', () => ({
  MetricsTab: () => <div data-testid="metrics-tab">MetricsTab</div>,
}));

jest.mock('@/components/admin/HealthTab', () => ({
  HealthTab: () => <div data-testid="health-tab">HealthTab</div>,
}));

jest.mock('@/components/admin/SkillMetricsCards', () => ({
  VisibilityBreakdown: () => <div />,
  CategoryBreakdown: () => <div />,
  RunStatsTable: () => <div />,
  TopCreatorsCard: () => <div />,
}));

jest.mock('@/components/admin/CheckpointStatsSection', () => ({
  CheckpointStatsSection: () => <div data-testid="checkpoint-stats">CheckpointStatsSection</div>,
}));

jest.mock('@/components/admin/CreateTeamDialog', () => ({
  CreateTeamDialog: () => null,
}));

jest.mock('@/components/admin/TeamDetailsDialog', () => ({
  TeamDetailsDialog: () => null,
}));

jest.mock('@/lib/api-client', () => ({
  apiClient: { get: jest.fn(), post: jest.fn() },
}));

jest.mock('framer-motion', () => ({
  motion: { div: ({ children, ...props }: any) => <div {...props}>{children}</div> },
}));

const mockStatsResponse = {
  success: true,
  data: {
    overview: {
      total_users: 42,
      total_conversations: 150,
      total_messages: 1200,
      shared_conversations: 10,
      dau: 15,
      mau: 35,
      conversations_today: 8,
      messages_today: 65,
      avg_messages_per_conversation: 8,
    },
    daily_activity: [],
    top_users: { by_conversations: [], by_messages: [] },
    top_agents: [],
    feedback_summary: { positive: 0, negative: 0, total: 0 },
    response_time: { avg_ms: 0, min_ms: 0, max_ms: 0, sample_count: 0 },
    hourly_heatmap: [],
    completed_workflows: {
      total: 0,
      today: 0,
      interrupted: 0,
      completion_rate: 0,
      avg_messages_per_workflow: 0,
    },
  },
};

/** Shape from GET /api/admin/users (Keycloak list — UserManagementTab) */
const mockUsersListResponse = {
  users: [
    {
      id: 'kc-admin',
      username: 'admin',
      email: 'admin@example.com',
      firstName: 'Admin',
      lastName: 'User',
      enabled: true,
      attributes: {} as Record<string, string[]>,
      roles: ['admin'],
    },
    {
      id: 'kc-user',
      username: 'user',
      email: 'user@example.com',
      firstName: 'Regular',
      lastName: 'User',
      enabled: true,
      attributes: {} as Record<string, string[]>,
      roles: ['user'],
    },
  ],
  total: 2,
  page: 1,
  pageSize: 20,
};

const mockTeamsResponse = {
  success: true,
  data: {
    teams: [
      {
        _id: 'team-1',
        name: 'Platform Team',
        description: 'The platform engineering team',
        owner_id: 'admin@example.com',
        created_at: new Date().toISOString(),
        members: [
          { user_id: 'admin@example.com', role: 'owner', added_at: new Date().toISOString() },
          { user_id: 'user@example.com', role: 'member', added_at: new Date().toISOString() },
        ],
      },
    ],
  },
};

const mockFeedbackResponse = {
  success: true,
  data: {
    entries: [],
    pagination: { page: 1, limit: 50, total: 0, total_pages: 0 },
  },
};

const mockNpsResponse = {
  success: true,
  data: {
    nps_score: 0,
    total_responses: 0,
    breakdown: { promoters: 0, passives: 0, detractors: 0, promoter_pct: 0, passive_pct: 0, detractor_pct: 0 },
    trend: [],
    recent_responses: [],
    campaigns: [],
  },
};

const mockConfigResponse = {
  success: true,
  data: { npsEnabled: false },
};

const allGatesOpen = {
  users: true,
  teams: true,
  roles: true,
  slack: true,
  skills: true,
  feedback: true,
  nps: true,
  stats: true,
  metrics: true,
  health: true,
  audit_logs: true,
  action_audit: true,
  policy: true,
};

function setupFetchMock(overrides: Record<string, any> = {}): jest.Mock {
  const mock = jest.fn((url: string) => {
    if (url.includes('/api/rbac/admin-tab-gates')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ gates: overrides.tabGates ?? allGatesOpen }),
      });
    }
    if (url.includes('/api/admin/stats') && !url.includes('skills')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(overrides.stats || mockStatsResponse),
      });
    }
    if (url.includes('/api/admin/users')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(overrides.usersList ?? mockUsersListResponse),
      });
    }
    if (url.includes('/api/admin/roles')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve(
            overrides.roles ?? {
              success: true,
              data: {
                roles: [
                  { id: 'r1', name: 'admin', clientRole: false },
                  { id: 'r2', name: 'user', clientRole: false },
                ],
              },
            }
          ),
      });
    }
    if (url.includes('/api/admin/teams')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(overrides.teams || mockTeamsResponse),
      });
    }
    if (url.includes('/api/admin/stats/skills')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: false }),
      });
    }
    if (url.includes('/api/admin/feedback')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(overrides.feedback || mockFeedbackResponse),
      });
    }
    if (url.includes('/api/admin/nps')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(overrides.nps || mockNpsResponse),
      });
    }
    if (url.includes('/api/config')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(overrides.config || mockConfigResponse),
      });
    }
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ success: true, data: {} }),
    });
  });
  global.fetch = mock as any;
  return mock;
}

jest.spyOn(console, 'error').mockImplementation(() => {});
jest.spyOn(console, 'log').mockImplementation(() => {});

import AdminPage from '../page';

// ============================================================================
// Tests
// ============================================================================

describe('Admin Dashboard Page', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsAdmin = false;
  });

  describe('Loading state', () => {
    it('shows spinner while loading', () => {
      setupFetchMock();
      render(<AdminPage />);
      expect(screen.getByTestId('spinner')).toBeInTheDocument();
    });
  });

  describe('Error state', () => {
    it('shows error message and retry button on fetch failure', async () => {
      (global.fetch as jest.Mock) = jest.fn().mockRejectedValue(new Error('Network error'));
      render(<AdminPage />);

      await waitFor(() => {
        expect(screen.getByText(/network error/i)).toBeInTheDocument();
      });
      expect(screen.getByText('Retry')).toBeInTheDocument();
    });

    it('shows auth error on 401 response', async () => {
      (global.fetch as jest.Mock) = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ success: false, error: 'Unauthorized' }),
      });
      render(<AdminPage />);

      await waitFor(() => {
        expect(screen.getByText(/not authenticated/i)).toBeInTheDocument();
      });
    });
  });

  describe('Read-only mode (non-admin user)', () => {
    beforeEach(() => {
      mockIsAdmin = false;
      setupFetchMock();
    });

    it('shows Read-Only badge', async () => {
      render(<AdminPage />);

      await waitFor(() => {
        expect(screen.getByText('Read-Only')).toBeInTheDocument();
      });
    });

    it('shows read-only description text', async () => {
      render(<AdminPage />);

      await waitFor(() => {
        expect(
          screen.getByText(/view platform usage.*read-only access/i)
        ).toBeInTheDocument();
      });
    });

    it('does not show Actions column header in users tab', async () => {
      render(<AdminPage />);

      await waitFor(() => {
        expect(screen.getByText('admin@example.com')).toBeInTheDocument();
      });

      expect(screen.queryByText('Actions')).not.toBeInTheDocument();
    });

    it('does not show Make Admin / Remove Admin buttons', async () => {
      render(<AdminPage />);

      await waitFor(() => {
        expect(screen.getByText('user@example.com')).toBeInTheDocument();
      });

      expect(screen.queryByText('Make Admin')).not.toBeInTheDocument();
      expect(screen.queryByText('Remove Admin')).not.toBeInTheDocument();
    });

    it('shows user table column headers in users tab', async () => {
      render(<AdminPage />);

      await waitFor(() => {
        expect(screen.getByText('Email')).toBeInTheDocument();
        expect(screen.getByText('Name')).toBeInTheDocument();
        expect(screen.getAllByText('Roles').length).toBeGreaterThan(0);
      });

      // Roles filter uses a button summary (MultiSelectFilter), not an input placeholder
      expect(screen.getByText('All roles')).toBeInTheDocument();
    });
  });

  describe('Admin mode', () => {
    beforeEach(() => {
      mockIsAdmin = true;
      setupFetchMock();
    });

    it('does not show Read-Only badge', async () => {
      render(<AdminPage />);

      await waitFor(() => {
        expect(screen.getByText('Admin Dashboard')).toBeInTheDocument();
      });

      expect(screen.queryByText('Read-Only')).not.toBeInTheDocument();
    });

    it('shows admin description text', async () => {
      render(<AdminPage />);

      await waitFor(() => {
        expect(
          screen.getByText(/manage users.*teams.*monitor usage/i)
        ).toBeInTheDocument();
      });
    });

    it('shows UserManagementTab column headers', async () => {
      render(<AdminPage />);

      await waitFor(() => {
        expect(screen.getByText('admin@example.com')).toBeInTheDocument();
      });

      const table = screen.getByRole('table');
      expect(within(table).getByText('Name')).toBeInTheDocument();
      expect(within(table).getByText('Email')).toBeInTheDocument();
      expect(within(table).getByText('Roles')).toBeInTheDocument();
    });

    it('shows Keycloak role badges for listed users', async () => {
      render(<AdminPage />);

      await waitFor(() => {
        expect(screen.getByText('user@example.com')).toBeInTheDocument();
      });

      const table = screen.getByRole('table');
      expect(within(table).getByText('admin')).toBeInTheDocument();
      expect(within(table).getByText('user')).toBeInTheDocument();
    });
  });

  describe('Stats rendering', () => {
    beforeEach(() => {
      setupFetchMock();
    });

    it('renders overview stat cards', async () => {
      render(<AdminPage />);

      await waitFor(() => {
        expect(screen.getByText('42')).toBeInTheDocument();
      });

      expect(screen.getByText('Total Users')).toBeInTheDocument();
      expect(screen.getByText('Conversations')).toBeInTheDocument();
      expect(screen.getByText('Messages')).toBeInTheDocument();
    });

    it('renders user list with correct data', async () => {
      render(<AdminPage />);

      await waitFor(() => {
        expect(screen.getByText('admin@example.com')).toBeInTheDocument();
        expect(screen.getByText('user@example.com')).toBeInTheDocument();
      });

      expect(screen.getByText('Admin User')).toBeInTheDocument();
      expect(screen.getByText('Regular User')).toBeInTheDocument();
    });

    it('fetches stats with date range params', async () => {
      const fetchMock = setupFetchMock();

      render(<AdminPage />);

      await waitFor(() => {
        expect(screen.getByText('42')).toBeInTheDocument();
      });

      // Initial fetch uses from/to date params instead of range=30d
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/admin/stats?from=')
      );
    });
  });
});
