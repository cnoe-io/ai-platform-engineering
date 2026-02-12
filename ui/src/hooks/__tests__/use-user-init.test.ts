import { renderHook, waitFor } from '@testing-library/react';
import { useUserInit } from '../use-user-init';

const mockUseSession = jest.fn();
jest.mock('next-auth/react', () => ({
  useSession: () => mockUseSession(),
}));

const mockGetConfig = jest.fn();
jest.mock('@/lib/config', () => ({
  getConfig: (key: string) => mockGetConfig(key),
}));

const mockGetCurrentUser = jest.fn();
jest.mock('@/lib/api-client', () => ({
  apiClient: { getCurrentUser: (...args: unknown[]) => mockGetCurrentUser(...args) },
}));

describe('useUserInit', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetConfig.mockImplementation((key: string) => {
      const config: Record<string, unknown> = {
        ssoEnabled: true,
        storageMode: 'mongodb',
      };
      return config[key];
    });
  });

  it('SSO disabled → initialized=true, no API call', async () => {
    mockGetConfig.mockImplementation((key: string) => {
      if (key === 'ssoEnabled') return false;
      if (key === 'storageMode') return 'localStorage';
      return undefined;
    });
    mockUseSession.mockReturnValue({ data: { user: { email: 'user@test.com' } }, status: 'authenticated' });

    const { result } = renderHook(() => useUserInit());

    await waitFor(() => {
      expect(result.current.initialized).toBe(true);
    });

    expect(mockGetCurrentUser).not.toHaveBeenCalled();
  });

  it('storageMode not mongodb → initialized=true, no API call', async () => {
    mockGetConfig.mockImplementation((key: string) => {
      if (key === 'ssoEnabled') return true;
      if (key === 'storageMode') return 'localStorage';
      return undefined;
    });
    mockUseSession.mockReturnValue({ data: { user: { email: 'user@test.com' } }, status: 'authenticated' });

    const { result } = renderHook(() => useUserInit());

    await waitFor(() => {
      expect(result.current.initialized).toBe(true);
    });

    expect(mockGetCurrentUser).not.toHaveBeenCalled();
  });

  it('session loading → not yet initialized', async () => {
    mockGetConfig.mockImplementation((key: string) => {
      if (key === 'ssoEnabled') return true;
      if (key === 'storageMode') return 'mongodb';
      return undefined;
    });
    mockUseSession.mockReturnValue({ data: null, status: 'loading' });

    const { result } = renderHook(() => useUserInit());

    await waitFor(() => {
      expect(mockGetConfig).toHaveBeenCalled();
    }, { timeout: 500 });

    expect(result.current.initialized).toBe(false);
    expect(mockGetCurrentUser).not.toHaveBeenCalled();
  });

  it('not authenticated → initialized=true', async () => {
    mockGetConfig.mockImplementation((key: string) => {
      if (key === 'ssoEnabled') return true;
      if (key === 'storageMode') return 'mongodb';
      return undefined;
    });
    mockUseSession.mockReturnValue({ data: null, status: 'unauthenticated' });

    const { result } = renderHook(() => useUserInit());

    await waitFor(() => {
      expect(result.current.initialized).toBe(true);
    });

    expect(mockGetCurrentUser).not.toHaveBeenCalled();
  });

  it('authenticated without email → initialized=true', async () => {
    mockGetConfig.mockImplementation((key: string) => {
      if (key === 'ssoEnabled') return true;
      if (key === 'storageMode') return 'mongodb';
      return undefined;
    });
    mockUseSession.mockReturnValue({ data: { user: {} }, status: 'authenticated' });

    const { result } = renderHook(() => useUserInit());

    await waitFor(() => {
      expect(result.current.initialized).toBe(true);
    });

    expect(mockGetCurrentUser).not.toHaveBeenCalled();
  });

  it('authenticated + getCurrentUser succeeds → initialized=true', async () => {
    mockGetConfig.mockImplementation((key: string) => {
      if (key === 'ssoEnabled') return true;
      if (key === 'storageMode') return 'mongodb';
      return undefined;
    });
    mockUseSession.mockReturnValue({ data: { user: { email: 'user@test.com' } }, status: 'authenticated' });
    mockGetCurrentUser.mockResolvedValue({ id: '123', email: 'user@test.com' });

    const { result } = renderHook(() => useUserInit());

    await waitFor(() => {
      expect(result.current.initialized).toBe(true);
    });

    expect(mockGetCurrentUser).toHaveBeenCalled();
    expect(result.current.error).toBeNull();
  });

  it('authenticated + getCurrentUser returns 401 → initialized=true, no error', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    mockGetConfig.mockImplementation((key: string) => {
      if (key === 'ssoEnabled') return true;
      if (key === 'storageMode') return 'mongodb';
      return undefined;
    });
    mockUseSession.mockReturnValue({ data: { user: { email: 'user@test.com' } }, status: 'authenticated' });
    mockGetCurrentUser.mockRejectedValue(new Error('401 Unauthorized'));

    const { result } = renderHook(() => useUserInit());

    await waitFor(() => {
      expect(result.current.initialized).toBe(true);
    });

    expect(result.current.error).toBeNull();
    consoleSpy.mockRestore();
  });

  it('authenticated + getCurrentUser returns unauthorized message → initialized=true', async () => {
    mockGetConfig.mockImplementation((key: string) => {
      if (key === 'ssoEnabled') return true;
      if (key === 'storageMode') return 'mongodb';
      return undefined;
    });
    mockUseSession.mockReturnValue({ data: { user: { email: 'user@test.com' } }, status: 'authenticated' });
    mockGetCurrentUser.mockRejectedValue(new Error('Unauthorized access'));

    const { result } = renderHook(() => useUserInit());

    await waitFor(() => {
      expect(result.current.initialized).toBe(true);
    });

    expect(result.current.error).toBeNull();
  });

  it('authenticated + getCurrentUser fails with non-401 → error set', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    mockGetConfig.mockImplementation((key: string) => {
      if (key === 'ssoEnabled') return true;
      if (key === 'storageMode') return 'mongodb';
      return undefined;
    });
    mockUseSession.mockReturnValue({ data: { user: { email: 'user@test.com' } }, status: 'authenticated' });
    mockGetCurrentUser.mockRejectedValue(new Error('Server error'));

    const { result } = renderHook(() => useUserInit());

    await waitFor(() => {
      expect(result.current.error).toBeTruthy();
    });

    expect(result.current.initialized).toBe(false);
    expect(result.current.error).toBe('Server error');
    consoleSpy.mockRestore();
  });

  it('authenticated + getCurrentUser throws non-Error → error set', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    mockGetConfig.mockImplementation((key: string) => {
      if (key === 'ssoEnabled') return true;
      if (key === 'storageMode') return 'mongodb';
      return undefined;
    });
    mockUseSession.mockReturnValue({ data: { user: { email: 'user@test.com' } }, status: 'authenticated' });
    mockGetCurrentUser.mockRejectedValue('String error');

    const { result } = renderHook(() => useUserInit());

    await waitFor(() => {
      expect(result.current.error).toBeTruthy();
    });

    expect(result.current.error).toBe('Failed to initialize user');
    consoleSpy.mockRestore();
  });

  it('re-runs when status changes from loading to authenticated', async () => {
    mockGetConfig.mockImplementation((key: string) => {
      if (key === 'ssoEnabled') return true;
      if (key === 'storageMode') return 'mongodb';
      return undefined;
    });
    mockUseSession.mockReturnValue({ data: null, status: 'loading' });

    const { result, rerender } = renderHook(() => useUserInit());

    expect(result.current.initialized).toBe(false);

    mockUseSession.mockReturnValue({
      data: { user: { email: 'user@test.com' } },
      status: 'authenticated',
    });
    mockGetCurrentUser.mockResolvedValue({ id: '123', email: 'user@test.com' });
    rerender();

    await waitFor(() => {
      expect(result.current.initialized).toBe(true);
    });
  });
});
