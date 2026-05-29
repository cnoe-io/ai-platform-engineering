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
const replaceMock = jest.fn();
let currentSearchParams = new URLSearchParams();
jest.mock('@/hooks/use-admin-role', () => ({
  useAdminRole: () => ({ isAdmin: mockIsAdmin, loading: false }),
}));

const mockSessionStatus = { status: 'authenticated' as const };
jest.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { email: 'test@example.com' } }, ...mockSessionStatus }),
}));

jest.mock('next/navigation', () => ({
  useSearchParams: () => currentSearchParams,
  useRouter: () => ({ push: jest.fn(), replace: replaceMock, back: jest.fn(), refresh: jest.fn() }),
  usePathname: () => '/admin',
}));

jest.mock('@/lib/config', () => ({
  getConfig: (key: string) =>
    ({
      auditLogsEnabled: true,
      feedbackEnabled: true,
      npsEnabled: true,
      ssoEnabled: false,
    })[key] ?? true,
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

jest.mock('@/components/admin/ReviewConfigsTab', () => ({
  ReviewConfigsTab: () => <div data-testid="review-configs-tab">ReviewConfigsTab</div>,
}));

jest.mock('@/components/admin/PlatformSettingsTab', () => ({
  PlatformSettingsTab: () => <div data-testid="platform-settings-tab">PlatformSettingsTab</div>,
}));

jest.mock('@/components/admin/ReleaseNotesSettingsTab', () => ({
  ReleaseNotesSettingsTab: () => <div data-testid="release-notes-settings-tab">ReleaseNotesSettingsTab</div>,
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

jest.mock('@/components/admin/OpenFgaRebacTab', () => ({
  OpenFgaRebacTab: () => <div data-testid="openfga-rebac-tab">OpenFgaRebacTab</div>,
}));

jest.mock('@/components/admin/rebac/SlackChannelRebacPanel', () => ({
  SlackChannelRebacPanel: (props: { disabled?: boolean; selfService?: boolean }) => (
    <div
      data-testid="slack-integration-panel"
      data-disabled={String(Boolean(props.disabled))}
      data-self-service={String(Boolean(props.selfService))}
    >
      SlackIntegrationPanel
    </div>
  ),
}));

jest.mock('@/components/admin/rebac/WebexSpaceRebacPanel', () => ({
  WebexSpaceRebacPanel: (props: { disabled?: boolean; selfService?: boolean }) => (
    <div
      data-testid="webex-integration-panel"
      data-disabled={String(Boolean(props.disabled))}
      data-self-service={String(Boolean(props.selfService))}
    >
      WebexIntegrationPanel
    </div>
  ),
}));

jest.mock('@/components/admin/rebac/RagTeamAccessPanel', () => ({
  RagTeamAccessPanel: () => <div data-testid="rag-team-access-panel">RagTeamAccessPanel</div>,
}));

jest.mock('@/components/admin/identity-group-sync/IdentityGroupSyncTab', () => ({
  IdentityGroupSyncTab: () => <div data-testid="identity-group-sync-tab">IdentityGroupSyncTab</div>,
}));

jest.mock('@/components/admin/MigrationTab', () => ({
  MigrationTab: () => <div data-testid="migration-tab">MigrationTab</div>,
}));

jest.mock('@/components/admin/KeycloakMigrationHealthPanel', () => ({
  KeycloakMigrationHealthPanel: () => <div data-testid="keycloak-health-tab">KeycloakHealthTab</div>,
}));

jest.mock('@/components/admin/AuditLogsTab', () => ({
  AuditLogsTab: () => <div data-testid="audit-logs-tab">AuditLogsTab</div>,
}));

jest.mock('@/components/admin/UnifiedAuditTab', () => ({
  UnifiedAuditTab: () => <div data-testid="unified-audit-tab">UnifiedAuditTab</div>,
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
        // Commit 4/8 + 5/8 of the canonical-team-membership refactor:
        // `member_count` is the new server-aggregated truth from
        // `team_membership_sources`. We still emit a legacy `members[]`
        // so older defensive readers (search/filter UX) keep working
        // through the dual-write window.
        member_count: 2,
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
  data: { auditLogsEnabled: true, npsEnabled: true },
};

const allGatesOpen = {
  users: true,
  teams: true,
  roles: true,
  slack: true,
  webex: true,
  skills: true,
  feedback: true,
  nps: true,
  stats: true,
  metrics: true,
  health: true,
  audit_logs: true,
  action_audit: true,
  openfga: true,
  migrations: true,
  identity_group_sync: true,
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
      if (overrides.statsStatus) {
        return Promise.resolve({
          ok: overrides.statsStatus >= 200 && overrides.statsStatus < 300,
          status: overrides.statsStatus,
          json: () => Promise.resolve(overrides.stats || { success: false, error: 'Forbidden' }),
        });
      }
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
      const teamsResponse =
        typeof overrides.teams === 'function' ? overrides.teams(url) : overrides.teams;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(teamsResponse || mockTeamsResponse),
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
    currentSearchParams = new URLSearchParams();
  });

  describe('Loading state', () => {
    it('shows spinner while loading', () => {
      setupFetchMock();
      render(<AdminPage />);
      expect(screen.getByTestId('spinner')).toBeInTheDocument();
    });

    it('does not eagerly fetch /api/admin/users during loadAdminData', async () => {
      // Regression: loadAdminData() used to fetch /api/admin/users in its
      // Promise.all and then discard the result. With 1000+ realm users this
      // added several seconds of Keycloak round-trips to the first paint of
      // every admin tab — even tabs that have nothing to do with users.
      // UserManagementTab now owns the only first-paint /api/admin/users
      // call, and only when the Users tab is the active tab.
      currentSearchParams = new URLSearchParams('cat=settings&tab=settings');
      const fetchMock = setupFetchMock();
      render(<AdminPage />);

      await waitFor(() => {
        expect(screen.getByText('Admin Dashboard')).toBeInTheDocument();
      });

      const userListCalls = fetchMock.mock.calls.filter(([url]) => {
        if (typeof url !== 'string') return false;
        // Match /api/admin/users and /api/admin/users?... but not
        // /api/admin/users/{id}/... or /api/admin/users/stats.
        return /\/api\/admin\/users(\?|$)/.test(url);
      });
      expect(userListCalls).toEqual([]);
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

    it('shows user table without Keycloak role filters or columns', async () => {
      render(<AdminPage />);

      await waitFor(() => {
        expect(screen.getByText('Email')).toBeInTheDocument();
        expect(screen.getByText('Name')).toBeInTheDocument();
      });

      const table = screen.getByRole('table');
      expect(within(table).queryByText('Roles')).not.toBeInTheDocument();
      expect(screen.queryByText('All roles')).not.toBeInTheDocument();
    });

    it('opens resource-scoped Slack and Webex panels for non-admin messaging managers', async () => {
      setupFetchMock({
        tabGates: {
          ...allGatesOpen,
          roles: false,
          identity_group_sync: false,
          feedback: false,
          nps: false,
          stats: false,
          audit_logs: false,
          action_audit: false,
          openfga: false,
          migrations: false,
          slack: true,
          webex: true,
        },
      });
      currentSearchParams = new URLSearchParams('cat=integrations&tab=slack');

      render(<AdminPage />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Integrations' })).toBeInTheDocument();
      });

      expect(screen.getByRole('tab', { name: /^Slack$/i })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /^Webex$/i })).toBeInTheDocument();
      expect(screen.getByTestId('slack-integration-panel')).toHaveAttribute('data-self-service', 'true');
      expect(screen.getByTestId('slack-integration-panel')).toHaveAttribute('data-disabled', 'false');
    });
  });

  describe('Admin mode', () => {
    beforeEach(() => {
      mockIsAdmin = true;
      setupFetchMock();
    });

    it('opens a subtle searchable view-as modal from the category bar', async () => {
      render(<AdminPage />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /view as/i })).toBeInTheDocument();
      });
      expect(screen.queryByText(/Read-only simulator\. The UI stays authenticated as you/i)).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /view as/i }));

      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByText('View As Effective Permissions')).toBeInTheDocument();
      const search = screen.getByPlaceholderText(/search by email, name, or keycloak sub/i);
      fireEvent.change(search, { target: { value: 'user' } });

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith('/api/admin/users?search=user&pageSize=20');
      });

      fireEvent.click(await screen.findByRole('button', { name: /Regular User user@example.com kc-user/i }));
      fireEvent.click(screen.getByRole('button', { name: 'Preview' }));

      expect(replaceMock).toHaveBeenCalledWith(
        expect.stringContaining('simulate_type=user&simulate_id=kc-user'),
        { scroll: false }
      );
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
      currentSearchParams = new URLSearchParams('cat=people&tab=users');

      render(<AdminPage />);

      await waitFor(() => {
        expect(screen.getByText('admin@example.com')).toBeInTheDocument();
      });

      const table = screen.getByRole('table');
      expect(within(table).getByText('Name')).toBeInTheDocument();
      expect(within(table).getByText('Email')).toBeInTheDocument();
      expect(within(table).queryByText('Roles')).not.toBeInTheDocument();
    });

    it('exposes Slack pending as a user table filter', async () => {
      currentSearchParams = new URLSearchParams('cat=people&tab=users&umSlack=pending');
      const fetchMock = setupFetchMock();

      render(<AdminPage />);

      await waitFor(() => {
        expect(screen.getByText('admin@example.com')).toBeInTheDocument();
      });

      const slackSelect = screen
        .getAllByRole('combobox')
        .find((select) => within(select).queryByRole('option', { name: 'Pending' }));
      expect(slackSelect).toBeDefined();
      expect(slackSelect).toHaveValue('pending');
      expect(within(slackSelect!).getByRole('option', { name: 'Pending' })).toBeInTheDocument();

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(
          expect.stringContaining('/api/admin/users?page=1&pageSize=20&slackStatus=pending')
        );
      });

      fireEvent.change(slackSelect!, { target: { value: 'linked' } });
      expect(replaceMock).toHaveBeenCalledWith(
        expect.stringContaining('umSlack=linked'),
        { scroll: false }
      );
    });

    it('exposes Webex linked as a user table filter', async () => {
      currentSearchParams = new URLSearchParams('cat=people&tab=users&umWebex=linked');
      const fetchMock = setupFetchMock();

      render(<AdminPage />);

      await waitFor(() => {
        expect(screen.getByText('admin@example.com')).toBeInTheDocument();
      });

      const webexLabel = screen.getByText('Webex', { selector: 'span.text-xs' });
      const webexFilter = webexLabel.parentElement?.querySelector('select');
      expect(webexFilter).toBeDefined();
      expect(webexFilter).toHaveValue('linked');

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(
          expect.stringContaining('/api/admin/users?page=1&pageSize=20&webexStatus=linked')
        );
      });

      fireEvent.change(webexFilter!, { target: { value: 'unlinked' } });
      expect(replaceMock).toHaveBeenCalledWith(
        expect.stringContaining('umWebex=unlinked'),
        { scroll: false }
      );
    });

    it('orders Security & Policy tabs with OpenFGA ReBAC as the default', async () => {
      currentSearchParams = new URLSearchParams('cat=security');

      render(<AdminPage />);

      await waitFor(() => {
        expect(screen.getByText('Security & Policy')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Security & Policy'));
      expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
        'OpenFGA ReBAC',
        'RBAC Audit',
        'Chat Audit',
        'Keycloak',
        'Migrations',
      ]);
      expect(screen.getByRole('tab', { name: /OpenFGA ReBAC/i })).toHaveAttribute(
        'aria-selected',
        'true'
      );
      expect(screen.getByRole('tab', { name: /^RBAC Audit$/i })).toBeInTheDocument();
      expect(screen.queryByRole('tab', { name: /^Policy$/i })).not.toBeInTheDocument();
    });

    it('does not show Keycloak role badges for listed users', async () => {
      currentSearchParams = new URLSearchParams('cat=people&tab=users');

      render(<AdminPage />);

      await waitFor(() => {
        expect(screen.getByText('user@example.com')).toBeInTheDocument();
      });

      const table = screen.getByRole('table');
      expect(within(table).queryByText('admin')).not.toBeInTheDocument();
      expect(within(table).queryByText('user')).not.toBeInTheDocument();
    });

    it('does not expose the retired Roles tab in Teams & Users', async () => {
      currentSearchParams = new URLSearchParams('cat=people&tab=users');

      render(<AdminPage />);

      await waitFor(() => {
        expect(screen.getByText('Teams & Users')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: 'Teams & Users' }));
      expect(screen.getByRole('tab', { name: /^Users$/i })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /^Teams$/i })).toBeInTheDocument();
      expect(screen.queryByRole('tab', { name: /^Slack$/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('tab', { name: /^Roles$/i })).not.toBeInTheDocument();
    });

    it('groups admin tabs by category and promotes settings to its own category', async () => {
      render(<AdminPage />);

      await waitFor(() => {
        expect(screen.getByText('Settings')).toBeInTheDocument();
      });

      const categoryButtons = ['Settings', 'Teams & Users', 'Integrations', 'Insights', 'Metrics & Health', 'Security & Policy']
        .map((label) => screen.getByRole('button', { name: label }));
      expect(categoryButtons[0]).toHaveTextContent('Settings');
      expect(screen.queryByRole('button', { name: 'Resources' })).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
      expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
        'Default Agent',
        'Release notes',
        'AI Review',
        'Credentials',
        'Knowledge Bases',
        'Skills',
      ]);
      expect(screen.getByTestId('platform-settings-tab')).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /release notes/i })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /skills/i })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /ai review/i })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /knowledge bases/i })).toBeInTheDocument();
      expect(screen.queryByRole('tab', { name: /rag team access/i })).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Insights' }));
      expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
        'Statistics',
        'Feedback',
        'NPS',
      ]);
      expect(screen.getByRole('tab', { name: /^Statistics$/i })).toHaveAttribute(
        'aria-selected',
        'true'
      );
      expect(screen.queryByRole('tab', { name: /^Insights$/i })).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /metrics & health/i }));

      expect(screen.getByRole('tab', { name: /metrics/i })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /health/i })).toBeInTheDocument();
      expect(screen.queryByRole('tab', { name: /skills/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('tab', { name: /ai review/i })).not.toBeInTheDocument();
    });

    it('keeps the settings shell available for non-admin users when admin stats are forbidden', async () => {
      currentSearchParams = new URLSearchParams('cat=settings&tab=settings');
      setupFetchMock({
        tabGates: {
          users: false,
          teams: false,
          roles: false,
          slack: false,
          webex: false,
          skills: false,
          feedback: false,
          nps: false,
          stats: false,
          metrics: false,
          health: false,
          audit_logs: false,
          action_audit: false,
          openfga: false,
          migrations: false,
          identity_group_sync: false,
        },
        statsStatus: 403,
      });

      render(<AdminPage />);

      expect(await screen.findByTestId('platform-settings-tab')).toBeInTheDocument();
      expect(screen.queryByText(/Access denied/i)).not.toBeInTheDocument();
      expect(screen.queryByRole('tab', { name: /^Users$/i })).not.toBeInTheDocument();
    });

    it('defaults bare /admin to the top-level Settings Default Agent tab', async () => {
      render(<AdminPage />);

      expect(await screen.findByText('Settings')).toBeInTheDocument();

      expect(screen.getByRole('button', { name: 'Settings' })).toHaveClass('bg-primary');
      expect(screen.getByRole('tab', { name: /default agent/i })).toHaveAttribute(
        'aria-selected',
        'true'
      );
      expect(screen.getByTestId('platform-settings-tab')).toBeInTheDocument();
      expect(replaceMock).toHaveBeenCalledWith('/admin?cat=settings&tab=settings', {
        scroll: false,
      });
    });

    it('opens the Release notes settings tab from the query string', async () => {
      currentSearchParams = new URLSearchParams('cat=settings&tab=release-notes');

      render(<AdminPage />);

      expect(await screen.findByText('Settings')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Settings' })).toHaveClass('bg-primary');
      expect(screen.getByRole('tab', { name: /^Release notes$/i })).toHaveAttribute(
        'aria-selected',
        'true'
      );
      expect(screen.getByTestId('release-notes-settings-tab')).toBeInTheDocument();
      expect(replaceMock).not.toHaveBeenCalledWith('/admin?cat=settings&tab=settings', {
        scroll: false,
      });
    });

    it.each([
      ['settings', 'settings', /^Default Agent$/i],
      ['settings', 'release-notes', /^Release notes$/i],
      ['settings', 'ai-review', /^AI Review$/i],
      ['settings', 'rag-access', /^Knowledge Bases$/i],
      ['settings', 'skills', /^Skills$/i],
      ['people', 'users', /^Users$/i],
      ['people', 'teams', /^Teams$/i],
      ['people', 'identity-groups', /^Identity Groups$/i],
      ['integrations', 'slack', /^Slack$/i],
      ['integrations', 'webex', /^Webex$/i],
      ['insights', 'stats', /^Statistics$/i],
      ['insights', 'feedback', /^Feedback$/i],
      ['insights', 'nps', /^NPS$/i],
      ['platform', 'metrics', /^Metrics$/i],
      ['platform', 'health', /^Health$/i],
      ['security', 'openfga', /^OpenFGA ReBAC$/i],
      ['security', 'keycloak', /^Keycloak$/i],
      ['security', 'action-audit', /^RBAC Audit$/i],
      ['security', 'audit-logs', /^Chat Audit$/i],
      ['security', 'migrations', /^Migrations$/i],
    ])('keeps direct sub-tab route cat=%s tab=%s selected', async (category, tab, label) => {
      currentSearchParams = new URLSearchParams(`cat=${category}&tab=${tab}`);

      render(<AdminPage />);

      await waitFor(() => {
        expect(screen.getByRole('tab', { name: label })).toHaveAttribute('aria-selected', 'true');
      });
      expect(replaceMock).not.toHaveBeenCalledWith('/admin?cat=settings&tab=settings', {
        scroll: false,
      });
    });

    it('moves Slack and Webex under the top-level Integrations category', async () => {
      currentSearchParams = new URLSearchParams('cat=integrations&tab=slack');

      render(<AdminPage />);

      expect(await screen.findByText('Integrations')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Integrations' })).toHaveClass('bg-primary');
      expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
        'Slack',
        'Webex',
      ]);
      expect(screen.getByRole('tab', { name: /^Slack$/i })).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByTestId('slack-integration-panel')).toBeInTheDocument();
    });

    it('opens the Webex integration panel from the query string', async () => {
      currentSearchParams = new URLSearchParams('cat=integrations&tab=webex');

      render(<AdminPage />);

      expect(await screen.findByText('Integrations')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Integrations' })).toHaveClass('bg-primary');
      expect(screen.getByRole('tab', { name: /^Webex$/i })).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByTestId('webex-integration-panel')).toBeInTheDocument();
    });

    it('moves Knowledge Bases under Settings', async () => {
      currentSearchParams = new URLSearchParams('cat=settings&tab=rag-access');

      render(<AdminPage />);

      expect(await screen.findByText('Settings')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Settings' })).toHaveClass('bg-primary');
      expect(screen.getByRole('tab', { name: /^Knowledge Bases$/i })).toHaveAttribute(
        'aria-selected',
        'true'
      );
      expect(screen.getByTestId('rag-team-access-panel')).toBeInTheDocument();
    });

    it('canonicalizes legacy OpenFGA RAG deep links to Settings Knowledge Bases', async () => {
      currentSearchParams = new URLSearchParams('cat=security&tab=openfga&subtab=rag&openfgaTab=rag');

      render(<AdminPage />);

      expect(await screen.findByText('Settings')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Settings' })).toHaveClass('bg-primary');
      expect(screen.getByRole('tab', { name: /^Knowledge Bases$/i })).toHaveAttribute(
        'aria-selected',
        'true'
      );
      expect(screen.getByTestId('rag-team-access-panel')).toBeInTheDocument();
      expect(replaceMock).toHaveBeenCalledWith('/admin?cat=settings&tab=rag-access', {
        scroll: false,
      });
    });

    it('canonicalizes legacy Resources Knowledge Base links to Settings', async () => {
      currentSearchParams = new URLSearchParams('cat=resources&tab=rag-access');

      render(<AdminPage />);

      expect(await screen.findByText('Settings')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Settings' })).toHaveClass('bg-primary');
      expect(screen.getByRole('tab', { name: /^Knowledge Bases$/i })).toHaveAttribute(
        'aria-selected',
        'true'
      );
      expect(replaceMock).toHaveBeenCalledWith('/admin?cat=settings&tab=rag-access', {
        scroll: false,
      });
    });

    it('canonicalizes legacy Insights overview deep links to the merged Statistics tab', async () => {
      currentSearchParams = new URLSearchParams('cat=insights&tab=insights');

      render(<AdminPage />);

      expect(await screen.findByText('Insights')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Insights' })).toHaveClass('bg-primary');
      expect(screen.getByRole('tab', { name: /^Statistics$/i })).toHaveAttribute(
        'aria-selected',
        'true'
      );
      expect(screen.queryByRole('tab', { name: /^Insights$/i })).not.toBeInTheDocument();
      expect(replaceMock).toHaveBeenCalledWith('/admin?cat=insights&tab=stats', {
        scroll: false,
      });
    });

    it('opens the requested category sub-tab from the query string', async () => {
      currentSearchParams = new URLSearchParams('cat=security&tab=openfga');

      render(<AdminPage />);

      expect(await screen.findByText('Security & Policy')).toBeInTheDocument();

      expect(screen.getByRole('button', { name: 'Security & Policy' })).toHaveClass('bg-primary');
      expect(screen.getByRole('tab', { name: /openfga rebac/i })).toHaveAttribute(
        'aria-selected',
        'true'
      );
      expect(screen.getByTestId('openfga-rebac-tab')).toBeInTheDocument();
    });

    it('canonicalizes legacy OpenFGA Slack deep links to Integrations Slack', async () => {
      currentSearchParams = new URLSearchParams(
        'cat=system&tab=settings&subtab=slack&openfgaTab=slack'
      );

      render(<AdminPage />);

      expect(await screen.findByText('Integrations')).toBeInTheDocument();

      expect(screen.getByRole('button', { name: 'Integrations' })).toHaveClass('bg-primary');
      expect(screen.getByRole('tab', { name: /^Slack$/i })).toHaveAttribute(
        'aria-selected',
        'true'
      );
      expect(screen.getByTestId('slack-integration-panel')).toBeInTheDocument();
      expect(replaceMock).toHaveBeenCalledWith(
        '/admin?cat=integrations&tab=slack',
        { scroll: false }
      );
    });

    it('opens an in-app modal before deleting a team', async () => {
      currentSearchParams = new URLSearchParams('cat=people&tab=teams');
      const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false);
      const fetchMock = setupFetchMock();

      render(<AdminPage />);

      expect(await screen.findByText('Platform Team')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /delete platform team/i }));

      expect(confirmSpy).not.toHaveBeenCalled();
      expect(
        screen.getByText(/delete the team "Platform Team"/i)
      ).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /^delete team$/i }));

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith('/api/admin/teams/team-1', {
          method: 'DELETE',
        });
      });

      confirmSpy.mockRestore();
    });

    it('shows a compact Chat chip for combined Slack channels and Webex spaces', async () => {
      currentSearchParams = new URLSearchParams('cat=people&tab=teams');
      setupFetchMock({
        teams: {
          success: true,
          data: {
            teams: [
              {
                _id: 'team-integrations',
                name: 'Integration Team',
                description: 'Owns chat surfaces',
                owner_id: 'admin@example.com',
                created_at: new Date().toISOString(),
                members: [
                  { user_id: 'admin@example.com', role: 'owner', added_at: new Date().toISOString() },
                ],
                slack_channels: [
                  { slack_channel_id: 'C111', channel_name: 'alerts' },
                ],
                webex_spaces: [
                  { space_id: 'space-1', space_name: 'Support Room' },
                  { space_id: 'space-2', space_name: 'Incident Room' },
                ],
              },
            ],
          },
        },
      });

      render(<AdminPage />);

      expect(await screen.findByText('Integration Team')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /3 chat integrations/i })).toBeInTheDocument();
      expect(screen.getByText(/^Chat$/i)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /3 integrations/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /1 channels/i })).not.toBeInTheDocument();
    });

    it('shows the KB chip count from team resources', async () => {
      currentSearchParams = new URLSearchParams('cat=people&tab=teams');
      setupFetchMock({
        teams: {
          success: true,
          data: {
            teams: [
              {
                _id: 'team-kbs',
                name: 'KB Team',
                owner_id: 'admin@example.com',
                created_at: new Date().toISOString(),
                member_count: 1,
                members: [],
                resources: {
                  knowledge_bases: ['kb-1', 'kb-2'],
                },
              },
            ],
          },
        },
      });

      render(<AdminPage />);

      expect(await screen.findByText('KB Team')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /2 KBs/i })).toBeInTheDocument();
    });

    it('filters teams by search text and shows an empty result state', async () => {
      currentSearchParams = new URLSearchParams('cat=people&tab=teams');
      setupFetchMock({
        teams: {
          success: true,
          data: {
            teams: [
              {
                _id: 'team-platform',
                name: 'Platform Team',
                description: 'Core platform engineering',
                owner_id: 'platform-owner@example.com',
                created_at: new Date().toISOString(),
                members: [
                  { user_id: 'platform-owner@example.com', role: 'owner', added_at: new Date().toISOString() },
                ],
              },
              {
                _id: 'team-security',
                name: 'Security Team',
                description: 'Guardrails and audits',
                owner_id: 'security-owner@example.com',
                created_at: new Date().toISOString(),
                members: [
                  { user_id: 'security-owner@example.com', role: 'owner', added_at: new Date().toISOString() },
                ],
              },
            ],
          },
        },
      });

      render(<AdminPage />);

      expect(await screen.findByText('Platform Team')).toBeInTheDocument();
      expect(screen.getByText('Security Team')).toBeInTheDocument();

      fireEvent.change(
        screen.getByRole('searchbox', { name: /search teams/i }),
        { target: { value: 'security' } }
      );

      expect(screen.queryByText('Platform Team')).not.toBeInTheDocument();
      expect(screen.getByText('Security Team')).toBeInTheDocument();

      fireEvent.change(
        screen.getByRole('searchbox', { name: /search teams/i }),
        { target: { value: 'does-not-exist' } }
      );

      expect(screen.getByText(/No teams match "does-not-exist"/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /clear team search/i })).toBeInTheDocument();
    });

    it('refreshes teams from the database without reloading the whole admin dashboard', async () => {
      currentSearchParams = new URLSearchParams('cat=people&tab=teams');
      let teamFetchCount = 0;
      const fetchMock = setupFetchMock({
        teams: () => {
          teamFetchCount += 1;
          return {
            success: true,
            data: {
              teams: [
                {
                  _id: `team-${teamFetchCount}`,
                  name: teamFetchCount === 1 ? 'Platform Team' : 'Security Team',
                  description: teamFetchCount === 1 ? 'Initial team' : 'Fresh team from MongoDB',
                  owner_id: 'admin@example.com',
                  created_at: new Date().toISOString(),
                  members: [
                    { user_id: 'admin@example.com', role: 'owner', added_at: new Date().toISOString() },
                  ],
                },
              ],
            },
          };
        },
      });

      render(<AdminPage />);

      expect(await screen.findByText('Platform Team')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /refresh teams/i }));

      expect(await screen.findByText('Security Team')).toBeInTheDocument();
      expect(screen.queryByText('Platform Team')).not.toBeInTheDocument();

      const teamRequests = fetchMock.mock.calls.filter(([url]) =>
        String(url).includes('/api/admin/teams')
      );
      expect(teamRequests).toHaveLength(2);
      expect(teamRequests[0][0]).toEqual(expect.stringContaining('/api/admin/teams?fresh='));
      expect(teamRequests[0][1]).toMatchObject({ cache: 'no-store' });
      expect(teamRequests[1][0]).toEqual(expect.stringContaining('/api/admin/teams?fresh='));
      expect(teamRequests[1][1]).toMatchObject({ cache: 'no-store' });
    });
  });

  describe('Stats rendering', () => {
    beforeEach(() => {
      setupFetchMock();
    });

    it('renders overview stat cards and detailed charts from the first Statistics tab', async () => {
      render(<AdminPage />);

      await screen.findByText('Teams & Users');
      expect(screen.queryByText('Total Users')).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Insights' }));

      await waitFor(() => {
        expect(screen.getByText('42')).toBeInTheDocument();
      });

      expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
        'Statistics',
        'Feedback',
        'NPS',
      ]);
      expect(screen.getByRole('tab', { name: /^Statistics$/i })).toHaveAttribute(
        'aria-selected',
        'true'
      );
      expect(screen.getByText('Total Users')).toBeInTheDocument();
      expect(screen.getByText('Conversations')).toBeInTheDocument();
      expect(screen.getByText('Messages')).toBeInTheDocument();
      expect(screen.getByText('Daily Active Users (DAU)')).toBeInTheDocument();
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
        expect(fetchMock).toHaveBeenCalledWith(
          expect.stringContaining('/api/admin/stats?from=')
        );
      });

      // Initial fetch uses from/to date params instead of range=30d
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/admin/stats?from=')
      );
    });
  });
});
