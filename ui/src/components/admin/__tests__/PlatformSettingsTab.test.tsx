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
  config = {
    success: true,
    data: {
      default_agent_id: null,
      release_notes: {
        enabled: true,
        release_version: '0.5.1',
        announcement_revision: 2,
        announcement_id: '0.5.1:revision-2',
        show_toast: true,
        toast_duration_ms: 8000,
        show_migration_cta: true,
      },
    },
  },
  patch = { success: true },
}: {
  agents?: Array<{ _id: string; name: string; description?: string }>;
  config?: { success: boolean; data?: { default_agent_id?: string | null; source?: string; release_notes?: any } };
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
    expect(screen.getByTestId('default-agent-save')).toBeDisabled();
  });

  it('disables default-agent editing for read-only users', async () => {
    render(<PlatformSettingsTab isAdmin={false} />);

    const select = await screen.findByRole('combobox');
    expect(select).toBeDisabled();
    expect(screen.queryByTestId('default-agent-save')).not.toBeInTheDocument();
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

  it('saves the supervisor fallback as a null default_agent_id after clear confirmation', async () => {
    mockFetch({ config: { success: true, data: { default_agent_id: 'sre' } } });

    render(<PlatformSettingsTab isAdmin />);

    const select = await screen.findByRole('combobox');
    fireEvent.change(select, { target: { value: '' } });
    fireEvent.click(screen.getByTestId('default-agent-save'));

    // Lighter "Remove default" confirmation appears first.
    const removeDefaultButton = await screen.findByRole('button', { name: /remove default/i });
    expect(screen.getByText(/fall back to the supervisor/i)).toBeInTheDocument();
    fireEvent.click(removeDefaultButton);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/admin/platform-config',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ default_agent_id: null, acknowledge_public_access: true }),
        })
      );
    });
    expect(await screen.findByText('Saved')).toBeInTheDocument();
  });

  it('does not render release notes controls in the Default Agent tab', async () => {
    render(<PlatformSettingsTab isAdmin />);

    await screen.findByRole('combobox');
    expect(screen.queryByText('Release notes')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Active release version')).not.toBeInTheDocument();
  });

  it('renders the public-access banner above the default-agent picker', async () => {
    render(<PlatformSettingsTab isAdmin />);

    await screen.findByRole('combobox');
    expect(screen.getByTestId('default-agent-public-banner')).toHaveTextContent(
      /becomes available to every signed-in user/i,
    );
  });

  it('opens the public-access confirmation modal when selecting a new default', async () => {
    render(<PlatformSettingsTab isAdmin />);

    const select = await screen.findByRole('combobox');
    fireEvent.change(select, { target: { value: 'sre' } });
    fireEvent.click(screen.getByTestId('default-agent-save'));

    expect(
      await screen.findByText(/Make.*Basic SRE.*the platform default/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Every signed-in user will be able to chat with this agent/i),
    ).toBeInTheDocument();
    // No PATCH yet — the admin still has to confirm.
    expect(global.fetch).not.toHaveBeenCalledWith(
      '/api/admin/platform-config',
      expect.objectContaining({ method: 'PATCH' }),
    );
  });

  it('does not send PATCH when the public-access modal is cancelled', async () => {
    render(<PlatformSettingsTab isAdmin />);

    const select = await screen.findByRole('combobox');
    fireEvent.change(select, { target: { value: 'sre' } });
    fireEvent.click(screen.getByTestId('default-agent-save'));

    fireEvent.click(await screen.findByRole('button', { name: /cancel/i }));

    await waitFor(() => {
      expect(screen.queryByText(/Make.*Basic SRE.*the platform default/i)).not.toBeInTheDocument();
    });
    expect(global.fetch).not.toHaveBeenCalledWith(
      '/api/admin/platform-config',
      expect.objectContaining({ method: 'PATCH' }),
    );
  });

  it('includes acknowledge_public_access in the PATCH after confirmation', async () => {
    render(<PlatformSettingsTab isAdmin />);

    const select = await screen.findByRole('combobox');
    fireEvent.change(select, { target: { value: 'sre' } });
    fireEvent.click(screen.getByTestId('default-agent-save'));

    const confirmButton = await screen.findByRole('button', { name: /make it the default/i });
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/admin/platform-config',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({
            default_agent_id: 'sre',
            acknowledge_public_access: true,
          }),
        }),
      );
    });
    expect(await screen.findByText('Saved')).toBeInTheDocument();
  });
});
