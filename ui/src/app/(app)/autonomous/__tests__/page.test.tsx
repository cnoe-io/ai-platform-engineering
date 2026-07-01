/**
 * Tests for the autonomous tab page under the per-user ownership model
 * (plan section 4.2). The page no longer gates on admin/admin-view —
 * every authenticated user sees the page, the New task button, and
 * their own task list. Admins additionally see the `Admin view · all
 * users` chip and an owner column on each row.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';

// ============================================================================
// Mocks — must be declared before importing the page module.
// ============================================================================

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(''),
}));

const mockSession = {
  data: { user: { name: 'Test User', email: 'test@example.com' } },
  status: 'authenticated' as const,
  update: jest.fn(),
};
jest.mock('next-auth/react', () => ({
  useSession: jest.fn(() => mockSession),
}));

jest.mock('@/components/auth-guard', () => ({
  AuthGuard: ({ children }: any) => <div data-testid="auth-guard">{children}</div>,
}));

jest.mock('@/components/ui/toast', () => ({
  useToast: () => ({ toast: jest.fn() }),
}));

jest.mock('@/lib/config', () => ({
  getConfig: (key: string) => {
    if (key === 'autonomousAgentsEnabled') return true;
    return undefined;
  },
}));

// Mock the admin-role hook so we can drive the page state.
const mockUseAdminRole = jest.fn();
jest.mock('@/hooks/use-admin-role', () => ({
  useAdminRole: () => mockUseAdminRole(),
}));

// Mock the autonomous API client; the page calls listTasks on mount.
const mockListTasks = jest.fn();
const mockGetTask = jest.fn();
jest.mock('@/components/autonomous/api', () => {
  class AutonomousApiError extends Error {
    status: number;
    detail: unknown;
    constructor(status: number, detail: unknown, message: string) {
      super(message);
      this.status = status;
      this.detail = detail;
    }
  }
  return {
    AutonomousApiError,
    autonomousApi: {
      listTasks: (...args: unknown[]) => mockListTasks(...args),
      getTask: (...args: unknown[]) => mockGetTask(...args),
      createTask: jest.fn(),
      updateTask: jest.fn(),
      deleteTask: jest.fn(),
      triggerTask: jest.fn(),
    },
  };
});

// Stub out TaskList / TaskFormDialog / RunHistory so we only test the
// page's gating + composition, not the children's internal markup.
jest.mock('@/components/autonomous/TaskList', () => ({
  TaskList: (props: any) => (
    <div data-testid="task-list">
      <span data-testid="task-list-show-owner">{String(props.showOwner)}</span>
      <span data-testid="task-list-current-user">{props.currentUserEmail ?? ''}</span>
      <span data-testid="task-list-task-count">{props.tasks.length}</span>
    </div>
  ),
}));

jest.mock('@/components/autonomous/TaskFormDialog', () => ({
  TaskFormDialog: () => <div data-testid="task-form-dialog" />,
}));

jest.mock('@/components/autonomous/RunHistory', () => ({
  RunHistory: () => <div data-testid="run-history" />,
}));

// Lucide icons → simple spans.
jest.mock('lucide-react', () => {
  const stub = (name: string) => {
    const Icon = (props: any) => <span data-testid={`icon-${name}`} {...props} />;
    Icon.displayName = `Icon-${name}`;
    return Icon;
  };
  return new Proxy(
    {},
    {
      get: (_target, prop) => stub(String(prop).toLowerCase()),
    },
  );
});

// ============================================================================
// Import after mocks
// ============================================================================
import Page from '../page';

beforeEach(() => {
  jest.clearAllMocks();
  mockListTasks.mockResolvedValue([]);
});

// ============================================================================
// Tests
// ============================================================================

describe('Autonomous page — per-user model (plan section 4.2)', () => {
  it('renders the New task button for an authenticated non-admin user', async () => {
    mockUseAdminRole.mockReturnValue({
      isAdmin: false,
      canViewAdmin: false,
      loading: false,
    });

    render(<Page />);

    await waitFor(() => {
      expect(screen.getByTestId('autonomous-new-task')).toBeInTheDocument();
    });
  });

  it('does not render the read-only banner or forbidden banner for non-admins', async () => {
    mockUseAdminRole.mockReturnValue({
      isAdmin: false,
      canViewAdmin: false,
      loading: false,
    });

    render(<Page />);

    await waitFor(() => {
      expect(screen.getByTestId('task-list')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('autonomous-readonly-banner')).toBeNull();
    expect(screen.queryByTestId('autonomous-forbidden')).toBeNull();
  });

  it('does not show the Admin view chip or owner column for non-admins', async () => {
    mockUseAdminRole.mockReturnValue({
      isAdmin: false,
      canViewAdmin: false,
      loading: false,
    });

    render(<Page />);

    await waitFor(() => {
      expect(screen.getByTestId('task-list')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('autonomous-admin-chip')).toBeNull();
    expect(screen.getByTestId('task-list-show-owner')).toHaveTextContent('false');
  });

  it('shows the Admin view chip and passes showOwner=true for admins', async () => {
    mockUseAdminRole.mockReturnValue({
      isAdmin: true,
      canViewAdmin: true,
      loading: false,
    });

    render(<Page />);

    await waitFor(() => {
      expect(screen.getByTestId('task-list')).toBeInTheDocument();
    });

    expect(screen.getByTestId('autonomous-admin-chip')).toBeInTheDocument();
    expect(screen.getByTestId('task-list-show-owner')).toHaveTextContent('true');
    expect(screen.getByTestId('task-list-current-user')).toHaveTextContent(
      'test@example.com',
    );
  });

  it('hides the Admin view chip while the role check is loading', async () => {
    mockUseAdminRole.mockReturnValue({
      isAdmin: false,
      canViewAdmin: false,
      loading: true,
    });

    render(<Page />);

    // Page should still mount and start fetching even though role check is in flight.
    await waitFor(() => {
      expect(mockListTasks).toHaveBeenCalled();
    });

    expect(screen.queryByTestId('autonomous-admin-chip')).toBeNull();
  });

  it('fetches tasks even when roleLoading is true (does not block fetch on role resolution)', async () => {
    mockUseAdminRole.mockReturnValue({
      isAdmin: false,
      canViewAdmin: false,
      loading: true,
    });
    mockListTasks.mockResolvedValue([
      {
        id: 't1',
        name: 'Mine',
        agent: 'github',
        prompt: 'p',
        trigger: { type: 'cron', schedule: '0 9 * * *' },
        enabled: true,
        owner_id: 'test@example.com',
      },
    ]);

    render(<Page />);

    await waitFor(() => {
      expect(mockListTasks).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('task-list-task-count')).toHaveTextContent('1');
    });
  });
});
