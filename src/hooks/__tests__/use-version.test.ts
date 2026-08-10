import { renderHook, waitFor } from '@testing-library/react';
import { useVersion } from '../use-version';

describe('useVersion', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (global.fetch as jest.Mock) = jest.fn();
  });

  it('initially returns null versionInfo and isLoading=true', () => {
    (global.fetch as jest.Mock).mockImplementation(
      () => new Promise(() => {}) // Never resolves to keep loading
    );

    const { result } = renderHook(() => useVersion());

    expect(result.current.versionInfo).toBeNull();
    expect(result.current.isLoading).toBe(true);
  });

  it('successful fetch: returns parsed version data', async () => {
    const versionData = {
      version: '1.0.0',
      gitCommit: 'abc123',
      buildDate: '2025-01-15',
      packageVersion: '1.0.0',
    };
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => versionData,
    });

    const { result } = renderHook(() => useVersion());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.versionInfo).toEqual(versionData);
    expect(result.current.versionInfo?.version).toBe('1.0.0');
    expect(result.current.versionInfo?.gitCommit).toBe('abc123');
    expect(result.current.versionInfo?.buildDate).toBe('2025-01-15');
    expect(result.current.versionInfo?.packageVersion).toBe('1.0.0');
  });

  it('404 response: versionInfo stays null', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({}),
    });

    const { result } = renderHook(() => useVersion());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.versionInfo).toBeNull();
  });

  it('non-ok response: versionInfo stays null', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Server error' }),
    });

    const { result } = renderHook(() => useVersion());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.versionInfo).toBeNull();
  });

  it('network error: versionInfo stays null, isLoading becomes false', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    (global.fetch as jest.Mock).mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useVersion());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.versionInfo).toBeNull();
    expect(result.current.isLoading).toBe(false);
    consoleSpy.mockRestore();
  });

  it('response data structure matches interface', async () => {
    const versionData = {
      version: '2.3.4',
      gitCommit: 'def456',
      buildDate: '2025-02-11',
      packageVersion: '2.3.4',
    };
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => versionData,
    });

    const { result } = renderHook(() => useVersion());

    await waitFor(() => {
      expect(result.current.versionInfo).not.toBeNull();
    });

    expect(result.current.versionInfo).toHaveProperty('version');
    expect(result.current.versionInfo).toHaveProperty('gitCommit');
    expect(result.current.versionInfo).toHaveProperty('buildDate');
    expect(result.current.versionInfo).toHaveProperty('packageVersion');
  });

  it('only fetches once on mount', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        version: '1.0.0',
        gitCommit: 'abc',
        buildDate: '2025-01-01',
      }),
    });

    const { result, rerender } = renderHook(() => useVersion());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    rerender();
    rerender();

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith('/api/version');
  });
});
