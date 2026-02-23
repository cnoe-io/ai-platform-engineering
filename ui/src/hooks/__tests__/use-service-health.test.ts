import { renderHook, waitFor } from '@testing-library/react';

jest.mock('../use-prometheus', () => ({
  useBatchPrometheus: jest.fn(),
}));

import { useBatchPrometheus } from '../use-prometheus';
import { useServiceHealth, type HealthStatus } from '../use-service-health';

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

  it('reports supervisor as healthy when up=1', () => {
    mockBatchReturn({
      results: {
        supervisor_up: promResult('1'),
        enabled_agents: { status: 'success', data: { resultType: 'vector', result: [] } },
        supervisor_success_rate: { status: 'success', data: { resultType: 'vector', result: [] } },
        request_rate_5m: { status: 'success', data: { resultType: 'vector', result: [] } },
        agent_statuses: { status: 'success', data: { resultType: 'vector', result: [] } },
      },
    });
    const { result } = renderHook(() => useServiceHealth());

    const supervisor = result.current.services.find(s => s.name === 'Supervisor Agent');
    expect(supervisor?.status).toBe('healthy');
    expect(supervisor?.detail).toBe('Running');
  });

  it('reports supervisor as down when up=0', () => {
    mockBatchReturn({
      results: {
        supervisor_up: promResult('0'),
        enabled_agents: { status: 'success', data: { resultType: 'vector', result: [] } },
        supervisor_success_rate: { status: 'success', data: { resultType: 'vector', result: [] } },
        request_rate_5m: { status: 'success', data: { resultType: 'vector', result: [] } },
        agent_statuses: { status: 'success', data: { resultType: 'vector', result: [] } },
      },
    });
    const { result } = renderHook(() => useServiceHealth());

    const supervisor = result.current.services.find(s => s.name === 'Supervisor Agent');
    expect(supervisor?.status).toBe('down');
    expect(supervisor?.detail).toBe('Not responding');
  });

  it('reports supervisor as unknown when no data', () => {
    mockBatchReturn({
      results: {
        supervisor_up: { status: 'success', data: { resultType: 'vector', result: [] } },
        enabled_agents: { status: 'success', data: { resultType: 'vector', result: [] } },
        supervisor_success_rate: { status: 'success', data: { resultType: 'vector', result: [] } },
        request_rate_5m: { status: 'success', data: { resultType: 'vector', result: [] } },
        agent_statuses: { status: 'success', data: { resultType: 'vector', result: [] } },
      },
    });
    const { result } = renderHook(() => useServiceHealth());

    const supervisor = result.current.services.find(s => s.name === 'Supervisor Agent');
    expect(supervisor?.status).toBe('unknown');
    expect(supervisor?.detail).toBe('No data');
  });

  it('reports sub-agent count', () => {
    mockBatchReturn({
      results: {
        supervisor_up: promResult('1'),
        enabled_agents: promResult('5'),
        supervisor_success_rate: { status: 'success', data: { resultType: 'vector', result: [] } },
        request_rate_5m: { status: 'success', data: { resultType: 'vector', result: [] } },
        agent_statuses: { status: 'success', data: { resultType: 'vector', result: [] } },
      },
    });
    const { result } = renderHook(() => useServiceHealth());

    const subAgents = result.current.services.find(s => s.name === 'Sub-agents');
    expect(subAgents?.status).toBe('healthy');
    expect(subAgents?.detail).toBe('5 agents enabled');
    expect(subAgents?.value).toBe(5);
  });

  it('reports sub-agents as down when count is 0', () => {
    mockBatchReturn({
      results: {
        supervisor_up: promResult('1'),
        enabled_agents: promResult('0'),
        supervisor_success_rate: { status: 'success', data: { resultType: 'vector', result: [] } },
        request_rate_5m: { status: 'success', data: { resultType: 'vector', result: [] } },
        agent_statuses: { status: 'success', data: { resultType: 'vector', result: [] } },
      },
    });
    const { result } = renderHook(() => useServiceHealth());

    const subAgents = result.current.services.find(s => s.name === 'Sub-agents');
    expect(subAgents?.status).toBe('down');
  });

  it('reports individual agent statuses', () => {
    mockBatchReturn({
      results: {
        supervisor_up: promResult('1'),
        enabled_agents: promResult('2'),
        supervisor_success_rate: { status: 'success', data: { resultType: 'vector', result: [] } },
        request_rate_5m: { status: 'success', data: { resultType: 'vector', result: [] } },
        agent_statuses: {
          status: 'success',
          data: {
            resultType: 'vector',
            result: [
              { metric: { agent_name: 'argocd' }, value: [Date.now() / 1000, '1'] },
              { metric: { agent_name: 'github' }, value: [Date.now() / 1000, '0'] },
            ],
          },
        },
      },
    });
    const { result } = renderHook(() => useServiceHealth());

    const argocd = result.current.services.find(s => s.name === 'Agent: argocd');
    expect(argocd?.status).toBe('healthy');
    expect(argocd?.detail).toBe('Enabled');

    const github = result.current.services.find(s => s.name === 'Agent: github');
    expect(github?.status).toBe('down');
    expect(github?.detail).toBe('Disabled');
  });

  it('reports success rate as healthy when >= 95%', () => {
    mockBatchReturn({
      results: {
        supervisor_up: promResult('1'),
        enabled_agents: { status: 'success', data: { resultType: 'vector', result: [] } },
        supervisor_success_rate: promResult('98.5'),
        request_rate_5m: { status: 'success', data: { resultType: 'vector', result: [] } },
        agent_statuses: { status: 'success', data: { resultType: 'vector', result: [] } },
      },
    });
    const { result } = renderHook(() => useServiceHealth());

    const successRate = result.current.services.find(s => s.name === 'Success Rate');
    expect(successRate?.status).toBe('healthy');
    expect(successRate?.detail).toBe('98.5%');
  });

  it('reports success rate as degraded when between 80-95%', () => {
    mockBatchReturn({
      results: {
        supervisor_up: promResult('1'),
        enabled_agents: { status: 'success', data: { resultType: 'vector', result: [] } },
        supervisor_success_rate: promResult('87.3'),
        request_rate_5m: { status: 'success', data: { resultType: 'vector', result: [] } },
        agent_statuses: { status: 'success', data: { resultType: 'vector', result: [] } },
      },
    });
    const { result } = renderHook(() => useServiceHealth());

    const successRate = result.current.services.find(s => s.name === 'Success Rate');
    expect(successRate?.status).toBe('degraded');
  });

  it('reports success rate as down when < 80%', () => {
    mockBatchReturn({
      results: {
        supervisor_up: promResult('1'),
        enabled_agents: { status: 'success', data: { resultType: 'vector', result: [] } },
        supervisor_success_rate: promResult('65.0'),
        request_rate_5m: { status: 'success', data: { resultType: 'vector', result: [] } },
        agent_statuses: { status: 'success', data: { resultType: 'vector', result: [] } },
      },
    });
    const { result } = renderHook(() => useServiceHealth());

    const successRate = result.current.services.find(s => s.name === 'Success Rate');
    expect(successRate?.status).toBe('down');
  });

  it('reports request rate', () => {
    mockBatchReturn({
      results: {
        supervisor_up: promResult('1'),
        enabled_agents: { status: 'success', data: { resultType: 'vector', result: [] } },
        supervisor_success_rate: { status: 'success', data: { resultType: 'vector', result: [] } },
        request_rate_5m: promResult('3.14'),
        agent_statuses: { status: 'success', data: { resultType: 'vector', result: [] } },
      },
    });
    const { result } = renderHook(() => useServiceHealth());

    const reqRate = result.current.services.find(s => s.name === 'Request Rate');
    expect(reqRate?.status).toBe('healthy');
    expect(reqRate?.detail).toBe('3.14 req/s');
  });

  it('computes overall as healthy when all services healthy', () => {
    mockBatchReturn({
      results: {
        supervisor_up: promResult('1'),
        enabled_agents: promResult('3'),
        supervisor_success_rate: promResult('99'),
        request_rate_5m: promResult('2.5'),
        agent_statuses: { status: 'success', data: { resultType: 'vector', result: [] } },
      },
    });
    const { result } = renderHook(() => useServiceHealth());

    expect(result.current.overall).toBe('healthy');
  });

  it('computes overall as down when any service is down', () => {
    mockBatchReturn({
      results: {
        supervisor_up: promResult('0'),
        enabled_agents: promResult('3'),
        supervisor_success_rate: promResult('99'),
        request_rate_5m: promResult('2.5'),
        agent_statuses: { status: 'success', data: { resultType: 'vector', result: [] } },
      },
    });
    const { result } = renderHook(() => useServiceHealth());

    expect(result.current.overall).toBe('down');
  });

  it('computes overall as degraded when success rate is degraded', () => {
    mockBatchReturn({
      results: {
        supervisor_up: promResult('1'),
        enabled_agents: promResult('3'),
        supervisor_success_rate: promResult('85'),
        request_rate_5m: promResult('2.5'),
        agent_statuses: { status: 'success', data: { resultType: 'vector', result: [] } },
      },
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
