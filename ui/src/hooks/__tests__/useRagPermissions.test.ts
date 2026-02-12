import { renderHook, waitFor } from '@testing-library/react';
import { useRagPermissions } from '../useRagPermissions';

const mockGetUserInfo = jest.fn();
const mockHasPermission = jest.fn();
jest.mock('@/lib/rag-api', () => ({
  getUserInfo: (...args: unknown[]) => mockGetUserInfo(...args),
  hasPermission: (userInfo: unknown, permission: unknown) =>
    mockHasPermission(userInfo, permission),
  Permission: { READ: 'read', INGEST: 'ingest', DELETE: 'delete' },
}));

describe('useRagPermissions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetUserInfo.mockImplementation(() => new Promise(() => {}));
    mockHasPermission.mockImplementation((userInfo: { permissions?: string[] } | null, permission: string) => {
      if (!userInfo) return false;
      return userInfo.permissions?.includes(permission) ?? false;
    });
  });

  it('initially loading=true', () => {
    mockGetUserInfo.mockImplementation(() => new Promise(() => {}));

    const { result } = renderHook(() => useRagPermissions());

    expect(result.current.isLoading).toBe(true);
  });

  it('successful fetch → sets userInfo with permissions', async () => {
    const userInfo = {
      email: 'user@test.com',
      role: 'user',
      is_authenticated: true,
      groups: [],
      permissions: ['read', 'ingest'],
      in_trusted_network: false,
    };
    mockGetUserInfo.mockResolvedValue(userInfo);

    const { result } = renderHook(() => useRagPermissions());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.userInfo).toEqual(userInfo);
    expect(result.current.error).toBeNull();
  });

  it('error → sets error, userInfo null', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    mockGetUserInfo.mockRejectedValue(new Error('Fetch failed'));

    const { result } = renderHook(() => useRagPermissions());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toEqual(new Error('Fetch failed'));
    expect(result.current.userInfo).toBeNull();
    consoleSpy.mockRestore();
  });

  it('hasPermission returns true for granted permission', async () => {
    const userInfo = {
      email: 'user@test.com',
      role: 'admin',
      is_authenticated: true,
      groups: [],
      permissions: ['read', 'delete'],
      in_trusted_network: false,
    };
    mockGetUserInfo.mockResolvedValue(userInfo);
    mockHasPermission.mockReturnValue(true);

    const { result } = renderHook(() => useRagPermissions());

    await waitFor(() => {
      expect(result.current.userInfo).not.toBeNull();
    });

    expect(result.current.hasPermission('delete')).toBe(true);
  });

  it('hasPermission returns false for denied permission', async () => {
    const userInfo = {
      email: 'user@test.com',
      role: 'user',
      is_authenticated: true,
      groups: [],
      permissions: ['read'],
      in_trusted_network: false,
    };
    mockGetUserInfo.mockResolvedValue(userInfo);
    mockHasPermission.mockReturnValue(false);

    const { result } = renderHook(() => useRagPermissions());

    await waitFor(() => {
      expect(result.current.userInfo).not.toBeNull();
    });

    expect(result.current.hasPermission('delete')).toBe(false);
  });

  it('hasPermission returns false when userInfo is null', async () => {
    mockGetUserInfo.mockRejectedValue(new Error('Failed'));

    const { result } = renderHook(() => useRagPermissions());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.hasPermission('read')).toBe(false);
  });

  it('permissions array from userInfo', async () => {
    const userInfo = {
      email: 'user@test.com',
      role: 'user',
      is_authenticated: true,
      groups: [],
      permissions: ['read', 'ingest'],
      in_trusted_network: false,
    };
    mockGetUserInfo.mockResolvedValue(userInfo);

    const { result } = renderHook(() => useRagPermissions());

    await waitFor(() => {
      expect(result.current.userInfo).not.toBeNull();
    });

    expect(result.current.permissions).toEqual(['read', 'ingest']);
  });

  it('permissions empty array when userInfo has no permissions', async () => {
    const userInfo = {
      email: 'user@test.com',
      role: 'user',
      is_authenticated: true,
      groups: [],
      in_trusted_network: false,
    };
    mockGetUserInfo.mockResolvedValue(userInfo);

    const { result } = renderHook(() => useRagPermissions());

    await waitFor(() => {
      expect(result.current.userInfo).not.toBeNull();
    });

    expect(result.current.permissions).toEqual([]);
  });

  it('cleanup on unmount does not update state', async () => {
    let resolvePromise: (value: unknown) => void;
    const delayedPromise = new Promise((resolve) => {
      resolvePromise = resolve;
    });
    mockGetUserInfo.mockReturnValue(delayedPromise);

    const { result, unmount } = renderHook(() => useRagPermissions());

    unmount();
    resolvePromise!({ email: 'a@b.com', role: 'user', is_authenticated: true, groups: [], in_trusted_network: false });

    await Promise.resolve();

    expect(result.current.userInfo).toBeNull();
  });
});
