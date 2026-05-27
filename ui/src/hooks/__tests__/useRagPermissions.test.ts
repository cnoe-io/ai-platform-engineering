import { renderHook } from '@testing-library/react';
import { useRagPermissions } from '../useRagPermissions';

const mockUseKbTabGates = jest.fn();
jest.mock('@/lib/rag-api', () => ({
  Permission: { READ: 'read', INGEST: 'ingest', DELETE: 'delete' },
}));

jest.mock('../use-kb-tab-gates', () => ({
  useKbTabGates: () => mockUseKbTabGates(),
}));

describe('useRagPermissions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseKbTabGates.mockReturnValue({
      gates: { search: false, data_sources: false, graph: false, mcp_tools: false, has_any_kb: false, kb_count: 0 },
      loading: false,
      error: null,
      orgAdminBypass: false,
      visibleTabs: [],
      refresh: jest.fn(),
    });
  });

  it('initially loading=true', () => {
    mockUseKbTabGates.mockReturnValue({
      gates: { search: false, data_sources: false, graph: false, mcp_tools: false, has_any_kb: false, kb_count: 0 },
      loading: true,
      error: null,
      orgAdminBypass: false,
      visibleTabs: [],
      refresh: jest.fn(),
    });

    const { result } = renderHook(() => useRagPermissions());

    expect(result.current.isLoading).toBe(true);
  });

  it('org-admin bypass grants all UI permissions without RAG user-info', async () => {
    mockUseKbTabGates.mockReturnValue({
      gates: { search: true, data_sources: true, graph: true, mcp_tools: true, has_any_kb: true, kb_count: -1 },
      loading: false,
      error: null,
      orgAdminBypass: true,
      visibleTabs: ['search', 'data_sources', 'graph', 'mcp_tools'],
      refresh: jest.fn(),
    });

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

  it('readable KB gates grant read but not global write permissions', async () => {
    mockUseKbTabGates.mockReturnValue({
      gates: { search: true, data_sources: true, graph: true, mcp_tools: true, has_any_kb: true, kb_count: 1 },
      loading: false,
      error: null,
      orgAdminBypass: false,
      visibleTabs: ['search', 'data_sources', 'graph', 'mcp_tools'],
      refresh: jest.fn(),
    });

    const { result } = renderHook(() => useRagPermissions());

    expect(result.current.permissions).toEqual(['read']);
    expect(result.current.hasPermission('read')).toBe(true);
    expect(result.current.hasPermission('ingest')).toBe(false);
    expect(result.current.hasPermission('delete')).toBe(false);
  });

  it('no readable KB gates grant no permissions', async () => {
    const { result } = renderHook(() => useRagPermissions());

    expect(result.current.permissions).toEqual([]);
    expect(result.current.hasPermission('read')).toBe(false);
  });

  it('surfaces gate fetch errors', async () => {
    mockUseKbTabGates.mockReturnValue({
      gates: { search: false, data_sources: false, graph: false, mcp_tools: false, has_any_kb: false, kb_count: 0 },
      loading: false,
      error: 'Failed to fetch KB tab gates: 503',
      orgAdminBypass: false,
      visibleTabs: [],
      refresh: jest.fn(),
    });

    const { result } = renderHook(() => useRagPermissions());

    expect(result.current.error).toEqual(new Error('Failed to fetch KB tab gates: 503'));
  });
});
