import { renderHook, waitFor, act } from '@testing-library/react';
import { useRAGHealth } from '../use-rag-health';

const mockGetHealthStatus = jest.fn();
jest.mock('@/components/rag/api', () => ({
  getHealthStatus: (...args: unknown[]) => mockGetHealthStatus(...args),
}));

let mockRagUrl = 'http://localhost:9000';
let mockRagEnabled = true;
jest.mock('@/lib/config', () => ({
  config: {
    get ragUrl() {
      return mockRagUrl;
    },
    get ragEnabled() {
      return mockRagEnabled;
    },
  },
}));

describe('useRAGHealth', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRagUrl = 'http://localhost:9000';
    mockRagEnabled = true;
  });

  it('initial state is checking', () => {
    mockGetHealthStatus.mockImplementation(
      () => new Promise(() => {}) // Never resolves
    );

    const { result } = renderHook(() => useRAGHealth());

    expect(result.current.status).toBe('checking');
  });

  it('ragEnabled=false → immediately disconnected, no health check', async () => {
    mockRagEnabled = false;

    const { result } = renderHook(() => useRAGHealth());

    await waitFor(() => {
      expect(result.current.status).toBe('disconnected');
    });

    expect(mockGetHealthStatus).not.toHaveBeenCalled();
  });

  it('healthy response → connected', async () => {
    mockGetHealthStatus.mockResolvedValue({ status: 'healthy' });

    const { result } = renderHook(() => useRAGHealth());

    await waitFor(() => {
      expect(result.current.status).toBe('connected');
    });
  });

  it('healthy response with graph_rag_enabled=false → graphRagEnabled=false', async () => {
    mockGetHealthStatus.mockResolvedValue({
      status: 'healthy',
      config: { graph_rag_enabled: false },
    });

    const { result } = renderHook(() => useRAGHealth());

    await waitFor(() => {
      expect(result.current.status).toBe('connected');
    });

    expect(result.current.graphRagEnabled).toBe(false);
  });

  it('healthy response defaults graphRagEnabled to true', async () => {
    mockGetHealthStatus.mockResolvedValue({ status: 'healthy' });

    const { result } = renderHook(() => useRAGHealth());

    await waitFor(() => {
      expect(result.current.status).toBe('connected');
    });

    expect(result.current.graphRagEnabled).toBe(true);
  });

  it('unhealthy response → disconnected', async () => {
    mockGetHealthStatus.mockResolvedValue({ status: 'unhealthy' });

    const { result } = renderHook(() => useRAGHealth());

    await waitFor(() => {
      expect(result.current.status).toBe('disconnected');
    });
  });

  it('error → disconnected', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    mockGetHealthStatus.mockRejectedValue(new Error('API error'));

    const { result } = renderHook(() => useRAGHealth());

    await waitFor(() => {
      expect(result.current.status).toBe('disconnected');
    });

    consoleSpy.mockRestore();
  });

  it('checkNow triggers check', async () => {
    mockGetHealthStatus.mockResolvedValue({ status: 'healthy' });

    const { result } = renderHook(() => useRAGHealth());

    await waitFor(() => {
      expect(result.current.status).toBe('connected');
    });

    mockGetHealthStatus.mockClear();
    mockGetHealthStatus.mockResolvedValue({ status: 'healthy' });

    act(() => {
      result.current.checkNow();
    });

    await waitFor(() => {
      expect(mockGetHealthStatus).toHaveBeenCalled();
    });
  });

  it('returns url from config', () => {
    mockGetHealthStatus.mockImplementation(() => new Promise(() => {}));

    const { result } = renderHook(() => useRAGHealth());

    expect(result.current.url).toBe('http://localhost:9000');
  });
});
