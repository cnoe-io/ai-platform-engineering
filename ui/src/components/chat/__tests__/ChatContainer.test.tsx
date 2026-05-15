/**
 * @jest-environment jsdom
 */
/**
 * ChatContainer audit-mode gate tests (Inv-C, Inv-C2).
 *
 * The audit banner gate lives in ChatContainer.tsx (NOT ChatPanel). It
 * derives `readOnlyReason` from a combination of the server-side
 * `access_level` and the URL `?from=` query parameter. These tests
 * exercise the gate by mocking `useSearchParams`, `useSession`,
 * `useParams`, and the `apiClient.getConversation` API roundtrip path
 * (the deep-link refresh path where the server returns `admin_audit`).
 *
 * Heavy view children (SupervisorChatView, ChatView) are stubbed and
 * record the props they receive so each test can assert on the
 * `readOnly` / `readOnlyReason` props the gate produced.
 */

import React from 'react';
import { render, waitFor } from '@testing-library/react';

// ============================================================================
// Mocks — must be before the import of ChatContainer
// ============================================================================

const TEST_UUID = '11111111-1111-4111-8111-111111111111';

// Per-test overrides for next-auth and next/navigation hooks.
let mockSessionData: any = {
  data: { user: { name: 'admin', email: 'admin@example.com' } },
  status: 'authenticated',
};
let mockSearchParamsValue: URLSearchParams = new URLSearchParams();
let mockUuid: string | undefined = TEST_UUID;

jest.mock('next-auth/react', () => ({
  useSession: () => mockSessionData,
}));

jest.mock('next/navigation', () => ({
  useParams: () => ({ uuid: mockUuid }),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => mockSearchParamsValue,
}));

jest.mock('@/lib/config', () => ({
  getConfig: (key: string) => {
    const configs: Record<string, unknown> = {
      caipeUrl: 'http://localhost:8000',
      dynamicAgentsUrl: 'http://localhost:8001',
      // dynamicAgentsEnabled false routes through SupervisorChatView,
      // which keeps the test scope to the Supervisor branch (sufficient
      // — the gate logic is identical for both branches).
      dynamicAgentsEnabled: false,
    };
    return configs[key];
  },
}));

jest.mock('@/lib/storage-config', () => ({
  getStorageMode: () => 'mongodb',
  shouldUseLocalStorage: () => false,
}));

const mockGetConversation = jest.fn();

jest.mock('@/lib/api-client', () => ({
  apiClient: {
    getConversation: (...args: unknown[]) => mockGetConversation(...args),
    getMessages: jest.fn().mockResolvedValue({ items: [], total: 0 }),
  },
}));

// Capture props received by SupervisorChatView so each test can assert
// on the gate's output (`readOnly` and `readOnlyReason`).
const capturedSupervisorProps: Array<Record<string, unknown>> = [];
jest.mock('@/components/chat/PlatformEngineerChatView', () => ({
  SupervisorChatView: (props: Record<string, unknown>) => {
    capturedSupervisorProps.push(props);
    return <div data-testid="supervisor-view" />;
  },
}));
jest.mock('@/components/chat/DynamicAgentChatView', () => ({
  ChatView: () => <div data-testid="dynamic-agent-view" />,
}));
jest.mock('@/components/ui/caipe-spinner', () => ({
  CAIPESpinner: () => <div data-testid="spinner" />,
}));

// Chat store stub: empty `conversations` so the API-roundtrip path runs
// (the local-store-hit path skips API and cannot produce admin_audit by
// design — see data-model.md "Where the gate runs").
const mockLoadMessagesFromServer = jest.fn().mockResolvedValue(undefined);
const mockLoadTurnsFromServer = jest.fn().mockResolvedValue(undefined);
const mockSetActiveConversation = jest.fn();

jest.mock('@/store/chat-store', () => {
  const state = {
    conversations: [],
    setActiveConversation: mockSetActiveConversation,
    loadMessagesFromServer: mockLoadMessagesFromServer,
    loadTurnsFromServer: mockLoadTurnsFromServer,
  };
  const useChatStore = ((selector?: (s: typeof state) => unknown) => {
    if (selector) return selector(state);
    return state;
  }) as unknown as {
    (): typeof state;
    (selector: (s: typeof state) => unknown): unknown;
    getState(): typeof state;
    setState: jest.Mock;
  };
  useChatStore.getState = () => state;
  useChatStore.setState = jest.fn();
  return { useChatStore };
});

jest.spyOn(console, 'log').mockImplementation(() => {});
jest.spyOn(console, 'warn').mockImplementation(() => {});
jest.spyOn(console, 'error').mockImplementation(() => {});

import { ChatContainer } from '../ChatContainer';

beforeEach(() => {
  capturedSupervisorProps.length = 0;
  mockGetConversation.mockReset();
  mockLoadMessagesFromServer.mockClear();
  mockLoadTurnsFromServer.mockClear();
  mockSetActiveConversation.mockClear();
  mockSessionData = {
    data: { user: { name: 'admin', email: 'admin@example.com' } },
    status: 'authenticated',
  };
  mockSearchParamsValue = new URLSearchParams();
  mockUuid = TEST_UUID;
});

function makeServerConv(overrides: Record<string, unknown> = {}) {
  return {
    _id: TEST_UUID,
    title: 'Test',
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
    participants: [],
    ...overrides,
  };
}

