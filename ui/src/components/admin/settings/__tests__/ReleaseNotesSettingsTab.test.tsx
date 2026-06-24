/**
 * @jest-environment jsdom
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ReleaseNotesSettingsTab } from '../ReleaseNotesSettingsTab';

jest.mock('remark-gfm', () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock('react-markdown', () => ({
  __esModule: true,
  default: ({ children }: { children: unknown }) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const React = require('react');
    return React.createElement('div', null, children);
  },
}));

function mockFetch({
  config = {
    success: true,
    data: {
      release_notes: {
        enabled: true,
      },
    },
  },
  settings = {
    success: true,
    data: { preferences: { releaseNotesNotificationsEnabled: true } },
  },
  patch = { success: true },
  preferencesPatch = { success: true },
}: {
  config?: { success: boolean; data?: { release_notes?: any } };
  settings?: { success: boolean; data?: { preferences?: any } };
  patch?: { success: boolean };
  preferencesPatch?: { success: boolean };
} = {}) {
  global.fetch = jest.fn((url: RequestInfo | URL, init?: RequestInit) => {
    const href = String(url);
    if (href.includes('/api/settings/preferences') && init?.method === 'PATCH') {
      return Promise.resolve({
        json: () => Promise.resolve(preferencesPatch),
      } as Response);
    }
    if (href.includes('/api/settings')) {
      return Promise.resolve({
        json: () => Promise.resolve(settings),
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

describe('ReleaseNotesSettingsTab', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch();
  });

  // ── Per-user preference (visible to everyone) ─────────────────────────────
  it('renders the per-user release notes preference toggle for non-admins', async () => {
    render(<ReleaseNotesSettingsTab isAdmin={false} />);

    expect(await screen.findByTestId('release-notes-user-pref-toggle')).toBeChecked();
    expect(screen.getByText(/Notify me about release notes/i)).toBeInTheDocument();
  });

  it('reflects an opted-out user preference', async () => {
    mockFetch({
      settings: { success: true, data: { preferences: { releaseNotesNotificationsEnabled: false } } },
    });

    render(<ReleaseNotesSettingsTab isAdmin={false} />);

    expect(await screen.findByTestId('release-notes-user-pref-toggle')).not.toBeChecked();
  });

  it('saves the per-user preference to /api/settings/preferences only', async () => {
    render(<ReleaseNotesSettingsTab isAdmin={false} />);

    fireEvent.click(await screen.findByTestId('release-notes-user-pref-toggle'));
    fireEvent.click(screen.getByRole('button', { name: 'Save release notes preference' }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/settings/preferences',
        expect.objectContaining({ method: 'PATCH' }),
      );
    });
    const patchCall = (global.fetch as jest.Mock).mock.calls.find(
      ([url, init]) => String(url).includes('/api/settings/preferences') && init?.method === 'PATCH',
    );
    expect(JSON.parse(patchCall[1].body)).toEqual({ releaseNotesNotificationsEnabled: false });
    // Non-admins never PATCH the platform-wide admin config.
    expect(global.fetch).not.toHaveBeenCalledWith(
      '/api/admin/platform-config',
      expect.objectContaining({ method: 'PATCH' }),
    );
  });

  // ── Admin-only platform configuration ─────────────────────────────────────
  it('does NOT render the admin platform configuration for non-admins', async () => {
    render(<ReleaseNotesSettingsTab isAdmin={false} />);

    await screen.findByTestId('release-notes-user-pref-toggle');
    expect(screen.queryByText('Release notes configuration')).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText('Enable release notes notification'),
    ).not.toBeInTheDocument();
  });

  it('renders admin platform configuration controls for admins', async () => {
    render(<ReleaseNotesSettingsTab isAdmin />);

    expect(await screen.findByText('Release notes configuration')).toBeInTheDocument();
    expect(screen.getByLabelText('Enable release notes notification')).toBeChecked();
    expect(screen.getByRole('button', { name: 'Show preview' })).toBeInTheDocument();
    // Removed controls: version/revision/toast/CTA/next-login are gone.
    expect(screen.queryByLabelText('Active release version')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Show toast reminder')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Show this on next login for every user' }),
    ).not.toBeInTheDocument();
  });

  it('saves only the enabled flag without changing the default agent', async () => {
    render(<ReleaseNotesSettingsTab isAdmin />);

    fireEvent.click(await screen.findByLabelText('Enable release notes notification'));
    fireEvent.click(screen.getByRole('button', { name: 'Save release notes settings' }));

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
      release_notes: { enabled: false },
    });
    expect(JSON.parse(patchCall[1].body)).not.toHaveProperty('default_agent_id');
  });

  it('opens a release notes preview without saving dismissal state', async () => {
    render(<ReleaseNotesSettingsTab isAdmin />);

    fireEvent.click(await screen.findByRole('button', { name: 'Show preview' }));

    expect(screen.getByText("What's new in current release")).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open Migration Assistant' })).not.toBeInTheDocument();
  });
});
