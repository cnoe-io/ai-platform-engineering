import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { UnifiedAuditTab } from '../UnifiedAuditTab';

describe('UnifiedAuditTab', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (global.fetch as jest.Mock) = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        records: [],
        total: 0,
        page: 1,
        limit: 30,
      }),
    });
  });

  it('shows admin required message when not admin (fetch still runs before gate)', async () => {
    render(<UnifiedAuditTab isAdmin={false} />);
    expect(
      screen.getByText(/Admin access required to view audit events/i)
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });
  });

  it('loads audit events when admin', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        records: [
          {
            id: '1',
            ts: new Date().toISOString(),
            type: 'auth',
            outcome: 'allow',
            action: 'admin_ui#view',
            tenant_id: 'default',
            subject_hash: 'h',
            correlation_id: 'c',
            source: 'bff',
          },
        ],
        total: 1,
        page: 1,
        limit: 30,
      }),
    });

    render(<UnifiedAuditTab isAdmin />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });

    expect(await screen.findByText(/Action Audit Log/i)).toBeInTheDocument();
    expect(screen.getByText(/admin_ui#view/i)).toBeInTheDocument();
  });
});
