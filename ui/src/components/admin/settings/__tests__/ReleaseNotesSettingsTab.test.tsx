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
  config?: { success: boolean; data?: { release_notes?: unknown } };
  settings?: { success: boolean; data?: { preferences?: unknown } };
  patch?: { success: boolean };
  preferencesPatch?: { success: boolean };
} = {}) {
  global.fetch = jest.fn((url: RequestInfo | URL, init?: RequestInit) => {
    const href = String(url);
    if (href.includes('/api/settings/preferences') && init?.method === 'PATCH') {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(preferencesPatch),
      } as Response);
    }
    if (href.includes('/api/settings')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(settings),
      } as Response);
    }
    if (href.includes('/api/admin/platform-config') && init?.method === 'PATCH') {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(patch),
      } as Response);
    }
    if (href.includes('/api/admin/platform-config')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(config),
      } as Response);
    }
    if (href.includes('/api/version')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ version: '0.5.1', packageVersion: '0.5.1' }),
      } as Response);
    }
    if (href.includes('/api/changelog')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ releases: [] }),
      } as Response);
    }
    if (href.includes('/api/release-notes')) {
      return Promise.resolve({
        ok: false,
        json: () => Promise.resolve({}),
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

  it('lets every user re-open the release notes popup on demand', async () => {
    render(<ReleaseNotesSettingsTab isAdmin={false} />);

    fireEvent.click(await screen.findByRole('button', { name: /Show release notes popup/i }));

    expect(await screen.findByText("What's new in 0.5.1")).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open Migration Assistant' })).not.toBeInTheDocument();
  });

  // ── Admin-only platform configuration ─────────────────────────────────────
  it('does NOT render the admin section for non-admins', async () => {
    render(<ReleaseNotesSettingsTab isAdmin={false} />);

    await screen.findByTestId('release-notes-user-pref-toggle');
    expect(screen.queryByText('Admin')).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText('Enable release notes notification'),
    ).not.toBeInTheDocument();
  });

  it('renders the admin platform toggle under an Admin header for admins', async () => {
    render(<ReleaseNotesSettingsTab isAdmin />);

    expect(await screen.findByText('Admin')).toBeInTheDocument();
    expect(await screen.findByLabelText('Enable release notes notification')).toBeChecked();
    // No separate configuration card any more — admin lives in the same card.
    expect(screen.queryByText('Release notes configuration')).not.toBeInTheDocument();
  });

  it('saves the enabled flag with an empty optional compare range without changing the default agent', async () => {
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
      release_notes: {
        enabled: false,
        repository_url: null,
        previous_commit: null,
        latest_commit: null,
      },
    });
    expect(JSON.parse(patchCall[1].body)).not.toHaveProperty('default_agent_id');
  });

  it('lets admins configure the GitHub commit range used for release notes', async () => {
    render(<ReleaseNotesSettingsTab isAdmin />);

    fireEvent.change(await screen.findByLabelText('Repository URL'), {
      target: { value: 'https://github.com/example/repository' },
    });
    fireEvent.change(screen.getByLabelText('Previous upgraded commit'), {
      target: { value: '1111111' },
    });
    fireEvent.change(screen.getByLabelText('Latest commit'), {
      target: { value: '2222222' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save release notes settings' }));

    await waitFor(() => {
      const patchCall = (global.fetch as jest.Mock).mock.calls.find(
        ([url, init]) => url === '/api/admin/platform-config' && init?.method === 'PATCH',
      );
      expect(JSON.parse(patchCall[1].body)).toEqual({
        release_notes: {
          enabled: true,
          repository_url: 'https://github.com/example/repository',
          previous_commit: '1111111',
          latest_commit: '2222222',
        },
      });
    });
  });

  it('requires all optional commit-diff fields before saving', async () => {
    render(<ReleaseNotesSettingsTab isAdmin />);

    fireEvent.change(await screen.findByLabelText('Previous upgraded commit'), {
      target: { value: '1111111' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save release notes settings' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Set the repository URL and both commits',
    );
    expect(global.fetch).not.toHaveBeenCalledWith(
      '/api/admin/platform-config',
      expect.objectContaining({ method: 'PATCH' }),
    );
  });
});
