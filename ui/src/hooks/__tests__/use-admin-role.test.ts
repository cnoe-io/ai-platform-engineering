import { renderHook, waitFor } from '@testing-library/react';
import { useAdminRole } from '../use-admin-role';

const mockUseSession = jest.fn();
jest.mock('next-auth/react', () => ({
  useSession: () => mockUseSession(),
}));

let mockGetConfig: Record<string, unknown> = {};
jest.mock('@/lib/config', () => ({
  getConfig: (key: string) => mockGetConfig[key],
}));

describe('useAdminRole', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetConfig = {};
    (global.fetch as jest.Mock) = jest.fn();
  });

  it('returns isAdmin=false, loading=true initially (before async resolution)', async () => {
    mockUseSession.mockReturnValue({
      data: { role: 'user', user: { email: 'user@test.com' } },
    });
    (global.fetch as jest.Mock).mockImplementation(
      () => new Promise(() => {}) // Never resolves - keeps loading true
    );

    const { result } = renderHook(() => useAdminRole());

    expect(result.current.isAdmin).toBe(false);
    expect(result.current.loading).toBe(true);
  });

  it('no session + all dev admin flags set → isAdmin=true', async () => {
    mockUseSession.mockReturnValue({ data: null });
    mockGetConfig = {
      ssoEnabled: false,
      allowDevAdminWhenSsoDisabled: true,
      storageMode: 'mongodb',
    };

    const { result } = renderHook(() => useAdminRole());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.isAdmin).toBe(true);
    expect(result.current.loading).toBe(false);
  });

  it('no session + ssoEnabled=false + allowDevAdminWhenSsoDisabled=false → isAdmin=false', async () => {
    mockUseSession.mockReturnValue({ data: null });
    mockGetConfig = {
      ssoEnabled: false,
      allowDevAdminWhenSsoDisabled: false,
      storageMode: 'mongodb',
    };

    const { result } = renderHook(() => useAdminRole());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.isAdmin).toBe(false);
  });

  it('no session + ssoEnabled=true → isAdmin=false', async () => {
    mockUseSession.mockReturnValue({ data: null });
    mockGetConfig = {
      ssoEnabled: true,
      allowDevAdminWhenSsoDisabled: true,
      storageMode: 'mongodb',
    };

    const { result } = renderHook(() => useAdminRole());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.isAdmin).toBe(false);
  });

  it('no session + storageMode localStorage → isAdmin=false even with dev flags', async () => {
    mockUseSession.mockReturnValue({ data: null });
    mockGetConfig = {
      ssoEnabled: false,
      allowDevAdminWhenSsoDisabled: true,
      storageMode: 'localStorage',
    };

    const { result } = renderHook(() => useAdminRole());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.isAdmin).toBe(false);
  });

  it('session with role=admin → isAdmin=true, no API call', async () => {
    mockUseSession.mockReturnValue({
      data: { role: 'admin', user: { email: 'admin@test.com' } },
    });

    const { result } = renderHook(() => useAdminRole());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.isAdmin).toBe(true);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('session with role=user + API returns admin → isAdmin=true', async () => {
    mockUseSession.mockReturnValue({
      data: { role: 'user', user: { email: 'user@test.com' } },
    });
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ role: 'admin' }),
    });

    const { result } = renderHook(() => useAdminRole());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.isAdmin).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith('/api/auth/role');
  });

  it('session with role=user + API returns user → isAdmin=false', async () => {
    mockUseSession.mockReturnValue({
      data: { role: 'user', user: { email: 'user@test.com' } },
    });
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ role: 'user' }),
    });

    const { result } = renderHook(() => useAdminRole());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.isAdmin).toBe(false);
  });

  it('session with role=user + API fetch fails → isAdmin=false', async () => {
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
    mockUseSession.mockReturnValue({
      data: { role: 'user', user: { email: 'user@test.com' } },
    });
    (global.fetch as jest.Mock).mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useAdminRole());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.isAdmin).toBe(false);
    consoleSpy.mockRestore();
  });

  it('loading ends false when no session', async () => {
    mockUseSession.mockReturnValue({ data: null });
    mockGetConfig = { ssoEnabled: true, storageMode: 'localStorage' };

    const { result } = renderHook(() => useAdminRole());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
  });

  it('loading ends false when session with admin role', async () => {
    mockUseSession.mockReturnValue({
      data: { role: 'admin', user: { email: 'admin@test.com' } },
    });

    const { result } = renderHook(() => useAdminRole());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
  });

  it('loading starts true, ends false when API is called', async () => {
    mockUseSession.mockReturnValue({
      data: { role: 'user', user: { email: 'user@test.com' } },
    });
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ role: 'user' }),
    });

    const { result } = renderHook(() => useAdminRole());

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
  });

  it('session without role uses API fallback', async () => {
    mockUseSession.mockReturnValue({
      data: { user: { email: 'user@test.com' } },
    });
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ role: 'admin' }),
    });

    const { result } = renderHook(() => useAdminRole());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.isAdmin).toBe(true);
  });

  it('re-runs when session changes from null to authenticated', async () => {
    mockUseSession.mockReturnValue({ data: null });
    mockGetConfig = { ssoEnabled: false, allowDevAdminWhenSsoDisabled: false, storageMode: 'localStorage' };

    const { result, rerender } = renderHook(() => useAdminRole());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.isAdmin).toBe(false);

    mockUseSession.mockReturnValue({
      data: { role: 'admin', user: { email: 'admin@test.com' } },
    });
    rerender();

    await waitFor(() => {
      expect(result.current.isAdmin).toBe(true);
    });
  });
});
