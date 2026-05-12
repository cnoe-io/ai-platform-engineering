import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { CelTabPoliciesEditor } from '../CelTabPoliciesEditor';

describe('CelTabPoliciesEditor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (global.fetch as jest.Mock) = jest.fn();
  });

  it('shows read-only hint when not admin', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ policies: [] }),
    });

    render(<CelTabPoliciesEditor isAdmin={false} />);

    await waitFor(() => {
      expect(screen.getByText(/Read-only access/i)).toBeInTheDocument();
    });
  });

  it('loads tab policies when admin-tab-policies returns data', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        policies: [
          { tab_key: 'users', expression: 'true' },
          { tab_key: 'teams', expression: '' },
        ],
      }),
    });

    render(<CelTabPoliciesEditor isAdmin />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/rbac/admin-tab-policies');
    });

    expect(
      await screen.findByText(/Admin Tab Visibility Policies/i)
    ).toBeInTheDocument();
    expect(screen.getByText('Users')).toBeInTheDocument();
  });

  it('falls back to gates when admin-tab-policies is missing', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          gates: {
            users: true,
            teams: true,
            roles: false,
            slack: false,
            skills: false,
            feedback: false,
            nps: false,
            stats: false,
            metrics: false,
            health: false,
            audit_logs: false,
            action_audit: false,
            policy: false,
          },
        }),
      });

    render(<CelTabPoliciesEditor isAdmin />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    expect(await screen.findByText('Users')).toBeInTheDocument();
  });
});
