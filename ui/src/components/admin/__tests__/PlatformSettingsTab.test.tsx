/**
 * @jest-environment jsdom
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PlatformSettingsTab } from '../PlatformSettingsTab';

const defaultAgents = [
  { _id: 'sre', name: 'Basic SRE', description: 'Handles SRE workflows' },
  { _id: 'kb', name: 'Knowledge Base Agent', description: 'Answers from KBs' },
];

function mockFetch({
  agents = defaultAgents,
  config = { success: true, data: { default_agent_id: null } },
  patch = { success: true },
}: {
  agents?: Array<{ _id: string; name: string; description?: string }>;
  config?: { success: boolean; data?: { default_agent_id?: string | null; source?: string } };
  patch?: { success: boolean };
} = {}) {
  global.fetch = jest.fn((url: RequestInfo | URL, init?: RequestInit) => {
    const href = String(url);
    if (href.includes('/api/dynamic-agents/available')) {
      return Promise.resolve({
        json: () => Promise.resolve({ data: agents }),
      } as Response);
    }
    if (href.includes('/api/admin/platform-config') && init?.method === 'PATCH') {
      return Promise.resolve({
        json: () => Promise.resolve(patch),
      } as Response);
    }
    if (href.includes('/api/admin/platform-config')) {
      return Promise.resolve({
        json: () => Promise.resolve(config),
      } as Response);
    }
    return Promise.reject(new Error(`Unexpected fetch: ${href}`));
  });
}

describe('PlatformSettingsTab', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch();
  });

  it('labels the supervisor option as Default CAIPE Supervisor', async () => {
    render(<PlatformSettingsTab isAdmin />);

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Default CAIPE Supervisor' })).toBeInTheDocument();
    });
  });

  it('selects the configured default dynamic agent and shows its description', async () => {
    mockFetch({ config: { success: true, data: { default_agent_id: 'sre' } } });

    render(<PlatformSettingsTab isAdmin />);

    const select = await screen.findByRole('combobox');
    expect(select).toHaveValue('sre');
    expect(screen.getByText('Handles SRE workflows')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
  });

  it('disables default-agent editing for read-only users', async () => {
    render(<PlatformSettingsTab isAdmin={false} />);

    const select = await screen.findByRole('combobox');
    expect(select).toBeDisabled();
    expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument();
  });

  it('warns when the saved default agent is no longer available', async () => {
    mockFetch({ config: { success: true, data: { default_agent_id: 'deleted-agent' } } });

    render(<PlatformSettingsTab isAdmin />);

    await waitFor(() => {
      expect(screen.getByText(/previously configured default agent is no longer available/i))
        .toBeInTheDocument();
    });
  });

  it('shows when the default came from the DEFAULT_AGENT_ID environment value', async () => {
    mockFetch({ config: { success: true, data: { default_agent_id: 'sre', source: 'env' } } });

    render(<PlatformSettingsTab isAdmin />);

    await waitFor(() => {
      expect(screen.getByText(/env var as bootstrap default/i)).toBeInTheDocument();
      expect(screen.getAllByText('DEFAULT_AGENT_ID')).toHaveLength(2);
    });
  });

  it('saves the supervisor fallback as a null default_agent_id', async () => {
    mockFetch({ config: { success: true, data: { default_agent_id: 'sre' } } });

    render(<PlatformSettingsTab isAdmin />);

    const select = await screen.findByRole('combobox');
    fireEvent.change(select, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/admin/platform-config',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ default_agent_id: null }),
        })
      );
    });
    expect(await screen.findByText('Saved')).toBeInTheDocument();
  });
});
