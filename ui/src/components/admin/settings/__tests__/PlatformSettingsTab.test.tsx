/**
 * @jest-environment jsdom
 */

// assisted-by Codex Codex-sonnet-4-6

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
  preferences = {
    web_default_agent_id: null,
    slack_default_agent_id: null,
    webex_default_agent_id: null,
    integrations: { slack: false, webex: false },
  },
}: {
  agents?: Array<{ _id: string; name: string; description?: string }>;
  config?: { success: boolean; data?: { default_agent_id?: string | null; source?: string; release_notes?: unknown } };
  patch?: { success: boolean };
  preferences?: {
    platform_default_agent_id?: string | null;
    web_default_agent_id?: string | null;
    slack_default_agent_id?: string | null;
    webex_default_agent_id?: string | null;
    integrations?: { slack?: boolean; webex?: boolean };
  };
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
        ok: true,
        json: () => Promise.resolve(config),
      } as Response);
    }
    // Endpoints used by the personal default-agent pickers.
    if (href.includes('/api/user/accessible-agents')) {
      const accessible = agents.map((a) => ({
        id: a._id,
        name: a.name,
        description: a.description ?? '',
      }));
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            success: true,
            data: { agents: accessible, total: accessible.length, page: 1, page_size: 100 },
          }),
      } as Response);
    }
    if (href.includes('/api/user/preferences')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: {
            platform_default_agent_id: config.data?.default_agent_id ?? null,
            ...preferences,
          },
        }),
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

  it('labels the empty default option as No default agent', async () => {
    render(<PlatformSettingsTab isAdmin />);

    fireEvent.click(await screen.findByRole('button', {
      name: /Platform default agent for new chats/i,
    }));
    expect(
      await screen.findByRole('option', { name: 'No default agent' }),
    ).toBeInTheDocument();
  });

  it('selects the configured default dynamic agent and shows its description', async () => {
    mockFetch({ config: { success: true, data: { default_agent_id: 'sre' } } });

    render(<PlatformSettingsTab isAdmin />);

    const picker = await screen.findByRole('button', {
      name: /Platform default agent for new chats/i,
    });
    expect(picker).toHaveTextContent('Basic SRE');
    expect(
      screen.getAllByText('Agent Description: Handles SRE workflows'),
    ).toHaveLength(2);
    expect(screen.getByTestId('default-agent-save')).toBeDisabled();
    expect(screen.getByTestId('personal-default-agents-save')).toBeDisabled();
  });

  it('shows the personal Default Agent picker for non-admins (no platform controls)', async () => {
    render(<PlatformSettingsTab isAdmin={false} />);

    // Non-admins get the personal web-default picker, not the
    // platform-default picker or its save button.
    const personal = await screen.findByRole('button', { name: /^Web default agent$/i });
    expect(personal).toBeInTheDocument();
    fireEvent.click(personal);
    expect(
      await screen.findByRole('option', { name: /Use platform default/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Platform default agent for new chats/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('personal-default-agents-save')).toBeInTheDocument();
    expect(screen.queryByTestId('default-agent-save')).not.toBeInTheDocument();
    expect(screen.queryByTestId('default-agent-access-note')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Slack default agent$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Webex default agent$/i })).not.toBeInTheDocument();
  });

  it('shows the platform fallback for every active integration', async () => {
    mockFetch({
      config: { success: true, data: { default_agent_id: 'sre' } },
      preferences: {
        web_default_agent_id: null,
        slack_default_agent_id: null,
        webex_default_agent_id: null,
        integrations: { slack: true, webex: true },
      },
    });

    render(<PlatformSettingsTab isAdmin={false} />);

    const slack = await screen.findByRole('button', { name: /^Slack default agent$/i });
    const webex = screen.getByRole('button', { name: /^Webex default agent$/i });
    expect(slack).toHaveTextContent('Use platform default (Basic SRE)');
    expect(webex).toHaveTextContent('Use platform default (Basic SRE)');
  });

  it('saves changed Slack and Webex defaults in one request', async () => {
    mockFetch({
      preferences: {
        web_default_agent_id: 'sre',
        slack_default_agent_id: null,
        webex_default_agent_id: null,
        integrations: { slack: true, webex: true },
      },
    });

    render(<PlatformSettingsTab isAdmin={false} />);

    const slack = await screen.findByRole('button', { name: /^Slack default agent$/i });
    fireEvent.click(slack);
    fireEvent.click(await screen.findByRole('option', { name: 'Knowledge Base Agent' }));

    const webex = screen.getByRole('button', { name: /^Webex default agent$/i });
    fireEvent.click(webex);
    fireEvent.click(await screen.findByRole('option', { name: 'Knowledge Base Agent' }));
    fireEvent.click(screen.getByTestId('personal-default-agents-save'));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/user/preferences',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({
            slack_default_agent_id: 'kb',
            webex_default_agent_id: 'kb',
          }),
        }),
      );
    });
  });

  it('clears a Slack override back to the platform default', async () => {
    mockFetch({
      preferences: {
        web_default_agent_id: 'sre',
        slack_default_agent_id: 'kb',
        webex_default_agent_id: null,
        integrations: { slack: true, webex: false },
      },
    });

    render(<PlatformSettingsTab isAdmin={false} />);

    const slack = await screen.findByRole('button', { name: /^Slack default agent$/i });
    fireEvent.click(slack);
    fireEvent.click(
      await screen.findByRole('option', { name: 'Use platform default' }),
    );
    fireEvent.click(screen.getByTestId('personal-default-agents-save'));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/user/preferences',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ slack_default_agent_id: null }),
        }),
      );
    });
  });

  it('persists the non-admin personal web default via /api/user/preferences', async () => {
    render(<PlatformSettingsTab isAdmin={false} />);

    const personal = await screen.findByRole('button', { name: /^Web default agent$/i });
    fireEvent.click(personal);
    fireEvent.click(await screen.findByRole('option', { name: 'Basic SRE' }));

    expect(global.fetch).not.toHaveBeenCalledWith(
      '/api/user/preferences',
      expect.objectContaining({ method: 'PUT' }),
    );
    fireEvent.click(screen.getByTestId('personal-default-agents-save'));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/user/preferences',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ web_default_agent_id: 'sre' }),
        }),
      );
    });
  });

  it('shows the resolved platform default and clears a personal override back to it', async () => {
    mockFetch({ config: { success: true, data: { default_agent_id: 'sre' } } });

    render(<PlatformSettingsTab isAdmin={false} />);

    const personal = await screen.findByRole('button', { name: /^Web default agent$/i });
    await waitFor(() => {
      expect(personal).toHaveTextContent('Use platform default (Basic SRE)');
    });
    expect(
      screen.getByText('Agent Description: Handles SRE workflows'),
    ).toBeInTheDocument();

    fireEvent.click(personal);
    fireEvent.click(await screen.findByRole('option', { name: 'Basic SRE' }));
    fireEvent.click(screen.getByTestId('personal-default-agents-save'));
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/user/preferences',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ web_default_agent_id: 'sre' }),
        }),
      );
    });
    await waitFor(() => expect(screen.getByTestId('personal-default-agents-save')).toBeDisabled());

    fireEvent.click(screen.getByLabelText('Clear agent selection'));
    fireEvent.click(screen.getByTestId('personal-default-agents-save'));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/user/preferences',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ web_default_agent_id: null }),
        }),
      );
    });
    expect(personal).toHaveTextContent('Use platform default (Basic SRE)');
    expect(screen.queryByLabelText('Clear agent selection')).not.toBeInTheDocument();
  });

  it('suppresses writes in the non-admin picker when readOnly (preview)', async () => {
    render(<PlatformSettingsTab isAdmin={false} readOnly />);

    const personal = await screen.findByRole('button', { name: /^Web default agent$/i });
    expect(personal).toBeDisabled();
    expect(screen.getByTestId('personal-default-agents-save')).toBeDisabled();
  });

  it('warns when the saved default agent is not in the viewer accessible list (admin variant)', async () => {
    mockFetch({ config: { success: true, data: { default_agent_id: 'deleted-agent' } } });

    render(<PlatformSettingsTab isAdmin />);

    const banner = await screen.findByTestId('default-agent-missing-banner');
    expect(banner).toHaveTextContent(/platform default agent/i);
    expect(banner).toHaveTextContent(/deleted-agent/);
    expect(banner).toHaveTextContent(/deleted, disabled, or you don.?t have permission/i);
    // Admins don't get the "read-only" hint.
    expect(banner).not.toHaveTextContent(/read-only mode/i);
  });

  it('hides platform-default warnings and controls from non-admins', async () => {
    mockFetch({ config: { success: true, data: { default_agent_id: 'hello-world' } } });

    render(<PlatformSettingsTab isAdmin={false} />);

    expect(screen.queryByTestId('default-agent-missing-banner')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Platform default agent for new chats/i }),
    ).not.toBeInTheDocument();
    expect(
      await screen.findByRole('button', { name: /^Web default agent$/i }),
    ).toBeInTheDocument();
  });

  it('injects a synthetic picker option for a configured agent outside the accessible list', async () => {
    mockFetch({ config: { success: true, data: { default_agent_id: 'hello-world' } } });

    render(<PlatformSettingsTab isAdmin />);

    const picker = await screen.findByRole('button', {
      name: /Platform default agent for new chats/i,
    });
    expect(picker).toHaveTextContent(/hello-world.*not visible to you/i);
    fireEvent.click(picker);
    expect(
      await screen.findByRole('option', { name: /hello-world.*not visible to you/i }),
    ).toBeInTheDocument();
  });

  it('sequences /api/dynamic-agents/available BEFORE /api/admin/platform-config so the user:* OpenFGA grant is reconciled before the default is read', async () => {
    const calls: string[] = [];
    const agents = [{ _id: 'sre', name: 'Basic SRE' }];
    global.fetch = jest.fn((url: RequestInfo | URL) => {
      const href = String(url);
      calls.push(href);
      if (href.includes('/api/dynamic-agents/available')) {
        return Promise.resolve({ json: () => Promise.resolve({ data: agents }) } as Response);
      }
      if (href.includes('/api/admin/platform-config')) {
        return Promise.resolve({
          json: () =>
            Promise.resolve({ success: true, data: { default_agent_id: 'sre' } }),
        } as Response);
      }
      // The embedded personal defaults panel also hits these.
      if (href.includes('/api/user/accessible-agents')) {
        return Promise.resolve({
          json: () =>
            Promise.resolve({
              success: true,
              data: { agents: [], total: 0, page: 1, page_size: 100 },
            }),
        } as Response);
      }
      if (href.includes('/api/user/preferences')) {
        return Promise.resolve({
          json: () => Promise.resolve({ success: true, data: { web_default_agent_id: null } }),
        } as Response);
      }
      return Promise.reject(new Error(`Unexpected fetch: ${href}`));
    });

    render(<PlatformSettingsTab isAdmin />);

    await screen.findByRole('button', { name: /Platform default agent for new chats/i });

    // The tab reads the platform default AFTER auto-granting via `available`.
    // The personal picker also reads platform-config independently, so assert
    // the tab's guarantee: a config read happens after the available call.
    const availableIdx = calls.findIndex((c) => c.includes('/api/dynamic-agents/available'));
    const configAfterAvailable = calls.findIndex(
      (c, i) => i > availableIdx && c.includes('/api/admin/platform-config'),
    );
    expect(availableIdx).toBeGreaterThan(-1);
    expect(configAfterAvailable).toBeGreaterThan(availableIdx);
  });

  it('shows when the default came from the DEFAULT_AGENT_ID environment value', async () => {
    mockFetch({ config: { success: true, data: { default_agent_id: 'sre', source: 'env' } } });

    render(<PlatformSettingsTab isAdmin />);

    await waitFor(() => {
      expect(screen.getByText(/using the deployment default/i)).toBeInTheDocument();
      expect(screen.getAllByText('DEFAULT_AGENT_ID')).toHaveLength(1);
    });
  });

  it('saves a null default_agent_id after clear confirmation', async () => {
    mockFetch({ config: { success: true, data: { default_agent_id: 'sre' } } });

    render(<PlatformSettingsTab isAdmin />);

    const picker = await screen.findByRole('button', {
      name: /Platform default agent for new chats/i,
    });
    fireEvent.click(picker);
    fireEvent.click(await screen.findByRole('option', { name: 'No default agent' }));
    fireEvent.click(screen.getByTestId('default-agent-save'));

    // Lighter "Remove default" confirmation appears first.
    const removeDefaultButton = await screen.findByRole('button', { name: /remove default/i });
    expect(screen.getByText(/no longer open with a default agent/i)).toBeInTheDocument();
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

    await screen.findByRole('button', { name: /Platform default agent for new chats/i });
    expect(screen.queryByText('Release notes')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Active release version')).not.toBeInTheDocument();
  });

  it('renders a neutral all-users access note above the platform picker', async () => {
    render(<PlatformSettingsTab isAdmin />);

    await screen.findByRole('button', { name: /Platform default agent for new chats/i });
    expect(screen.getByTestId('default-agent-access-note')).toHaveTextContent(
      /available to every signed-in user, regardless of agent sharing permissions/i,
    );
  });

  // ── [TS-S3] Unlinked Access card visibility ────────────────────────────────
  it('admin sees the Unlinked Access card and Manage button', async () => {
    render(<PlatformSettingsTab isAdmin />);

    // Wait for the component to finish loading.
    await screen.findByRole('button', { name: /Platform default agent for new chats/i });

    const btn = screen.getByTestId("unlinked-access-button")
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveTextContent(/manage unlinked access/i);
  });

  it('non-admin does NOT see the Unlinked Access card or button', async () => {
    render(<PlatformSettingsTab isAdmin={false} />);

    await screen.findByRole('button', { name: /^Web default agent$/i });

    expect(screen.queryByTestId("unlinked-access-button")).toBeNull();
  });

  it('opens the public-access confirmation modal when selecting a new default', async () => {
    render(<PlatformSettingsTab isAdmin />);

    const picker = await screen.findByRole('button', {
      name: /Platform default agent for new chats/i,
    });
    fireEvent.click(picker);
    fireEvent.click(await screen.findByRole('option', { name: 'Basic SRE' }));
    fireEvent.click(screen.getByTestId('default-agent-save'));

    expect(
      await screen.findByText(/Make.*Basic SRE.*the platform default/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Everyone who signs in will be able to use this agent/i),
    ).toBeInTheDocument();
    // No PATCH yet — the admin still has to confirm.
    expect(global.fetch).not.toHaveBeenCalledWith(
      '/api/admin/platform-config',
      expect.objectContaining({ method: 'PATCH' }),
    );
  });

  it('does not send PATCH when the public-access modal is cancelled', async () => {
    render(<PlatformSettingsTab isAdmin />);

    const picker = await screen.findByRole('button', {
      name: /Platform default agent for new chats/i,
    });
    fireEvent.click(picker);
    fireEvent.click(await screen.findByRole('option', { name: 'Basic SRE' }));
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

    const picker = await screen.findByRole('button', {
      name: /Platform default agent for new chats/i,
    });
    fireEvent.click(picker);
    fireEvent.click(await screen.findByRole('option', { name: 'Basic SRE' }));
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
