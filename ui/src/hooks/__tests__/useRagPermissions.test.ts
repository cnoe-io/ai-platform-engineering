import { renderHook } from '@testing-library/react';
import { useRagPermissions } from '../useRagPermissions';
import type { KbTabGatesMap } from '@/lib/rbac/types';

const mockUseKbTabGates = jest.fn();
jest.mock('@/lib/rag-api', () => ({
  Permission: { READ: 'read', INGEST: 'ingest', DELETE: 'delete' },
}));

jest.mock('../use-kb-tab-gates', () => ({
  useKbTabGates: () => mockUseKbTabGates(),
}));

function gates(overrides: Partial<KbTabGatesMap> = {}): KbTabGatesMap {
  return {
    search: false,
    data_sources: false,
    graph: false,
    mcp_tools: false,
    has_any_kb: false,
    kb_count: 0,
    can_ingest: false,
    ...overrides,
  };
}

function gateState(
  g: KbTabGatesMap,
  extra: Partial<{ loading: boolean; error: string | null; orgAdminBypass: boolean }> = {},
) {
  return {
    gates: g,
    loading: false,
    error: null,
    orgAdminBypass: false,
    visibleTabs: [],
    refresh: jest.fn(),
    ...extra,
  };
}

describe('useRagPermissions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseKbTabGates.mockReturnValue(gateState(gates()));
  });

  it('initially loading=true', () => {
    mockUseKbTabGates.mockReturnValue(gateState(gates(), { loading: true }));

    const { result } = renderHook(() => useRagPermissions());

    expect(result.current.isLoading).toBe(true);
  });

  it('org-admin bypass grants all UI permissions without RAG user-info', async () => {
    mockUseKbTabGates.mockReturnValue(
      gateState(
        gates({ search: true, data_sources: true, graph: true, mcp_tools: true, has_any_kb: true, kb_count: -1, can_ingest: true }),
        { orgAdminBypass: true },
      ),
    );

    const { result } = renderHook(() => useRagPermissions());

    expect(result.current.userInfo).toEqual({
      email: 'authenticated-user',
      role: 'ADMIN',
      is_authenticated: true,
      permissions: ['read', 'ingest', 'delete'],
    });
    expect(result.current.hasPermission('read')).toBe(true);
    expect(result.current.hasPermission('ingest')).toBe(true);
    expect(result.current.hasPermission('delete')).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('team ingestor (can_ingest, not org admin) gets read+ingest but NOT delete', async () => {
    mockUseKbTabGates.mockReturnValue(
      gateState(
        gates({ search: true, data_sources: true, graph: true, mcp_tools: true, has_any_kb: true, kb_count: 1, can_ingest: true }),
      ),
    );

    const { result } = renderHook(() => useRagPermissions());

    expect(result.current.permissions).toEqual(['read', 'ingest']);
    expect(result.current.hasPermission('read')).toBe(true);
    expect(result.current.hasPermission('ingest')).toBe(true);
    // DELETE remains org-admin-only — no team-scoped delete relation today.
    expect(result.current.hasPermission('delete')).toBe(false);
    // Non-admin role label even with ingest.
    expect(result.current.userInfo?.role).toBe('OPENFGA');
  });

  it('readable-but-not-ingestible KB grants read only', async () => {
    mockUseKbTabGates.mockReturnValue(
      gateState(
        gates({ search: true, data_sources: true, graph: true, mcp_tools: true, has_any_kb: true, kb_count: 1, can_ingest: false }),
      ),
    );

    const { result } = renderHook(() => useRagPermissions());

    expect(result.current.permissions).toEqual(['read']);
    expect(result.current.hasPermission('read')).toBe(true);
    expect(result.current.hasPermission('ingest')).toBe(false);
    expect(result.current.hasPermission('delete')).toBe(false);
  });

  it('ingest without readable KB still grants ingest (defensive — gates independent)', async () => {
    // Edge case: can_ingest true while has_any_kb false should still expose
    // INGEST so the ingest UI is not silently withheld from a grantee.
    mockUseKbTabGates.mockReturnValue(
      gateState(gates({ can_ingest: true })),
    );

    const { result } = renderHook(() => useRagPermissions());

    expect(result.current.permissions).toEqual(['ingest']);
  });

  it('no readable KB gates grant no permissions', async () => {
    const { result } = renderHook(() => useRagPermissions());

    expect(result.current.permissions).toEqual([]);
    expect(result.current.hasPermission('read')).toBe(false);
  });

  it('surfaces gate fetch errors', async () => {
    mockUseKbTabGates.mockReturnValue(
      gateState(gates(), { error: 'Failed to fetch KB tab gates: 503' }),
    );

    const { result } = renderHook(() => useRagPermissions());

    expect(result.current.error).toEqual(new Error('Failed to fetch KB tab gates: 503'));
  });
});
