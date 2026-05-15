/**
 * @jest-environment jsdom
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { PlatformSettingsTab } from '../PlatformSettingsTab';

describe('PlatformSettingsTab', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn((url: RequestInfo | URL) => {
      const href = String(url);
      if (href.includes('/api/dynamic-agents/available')) {
        return Promise.resolve({
          json: () => Promise.resolve({ data: [{ _id: 'sre', name: 'Basic SRE' }] }),
        } as Response);
      }
      if (href.includes('/api/admin/platform-config')) {
        return Promise.resolve({
          json: () => Promise.resolve({ success: true, data: { default_agent_id: null } }),
        } as Response);
      }
      return Promise.reject(new Error(`Unexpected fetch: ${href}`));
    });
  });

  it('labels the supervisor option as Default CAIPE Supervisor', async () => {
    render(<PlatformSettingsTab isAdmin />);

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Default CAIPE Supervisor' })).toBeInTheDocument();
    });
  });
});