async function lastSupervisorProps() {
  await waitFor(() => {
    expect(capturedSupervisorProps.length).toBeGreaterThan(0);
  });
  // ChatContainer re-renders during the API roundtrip; we want the
  // props after access_level has been set. Use waitFor to converge on
  // the final readOnlyReason.
  return capturedSupervisorProps[capturedSupervisorProps.length - 1];
}

describe('ChatContainer — audit-banner gate (Inv-C, Inv-C2)', () => {
  it('does NOT render audit banner when access_level is admin_audit but adminOrigin is null', async () => {
    mockSearchParamsValue = new URLSearchParams(); // no ?from=
    mockGetConversation.mockResolvedValue(
      makeServerConv({ access_level: 'admin_audit', owner_id: 'other@example.com' }),
    );

    render(<ChatContainer />);

    await waitFor(() => {
      const props = capturedSupervisorProps[capturedSupervisorProps.length - 1];
      expect(props?.readOnlyReason).toBe('shared_readonly');
    });
    const props = await lastSupervisorProps();
    // Inv-C: gate fails (no recognized ?from=) so audit banner MUST NOT render.
    expect(props.readOnlyReason).not.toBe('admin_audit');
    // Inv-C2 option A: route through the existing shared_readonly UI branch.
    expect(props.readOnlyReason).toBe('shared_readonly');
    expect(props.readOnly).toBe(true);
  });

  it('does NOT render audit banner when user owns the conversation even if adminOrigin is set (audit-context leak guard)', async () => {
    mockSearchParamsValue = new URLSearchParams('from=audit-logs');
    // Owner case — server returns access_level === 'owner' for the admin
    // because they own this conversation (cross-conversation URL carry-over
    // scenario where the URL still says ?from=audit-logs from a prior page).
    mockGetConversation.mockResolvedValue(
      makeServerConv({
        access_level: 'owner',
        owner_id: 'admin@example.com',
      }),
    );

    render(<ChatContainer />);

    // Wait for the access_level to be applied by the API roundtrip.
    await waitFor(() => {
      const props = capturedSupervisorProps[capturedSupervisorProps.length - 1];
      // owner case — readOnly should be false (no banner, no fallback).
      expect(props?.readOnly).toBe(false);
    });
    const props = await lastSupervisorProps();
    expect(props.readOnly).toBe(false);
    expect(props.readOnlyReason).toBeUndefined();
  });

  it('renders audit banner for a different non-owned conversation when ?from=audit-logs is carried over (Inv-C cross-conversation)', async () => {
    mockSearchParamsValue = new URLSearchParams('from=audit-logs');
    mockGetConversation.mockResolvedValue(
      makeServerConv({
        access_level: 'admin_audit',
        owner_id: 'other@example.com',
      }),
    );

    render(<ChatContainer />);

    await waitFor(() => {
      const props = capturedSupervisorProps[capturedSupervisorProps.length - 1];
      expect(props?.readOnlyReason).toBe('admin_audit');
    });
    const props = await lastSupervisorProps();
    expect(props.readOnlyReason).toBe('admin_audit');
    expect(props.readOnly).toBe(true);
    expect(props.adminOrigin).toBe('audit-logs');
  });

  describe('Inv-C2 — shared_readonly fallback for admin without recognized origin', () => {
    it('admin + admin_audit + no ?from= routes through shared_readonly UI branch (no silent write-fail)', async () => {
      mockSearchParamsValue = new URLSearchParams();
      mockGetConversation.mockResolvedValue(
        makeServerConv({
          access_level: 'admin_audit',
          owner_id: 'other@example.com',
        }),
      );

      render(<ChatContainer />);

      await waitFor(() => {
        const props = capturedSupervisorProps[capturedSupervisorProps.length - 1];
        expect(props?.readOnlyReason).toBe('shared_readonly');
      });
      const props = await lastSupervisorProps();
      expect(props.readOnlyReason).toBe('shared_readonly');
      expect(props.readOnly).toBe(true);
    });

    it('admin + admin_audit + unrecognized ?from= routes through shared_readonly UI branch', async () => {
      mockSearchParamsValue = new URLSearchParams('from=shared-link');
      mockGetConversation.mockResolvedValue(
        makeServerConv({
          access_level: 'admin_audit',
          owner_id: 'other@example.com',
        }),
      );

      render(<ChatContainer />);

      await waitFor(() => {
        const props = capturedSupervisorProps[capturedSupervisorProps.length - 1];
        expect(props?.readOnlyReason).toBe('shared_readonly');
      });
      const props = await lastSupervisorProps();
      expect(props.readOnlyReason).toBe('shared_readonly');
      // Closed honoured set is {audit-logs, feedback}; anything else
      // is treated as absent.
      expect(props.readOnlyReason).not.toBe('admin_audit');
    });

    it('non-admin user with shared_readonly access reaches the same branch (FR-005 regression guard)', async () => {
      mockSessionData = {
        data: { user: { name: 'user', email: 'user@example.com' } },
        status: 'authenticated',
      };
      mockSearchParamsValue = new URLSearchParams();
      mockGetConversation.mockResolvedValue(
        makeServerConv({
          access_level: 'shared_readonly',
          owner_id: 'other@example.com',
        }),
      );

      render(<ChatContainer />);

      await waitFor(() => {
        const props = capturedSupervisorProps[capturedSupervisorProps.length - 1];
        expect(props?.readOnlyReason).toBe('shared_readonly');
      });
      const props = await lastSupervisorProps();
      expect(props.readOnlyReason).toBe('shared_readonly');
    });
  });
});
