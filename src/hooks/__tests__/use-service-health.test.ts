import { renderHook } from '@testing-library/react';

jest.mock('../use-prometheus', () => ({
  useBatchPrometheus: jest.fn(),
}));

import { useBatchPrometheus } from '../use-prometheus';
import { useServiceHealth } from '../use-service-health';

const mockUseBatchPrometheus = useBatchPrometheus as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

function mockBatchReturn(overrides: Partial<ReturnType<typeof useBatchPrometheus>> = {}) {
  mockUseBatchPrometheus.mockReturnValue({
    results: null,
    loading: false,
    error: null,
    refetch: jest.fn(),
    configured: true,
    ...overrides,
  });
}

function promResult(value: string) {
  return {
    status: 'success' as const,
    data: { resultType: 'vector', result: [{ metric: {}, value: [Date.now() / 1000, value] }] },
  };
}

const emptyResult = { status: 'success' as const, data: { resultType: 'vector', result: [] } };

/** Build a full results map with sensible empty defaults, overridable per-key. */
function results(overrides: Record<string, unknown> = {}) {
  return {
    da_up: emptyResult,
    turn_success_rate: emptyResult,
    turn_rate_5m: emptyResult,
    agent_turns: emptyResult,
    ...overrides,
  };
}

describe('useServiceHealth', () => {
  it('returns unknown overall and empty services when no results', () => {
    mockBatchReturn({ results: null });
    const { result } = renderHook(() => useServiceHealth());

    expect(result.current.services).toEqual([]);
    expect(result.current.overall).toBe('unknown');
  });

  it('returns loading state from useBatchPrometheus', () => {
    mockBatchReturn({ loading: true });
    const { result } = renderHook(() => useServiceHealth());

    expect(result.current.loading).toBe(true);
  });

  it('forwards error from useBatchPrometheus', () => {
    mockBatchReturn({ error: 'Connection refused' });
    const { result } = renderHook(() => useServiceHealth());

    expect(result.current.error).toBe('Connection refused');
  });

  it('forwards configured flag from useBatchPrometheus', () => {
    mockBatchReturn({ configured: false });
    const { result } = renderHook(() => useServiceHealth());

    expect(result.current.configured).toBe(false);
  });

  it('reports Dynamic Agents as healthy when up=1', () => {
    mockBatchReturn({ results: results({ da_up: promResult('1') }) });
    const { result } = renderHook(() => useServiceHealth());

    const da = result.current.services.find(s => s.name === 'Dynamic Agents');
    expect(da?.status).toBe('healthy');
    expect(da?.detail).toBe('Running');
  });

  it('reports Dynamic Agents as down when up=0', () => {
    mockBatchReturn({ results: results({ da_up: promResult('0') }) });
    const { result } = renderHook(() => useServiceHealth());

    const da = result.current.services.find(s => s.name === 'Dynamic Agents');
    expect(da?.status).toBe('down');
    expect(da?.detail).toBe('Not responding');
  });

  it('reports Dynamic Agents as unknown when no data', () => {
    mockBatchReturn({ results: results() });
    const { result } = renderHook(() => useServiceHealth());

    const da = result.current.services.find(s => s.name === 'Dynamic Agents');
    expect(da?.status).toBe('unknown');
    expect(da?.detail).toBe('No data');
  });

  it('reports active agent count and per-agent turn activity', () => {
    mockBatchReturn({
      results: results({
        da_up: promResult('1'),
        agent_turns: {
          status: 'success',
          data: {
            resultType: 'vector',
            result: [
              { metric: { agent_name: 'argocd' }, value: [Date.now() / 1000, '42'] },
              { metric: { agent_name: 'github' }, value: [Date.now() / 1000, '0'] },
            ],
          },
        },
      }),
    });
    const { result } = renderHook(() => useServiceHealth());

    const active = result.current.services.find(s => s.name === 'Active Agents');
    expect(active?.status).toBe('healthy');
    expect(active?.value).toBe(1);

    const argocd = result.current.services.find(s => s.name === 'Agent: argocd');
    expect(argocd?.status).toBe('healthy');
    expect(argocd?.detail).toBe('42 turns');

    const github = result.current.services.find(s => s.name === 'Agent: github');
    expect(github?.status).toBe('unknown');
    expect(github?.detail).toBe('0 turns');
  });

  it('reports turn success rate as healthy when >= 95%', () => {
    mockBatchReturn({ results: results({ da_up: promResult('1'), turn_success_rate: promResult('98.5') }) });
    const { result } = renderHook(() => useServiceHealth());

    const rate = result.current.services.find(s => s.name === 'Turn Success Rate');
    expect(rate?.status).toBe('healthy');
    expect(rate?.detail).toBe('98.5%');
  });

  it('reports turn success rate as degraded when between 80-95%', () => {
    mockBatchReturn({ results: results({ da_up: promResult('1'), turn_success_rate: promResult('87.3') }) });
    const { result } = renderHook(() => useServiceHealth());

    const rate = result.current.services.find(s => s.name === 'Turn Success Rate');
    expect(rate?.status).toBe('degraded');
  });

  it('reports turn success rate as down when < 80%', () => {
    mockBatchReturn({ results: results({ da_up: promResult('1'), turn_success_rate: promResult('65.0') }) });
    const { result } = renderHook(() => useServiceHealth());

    const rate = result.current.services.find(s => s.name === 'Turn Success Rate');
    expect(rate?.status).toBe('down');
  });

  it('reports turn rate', () => {
    mockBatchReturn({ results: results({ da_up: promResult('1'), turn_rate_5m: promResult('3.14') }) });
    const { result } = renderHook(() => useServiceHealth());

    const turnRate = result.current.services.find(s => s.name === 'Turn Rate');
    expect(turnRate?.status).toBe('healthy');
    expect(turnRate?.detail).toBe('3.14 turns/s');
  });

  it('computes overall as healthy when all services healthy', () => {
    mockBatchReturn({
      results: results({
        da_up: promResult('1'),
        turn_success_rate: promResult('99'),
        turn_rate_5m: promResult('2.5'),
      }),
    });
    const { result } = renderHook(() => useServiceHealth());

    expect(result.current.overall).toBe('healthy');
  });

  it('computes overall as down when any service is down', () => {
    mockBatchReturn({
      results: results({
        da_up: promResult('0'),
        turn_success_rate: promResult('99'),
        turn_rate_5m: promResult('2.5'),
      }),
    });
    const { result } = renderHook(() => useServiceHealth());

    expect(result.current.overall).toBe('down');
  });

  it('computes overall as degraded when success rate is degraded', () => {
    mockBatchReturn({
      results: results({
        da_up: promResult('1'),
        turn_success_rate: promResult('85'),
        turn_rate_5m: promResult('2.5'),
      }),
    });
    const { result } = renderHook(() => useServiceHealth());

    expect(result.current.overall).toBe('degraded');
  });

  it('passes options to useBatchPrometheus', () => {
    mockBatchReturn();
    renderHook(() => useServiceHealth({ refreshInterval: 60_000, enabled: false }));

    expect(mockUseBatchPrometheus).toHaveBeenCalledWith(
      expect.any(Array),
      { refreshInterval: 60_000, enabled: false }
    );
  });

  it('provides refetch function', () => {
    const mockRefetch = jest.fn();
    mockBatchReturn({ refetch: mockRefetch });
    const { result } = renderHook(() => useServiceHealth());

    expect(result.current.refetch).toBe(mockRefetch);
  });
});
