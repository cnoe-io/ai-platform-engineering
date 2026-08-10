import { renderHook, waitFor, act } from '@testing-library/react';
import {
  usePrometheusQuery,
  useBatchPrometheus,
  getScalarValue,
  getTimeseriesData,
  getLabeledValues,
  type PrometheusMetric,
} from '../use-prometheus';

// Mock global fetch
beforeEach(() => {
  jest.clearAllMocks();
  (global.fetch as jest.Mock) = jest.fn();
});

// ────────────────────────────────────────────────────────────────
// getScalarValue
// ────────────────────────────────────────────────────────────────

describe('getScalarValue', () => {
  it('returns null for null input', () => {
    expect(getScalarValue(null)).toBeNull();
  });

  it('returns null for empty array', () => {
    expect(getScalarValue([])).toBeNull();
  });

  it('returns numeric value from first metric', () => {
    const metrics: PrometheusMetric[] = [
      { metric: {}, value: [1700000000, '42.5'] },
    ];
    expect(getScalarValue(metrics)).toBe(42.5);
  });

  it('returns null when value is undefined', () => {
    const metrics: PrometheusMetric[] = [{ metric: {} }];
    expect(getScalarValue(metrics)).toBeNull();
  });

  it('returns null for NaN values', () => {
    const metrics: PrometheusMetric[] = [
      { metric: {}, value: [1700000000, 'not-a-number'] },
    ];
    expect(getScalarValue(metrics)).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────
// getTimeseriesData
// ────────────────────────────────────────────────────────────────

describe('getTimeseriesData', () => {
  it('returns empty array for null', () => {
    expect(getTimeseriesData(null)).toEqual([]);
  });

  it('extracts instant values (value field)', () => {
    const metrics: PrometheusMetric[] = [
      {
        metric: { agent_name: 'agent-a' },
        value: [1700000000, '10'],
      },
    ];
    expect(getTimeseriesData(metrics)).toEqual([
      { timestamp: 1700000000, value: 10, labels: { agent_name: 'agent-a' } },
    ]);
  });

  it('extracts range values (values field)', () => {
    const metrics: PrometheusMetric[] = [
      {
        metric: { agent_name: 'agent-b' },
        values: [
          [1700000000, '5'],
          [1700000060, '15'],
        ],
      },
    ];
    expect(getTimeseriesData(metrics)).toEqual([
      { timestamp: 1700000000, value: 5, labels: { agent_name: 'agent-b' } },
      { timestamp: 1700000060, value: 15, labels: { agent_name: 'agent-b' } },
    ]);
  });

  it('sorts by timestamp', () => {
    const metrics: PrometheusMetric[] = [
      {
        metric: {},
        values: [
          [1700000060, '20'],
          [1700000000, '10'],
          [1700000030, '15'],
        ],
      },
    ];
    const result = getTimeseriesData(metrics);
    expect(result.map((p) => p.timestamp)).toEqual([
      1700000000,
      1700000030,
      1700000060,
    ]);
  });

  it('handles mixed instant and range metrics', () => {
    const metrics: PrometheusMetric[] = [
      { metric: { id: 'a' }, value: [1700000000, '1'] },
      {
        metric: { id: 'b' },
        values: [
          [1700000060, '2'],
          [1700000030, '3'],
        ],
      },
    ];
    const result = getTimeseriesData(metrics);
    expect(result).toHaveLength(3);
    expect(result.map((p) => p.value)).toEqual([1, 3, 2]);
    expect(result.map((p) => p.timestamp)).toEqual([
      1700000000,
      1700000030,
      1700000060,
    ]);
  });
});

// ────────────────────────────────────────────────────────────────
// getLabeledValues
// ────────────────────────────────────────────────────────────────

describe('getLabeledValues', () => {
  it('returns empty array for null', () => {
    expect(getLabeledValues(null)).toEqual([]);
  });

  it('returns labeled values sorted by value descending', () => {
    const metrics: PrometheusMetric[] = [
      { metric: { agent_name: 'agent-a' }, value: [0, '10'] },
      { metric: { agent_name: 'agent-b' }, value: [0, '50'] },
      { metric: { agent_name: 'agent-c' }, value: [0, '25'] },
    ];
    expect(getLabeledValues(metrics)).toEqual([
      { label: 'agent-b', value: 50 },
      { label: 'agent-c', value: 25 },
      { label: 'agent-a', value: 10 },
    ]);
  });

  it('uses custom labelKey', () => {
    const metrics: PrometheusMetric[] = [
      { metric: { instance: 'host-1' }, value: [0, '100'] },
      { metric: { instance: 'host-2' }, value: [0, '200'] },
    ];
    expect(getLabeledValues(metrics, 'instance')).toEqual([
      { label: 'host-2', value: 200 },
      { label: 'host-1', value: 100 },
    ]);
  });

  it('defaults to agent_name labelKey', () => {
    const metrics: PrometheusMetric[] = [
      { metric: { agent_name: 'my-agent' }, value: [0, '42'] },
    ];
    expect(getLabeledValues(metrics)).toEqual([
      { label: 'my-agent', value: 42 },
    ]);
  });

  it("returns 'unknown' for missing label", () => {
    const metrics: PrometheusMetric[] = [
      { metric: {}, value: [0, '5'] },
    ];
    expect(getLabeledValues(metrics)).toEqual([
      { label: 'unknown', value: 5 },
    ]);
  });
});

// ────────────────────────────────────────────────────────────────
// usePrometheusQuery
// ────────────────────────────────────────────────────────────────

describe('usePrometheusQuery', () => {
  it('returns loading=true initially, then data after fetch', async () => {
    const mockResult = {
      status: 'success' as const,
      data: {
        resultType: 'vector',
        result: [{ metric: { job: 'test' }, value: [1700000000, '1'] }],
      },
    };
    let resolveFetch: (value: unknown) => void;
    const fetchPromise = new Promise<unknown>((resolve) => {
      resolveFetch = resolve;
    });
    (global.fetch as jest.Mock).mockReturnValue(fetchPromise);

    const { result } = renderHook(() =>
      usePrometheusQuery({ query: 'up' })
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(true);
    });

    resolveFetch!({
      ok: true,
      json: () =>
        Promise.resolve({ success: true, data: mockResult }),
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).toEqual(mockResult.data.result);
    expect(result.current.resultType).toBe('vector');
    expect(result.current.error).toBeNull();
    expect(result.current.configured).toBe(true);
  });

  it('sets configured=false when PROMETHEUS_NOT_CONFIGURED', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          success: false,
          code: 'PROMETHEUS_NOT_CONFIGURED',
        }),
    });

    const { result } = renderHook(() =>
      usePrometheusQuery({ query: 'up' })
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.configured).toBe(false);
    expect(result.current.error).toBe('Prometheus not configured');
  });

  it('sets error on non-success response', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          success: false,
          error: 'Query timeout',
        }),
    });

    const { result } = renderHook(() =>
      usePrometheusQuery({ query: 'up' })
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('Query timeout');
  });

  it('does not fetch when enabled=false', async () => {
    const { result } = renderHook(() =>
      usePrometheusQuery({ query: 'up', enabled: false })
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('does not fetch when query is empty', async () => {
    const { result } = renderHook(() =>
      usePrometheusQuery({ query: '' })
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('handles network errors', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('Network failure'));

    const { result } = renderHook(() =>
      usePrometheusQuery({ query: 'up' })
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('Network failure');
  });
});

// ────────────────────────────────────────────────────────────────
// useBatchPrometheus
// ────────────────────────────────────────────────────────────────

describe('useBatchPrometheus', () => {
  it('fetches via POST with queries in body', async () => {
    const mockData = {
      q1: {
        status: 'success' as const,
        data: { resultType: 'vector', result: [] },
      },
    };
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, data: mockData }),
    });

    const queries = [
      { id: 'q1', query: 'up' },
    ];

    const { result } = renderHook(() => useBatchPrometheus(queries));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/admin/metrics',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queries }),
      })
    );
    expect(result.current.results).toEqual(mockData);
  });

  it('handles PROMETHEUS_NOT_CONFIGURED', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          success: false,
          code: 'PROMETHEUS_NOT_CONFIGURED',
        }),
    });

    const { result } = renderHook(() =>
      useBatchPrometheus([{ id: 'q1', query: 'up' }])
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.configured).toBe(false);
    expect(result.current.error).toBe('Prometheus not configured');
  });

  it('does not fetch when no queries', async () => {
    const { result } = renderHook(() => useBatchPrometheus([]));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('does not fetch when enabled=false', async () => {
    const { result } = renderHook(() =>
      useBatchPrometheus([{ id: 'q1', query: 'up' }], { enabled: false })
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(global.fetch).not.toHaveBeenCalled();
  });
});
