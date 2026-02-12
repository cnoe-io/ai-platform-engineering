import { renderHook, waitFor, act } from '@testing-library/react';
import { useCAIPEHealth } from '../use-caipe-health';

jest.useFakeTimers();

let mockStorageMode: 'mongodb' | 'localStorage' = 'mongodb';
jest.mock('@/lib/config', () => ({
  config: {
    get caipeUrl() {
      return 'http://localhost:8000';
    },
    get storageMode() {
      return mockStorageMode;
    },
  },
}));

describe('useCAIPEHealth', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStorageMode = 'mongodb';
    (global.fetch as jest.Mock) = jest.fn();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('initial state is checking', () => {
    (global.fetch as jest.Mock).mockImplementation(
      () => new Promise(() => {}) // Never resolves
    );

    const { result } = renderHook(() => useCAIPEHealth());

    expect(result.current.status).toBe('checking');
  });

  it('successful fetch of agent card → status connected', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ name: 'CAIPE', skills: [] }),
    });

    const { result } = renderHook(() => useCAIPEHealth());

    await waitFor(() => {
      expect(result.current.status).toBe('connected');
    });
  });

  it('parses agents from skills array', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        skills: [
          { name: 'Agent1', description: 'Desc1', tags: ['tag1'] },
          { id: 'agent2', description: 'Desc2', tags: ['tag2'] },
        ],
      }),
    });

    const { result } = renderHook(() => useCAIPEHealth());

    await waitFor(() => {
      expect(result.current.agents.length).toBeGreaterThan(0);
    });

    expect(result.current.agents).toContainEqual(
      expect.objectContaining({ name: 'Agent1', description: 'Desc1', tags: ['tag1'] })
    );
    expect(result.current.agents).toContainEqual(
      expect.objectContaining({ name: 'agent2', description: 'Desc2', tags: ['tag2'] })
    );
  });

  it('parses agents from legacy agents array', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        agents: [
          { name: 'LegacyAgent', description: 'Legacy desc' },
        ],
      }),
    });

    const { result } = renderHook(() => useCAIPEHealth());

    await waitFor(() => {
      expect(result.current.agents.some((a) => a.name === 'LegacyAgent')).toBe(true);
    });
  });

  it('parses agents from capabilities array', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        capabilities: [
          { name: 'Cap1', description: 'Cap desc' },
          { type: 'Cap2' },
        ],
      }),
    });

    const { result } = renderHook(() => useCAIPEHealth());

    await waitFor(() => {
      expect(result.current.agents.length).toBeGreaterThan(0);
    });

    expect(result.current.agents.some((a) => a.name === 'Cap1' || a.name === 'Cap2')).toBe(true);
  });

  it('single agent fallback when no skills', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        name: 'Supervisor',
        description: 'Main supervisor agent',
      }),
    });

    const { result } = renderHook(() => useCAIPEHealth());

    await waitFor(() => {
      expect(result.current.status).toBe('connected');
    });

    expect(result.current.agents).toContainEqual(
      expect.objectContaining({ name: 'Supervisor', description: 'Main supervisor agent' })
    );
  });

  it('extracts and deduplicates tags', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        skills: [
          { name: 'A1', tags: ['tag1', 'tag2'] },
          { name: 'A2', tags: ['tag1', 'tag3'] },
        ],
      }),
    });

    const { result } = renderHook(() => useCAIPEHealth());

    await waitFor(() => {
      expect(result.current.tags.length).toBeGreaterThan(0);
    });

    const uniqueTags = [...new Set(result.current.tags)];
    expect(result.current.tags).toEqual(uniqueTags);
    expect(result.current.tags).toContain('tag1');
    expect(result.current.tags).toContain('tag2');
    expect(result.current.tags).toContain('tag3');
  });

  it('network error → status disconnected', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useCAIPEHealth());

    await waitFor(() => {
      expect(result.current.status).toBe('disconnected');
    });
  });

  it('timeout (AbortError) → status disconnected', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(
      Object.assign(new Error('Aborted'), { name: 'AbortError' })
    );

    const { result } = renderHook(() => useCAIPEHealth());

    await waitFor(() => {
      expect(result.current.status).toBe('disconnected');
    });
  });

  it('TypeError → status disconnected', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new TypeError('Failed to fetch'));

    const { result } = renderHook(() => useCAIPEHealth());

    await waitFor(() => {
      expect(result.current.status).toBe('disconnected');
    });
  });

  it('sets storageMode from config', async () => {
    mockStorageMode = 'mongodb';
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });

    const { result } = renderHook(() => useCAIPEHealth());

    await waitFor(() => {
      expect(result.current.storageMode).toBe('mongodb');
    });
  });

  it('checkNow triggers immediate health check', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });

    const { result } = renderHook(() => useCAIPEHealth());

    await waitFor(() => {
      expect(result.current.status).toBe('connected');
    });

    const callCountBefore = (global.fetch as jest.Mock).mock.calls.length;

    act(() => {
      result.current.checkNow();
    });

    await waitFor(() => {
      expect((global.fetch as jest.Mock).mock.calls.length).toBeGreaterThan(callCountBefore);
    });
  });
});
