/**
 * @jest-environment jsdom
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ReleaseNotesSettingsTab } from '../ReleaseNotesSettingsTab';

function mockFetch({
  config = {
    success: true,
    data: {
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
  config?: { success: boolean; data?: { release_notes?: any } };
  patch?: { success: boolean };
} = {}) {
  global.fetch = jest.fn((url: RequestInfo | URL, init?: RequestInit) => {
    const href = String(url);
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

describe('ReleaseNotesSettingsTab', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch();
  });

  it('renders release notes notification controls from platform config', async () => {
    render(<ReleaseNotesSettingsTab isAdmin />);

    expect(await screen.findByText('Release notes')).toBeInTheDocument();
    expect(screen.getByLabelText('Active release version')).toHaveValue('0.5.1');
    expect(screen.getByLabelText('Show toast reminder')).toBeChecked();
    expect(screen.getByLabelText('Toast duration')).toHaveValue(8000);
    expect(screen.getByRole('button', { name: 'Show preview' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show this on next login for every user' })).toBeInTheDocument();
  });

  it('saves release notes notification settings without changing the default agent', async () => {
    render(<ReleaseNotesSettingsTab isAdmin />);

    fireEvent.change(await screen.findByLabelText('Active release version'), {
      target: { value: '0.6.0' },
    });
    fireEvent.change(screen.getByLabelText('Toast duration'), {
      target: { value: '12000' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply release notes settings' }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/admin/platform-config',
        expect.objectContaining({
          method: 'PATCH',
        })
      );
    });
    const patchCall = (global.fetch as jest.Mock).mock.calls.find(
      ([url, init]) => url === '/api/admin/platform-config' && init?.method === 'PATCH',
    );
    expect(JSON.parse(patchCall[1].body)).toEqual({
      release_notes: expect.objectContaining({
        enabled: true,
        release_version: '0.6.0',
        announcement_revision: 2,
        show_toast: true,
        toast_duration_ms: 12000,
        show_migration_cta: true,
      }),
    });
    expect(JSON.parse(patchCall[1].body)).not.toHaveProperty('default_agent_id');
  });

  it('increments announcement revision to show release notes on next login for every user', async () => {
    render(<ReleaseNotesSettingsTab isAdmin />);

    fireEvent.click(await screen.findByRole('button', { name: 'Show this on next login for every user' }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/admin/platform-config',
        expect.objectContaining({
          method: 'PATCH',
        })
      );
    });
    const patchCall = (global.fetch as jest.Mock).mock.calls.find(
      ([url, init]) => url === '/api/admin/platform-config' && init?.method === 'PATCH',
    );
    expect(JSON.parse(patchCall[1].body)).toEqual({
      release_notes: expect.objectContaining({
        announcement_revision: 3,
        announcement_id: '0.5.1:revision-3',
      }),
    });
  });

  it('opens a release notes preview without saving dismissal state', async () => {
    render(<ReleaseNotesSettingsTab isAdmin />);

    fireEvent.click(await screen.findByRole('button', { name: 'Show preview' }));

    expect(screen.getByText("What's new in 0.5.1")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Migration Assistant' })).toBeInTheDocument();
  });
});
