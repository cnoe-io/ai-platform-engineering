import { renderHook, act } from '@testing-library/react';
import { useA2AStreaming, extractArtifactText } from '../use-a2a-streaming';

const mockAbort = jest.fn();
const mockSendMessage = jest.fn();
jest.mock('@/lib/a2a-client', () => ({
  A2AClient: jest.fn().mockImplementation(() => ({
    abort: mockAbort,
    sendMessage: (...args: unknown[]) => mockSendMessage(...args),
  })),
}));

describe('extractArtifactText', () => {
  it('empty input → empty string', () => {
    expect(extractArtifactText([])).toBe('');
  });

  it('null/undefined-like input → empty string', () => {
    expect(extractArtifactText(undefined as unknown as unknown[])).toBe('');
  });

  it('non-array input → empty string', () => {
    expect(extractArtifactText(null as unknown as unknown[])).toBe('');
  });

  it('parts with kind=text → concatenated text', () => {
    const parts = [
      { kind: 'text', text: 'Hello ' },
      { kind: 'text', text: 'World' },
    ];
    expect(extractArtifactText(parts)).toBe('Hello World');
  });

  it('parts with root.text → extracts root text', () => {
    const parts = [
      { root: { kind: 'text', text: 'Nested text' } },
    ];
    expect(extractArtifactText(parts)).toBe('Nested text');
  });

  it('parts without kind → includes them', () => {
    const parts = [
      { text: 'No kind' },
    ];
    expect(extractArtifactText(parts)).toBe('No kind');
  });

  it('parts without kind but with root.text → extracts', () => {
    const parts = [
      { root: { text: 'Root only' } },
    ];
    expect(extractArtifactText(parts)).toBe('Root only');
  });

  it('mixed parts → all text joined', () => {
    const parts = [
      { kind: 'text', text: 'A' },
      { root: { kind: 'text', text: 'B' } },
      { text: 'C' },
    ];
    expect(extractArtifactText(parts)).toBe('ABC');
  });

  it('skips parts with kind not text and no root.text', () => {
    const parts = [
      { kind: 'image' },
      { kind: 'text', text: 'Only this' },
    ];
    expect(extractArtifactText(parts)).toBe('Only this');
  });

  it('empty parts return empty string', () => {
    expect(extractArtifactText([{ kind: 'text', text: '' }])).toBe('');
    expect(extractArtifactText([{ root: { kind: 'text', text: '' } }])).toBe('');
  });
});

describe('useA2AStreaming', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSendMessage.mockResolvedValue({
      read: () => Promise.resolve({ done: true }),
    });
  });

  it('initial state: isStreaming=false, stateRef has defaults', () => {
    const { result } = renderHook(() =>
      useA2AStreaming({ endpoint: 'http://localhost:8000' })
    );

    expect(result.current.isStreaming).toBe(false);
    expect(result.current.stateRef.current).toMatchObject({
      accumulatedText: '',
      eventCount: 0,
      hasReceivedCompleteResult: false,
    });
  });

  it('cancel() aborts client when client exists', async () => {
    const { result } = renderHook(() =>
      useA2AStreaming({ endpoint: 'http://localhost:8000' })
    );

    await act(async () => {
      await result.current.sendMessage('Hello');
    });

    mockAbort.mockClear();
    act(() => {
      result.current.cancel();
    });

    expect(mockAbort).toHaveBeenCalled();
  });

  it('cancel() when no client does not throw', () => {
    mockAbort.mockClear();
    const { result } = renderHook(() =>
      useA2AStreaming({ endpoint: 'http://localhost:8000' })
    );

    expect(() => {
      act(() => {
        result.current.cancel();
        result.current.cancel();
      });
    }).not.toThrow();
  });

  it('handles warn when already streaming', async () => {
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
    let resolveFirst: () => void;
    const firstSendPromise = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    mockSendMessage.mockReturnValue(
      firstSendPromise.then(() => ({
        read: () => Promise.resolve({ done: true }),
      }))
    );

    const { result } = renderHook(() =>
      useA2AStreaming({ endpoint: 'http://localhost:8000' })
    );

    act(() => {
      result.current.sendMessage('First message');
    });

    act(() => {
      result.current.sendMessage('Second message');
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      '[useA2AStreaming] Already streaming, ignoring new message'
    );

    act(() => {
      resolveFirst!();
    });

    await firstSendPromise;
    consoleSpy.mockRestore();
  });

  it('sendMessage creates client and calls sendMessage', async () => {
    const { result } = renderHook(() =>
      useA2AStreaming({ endpoint: 'http://localhost:8000' })
    );

    await act(async () => {
      await result.current.sendMessage('Hello');
    });

    expect(mockSendMessage).toHaveBeenCalledWith('Hello', undefined);
  });

  it('sendMessage passes contextId when provided', async () => {
    const { result } = renderHook(() =>
      useA2AStreaming({ endpoint: 'http://localhost:8000' })
    );

    await act(async () => {
      await result.current.sendMessage('Hello', 'ctx-123');
    });

    expect(mockSendMessage).toHaveBeenCalledWith('Hello', 'ctx-123');
  });

  it('onStreamStart is called when sendMessage starts', async () => {
    const onStreamStart = jest.fn();
    const { result } = renderHook(() =>
      useA2AStreaming({ endpoint: 'http://localhost:8000', onStreamStart })
    );

    await act(async () => {
      await result.current.sendMessage('Hello');
    });

    expect(onStreamStart).toHaveBeenCalled();
  });

  it('stateRef is provided and accessible', () => {
    const { result } = renderHook(() =>
      useA2AStreaming({ endpoint: 'http://localhost:8000' })
    );

    expect(result.current.stateRef).toBeDefined();
    expect(result.current.stateRef.current).toBeDefined();
    expect(typeof result.current.stateRef.current.accumulatedText).toBe('string');
    expect(typeof result.current.stateRef.current.eventCount).toBe('number');
  });
});

// ============================================================================
// Helper — captures the config passed to A2AClient constructor so tests can
// fire onEvent / onError / onComplete callbacks manually.
// ============================================================================

function captureClientConfig() {
  const { A2AClient: MockA2AClient } = jest.requireMock('@/lib/a2a-client') as {
    A2AClient: jest.Mock;
  };
  let captured: { onEvent: (e: unknown) => void; onError: (e: Error) => void; onComplete: () => void } | null = null;
  MockA2AClient.mockImplementation((cfg: typeof captured) => {
    captured = cfg;
    return { abort: mockAbort, sendMessage: mockSendMessage };
  });
  return { cfg: () => captured! };
}

function artifactEvent(name: string, content: string, extra: Record<string, unknown> = {}) {
  return { id: 'e-' + name, timestamp: 0, type: 'artifact', artifact: { name }, displayContent: content, ...extra } as unknown;
}

// ============================================================================
// onCompleteResult callback
// ============================================================================

describe('useA2AStreaming — onCompleteResult', () => {
  let cfg: () => ReturnType<typeof captureClientConfig>['cfg'] extends () => infer R ? R : never;

  beforeEach(() => {
    jest.clearAllMocks();
    ({ cfg } = captureClientConfig());
  });

  it('called with content and artifact name when final_result received', async () => {
    const onCompleteResult = jest.fn();
    mockSendMessage.mockImplementation(async () => {
      cfg().onEvent(artifactEvent('final_result', 'Supervisor answer'));
      return { read: () => Promise.resolve({ done: true }) };
    });

    const { result } = renderHook(() =>
      useA2AStreaming({ endpoint: 'http://localhost:8000', onCompleteResult })
    );
    await act(async () => { await result.current.sendMessage('q'); });

    expect(onCompleteResult).toHaveBeenCalledWith('Supervisor answer', 'final_result');
  });

  it('called with content when partial_result received', async () => {
    const onCompleteResult = jest.fn();
    mockSendMessage.mockImplementation(async () => {
      cfg().onEvent(artifactEvent('partial_result', 'Partial content'));
      return { read: () => Promise.resolve({ done: true }) };
    });

    const { result } = renderHook(() =>
      useA2AStreaming({ endpoint: 'http://localhost:8000', onCompleteResult })
    );
    await act(async () => { await result.current.sendMessage('q'); });

    expect(onCompleteResult).toHaveBeenCalledWith('Partial content', 'partial_result');
  });

  it('NOT called when final_result has empty content', async () => {
    const onCompleteResult = jest.fn();
    mockSendMessage.mockImplementation(async () => {
      cfg().onEvent(artifactEvent('final_result', ''));
      return { read: () => Promise.resolve({ done: true }) };
    });

    const { result } = renderHook(() =>
      useA2AStreaming({ endpoint: 'http://localhost:8000', onCompleteResult })
    );
    await act(async () => { await result.current.sendMessage('q'); });

    expect(onCompleteResult).not.toHaveBeenCalledWith(expect.anything(), 'final_result');
  });

  it('sets hasReceivedCompleteResult=true after final_result', async () => {
    mockSendMessage.mockImplementation(async () => {
      cfg().onEvent(artifactEvent('final_result', 'Done'));
      return { read: () => Promise.resolve({ done: true }) };
    });

    const { result } = renderHook(() =>
      useA2AStreaming({ endpoint: 'http://localhost:8000' })
    );
    await act(async () => { await result.current.sendMessage('q'); });

    expect(result.current.stateRef.current.hasReceivedCompleteResult).toBe(true);
  });

  it('final_result replaces previously accumulated streaming text', async () => {
    mockSendMessage.mockImplementation(async () => {
      cfg().onEvent(artifactEvent('streaming_result', 'streaming chunk'));
      cfg().onEvent(artifactEvent('final_result', 'Supervisor synthesis'));
      return { read: () => Promise.resolve({ done: true }) };
    });

    const { result } = renderHook(() =>
      useA2AStreaming({ endpoint: 'http://localhost:8000', updateThrottleMs: 0 })
    );
    await act(async () => { await result.current.sendMessage('q'); });

    expect(result.current.stateRef.current.accumulatedText).toBe('Supervisor synthesis');
  });

  it('uses accumulated text as fallback when stream ends without final_result', async () => {
    const onCompleteResult = jest.fn();
    mockSendMessage.mockImplementation(async () => {
      cfg().onEvent(artifactEvent('streaming_result', 'Accumulated chunk'));
      cfg().onComplete();
      return { read: () => Promise.resolve({ done: true }) };
    });

    const { result } = renderHook(() =>
      useA2AStreaming({ endpoint: 'http://localhost:8000', onCompleteResult, updateThrottleMs: 0 })
    );
    await act(async () => { await result.current.sendMessage('q'); });

    expect(onCompleteResult).toHaveBeenCalledWith('Accumulated chunk', 'accumulated_fallback');
  });

  it('onComplete without any accumulated content does not call onCompleteResult', async () => {
    const onCompleteResult = jest.fn();
    mockSendMessage.mockImplementation(async () => {
      cfg().onComplete();
      return { read: () => Promise.resolve({ done: true }) };
    });

    const { result } = renderHook(() =>
      useA2AStreaming({ endpoint: 'http://localhost:8000', onCompleteResult })
    );
    await act(async () => { await result.current.sendMessage('q'); });

    expect(onCompleteResult).not.toHaveBeenCalled();
  });
});

// ============================================================================
// onStreamEnd callback
// ============================================================================

describe('useA2AStreaming — onStreamEnd', () => {
  let cfg: () => ReturnType<typeof captureClientConfig>['cfg'] extends () => infer R ? R : never;

  beforeEach(() => {
    jest.clearAllMocks();
    ({ cfg } = captureClientConfig());
  });

  it('called after successful stream completion', async () => {
    const onStreamEnd = jest.fn();
    mockSendMessage.mockImplementation(async () => {
      cfg().onComplete();
      return { read: () => Promise.resolve({ done: true }) };
    });

    const { result } = renderHook(() =>
      useA2AStreaming({ endpoint: 'http://localhost:8000', onStreamEnd })
    );
    await act(async () => { await result.current.sendMessage('q'); });

    expect(onStreamEnd).toHaveBeenCalledTimes(1);
  });

  it('called when A2AClient fires onError', async () => {
    const onStreamEnd = jest.fn();
    mockSendMessage.mockImplementation(async () => {
      cfg().onError(new Error('network failure'));
      return { read: () => Promise.resolve({ done: true }) };
    });

    const { result } = renderHook(() =>
      useA2AStreaming({ endpoint: 'http://localhost:8000', onStreamEnd })
    );
    await act(async () => { await result.current.sendMessage('q'); });

    expect(onStreamEnd).toHaveBeenCalledTimes(1);
  });

  it('called when sendMessage throws', async () => {
    const onStreamEnd = jest.fn();
    mockSendMessage.mockRejectedValue(new Error('connection refused'));

    const { result } = renderHook(() =>
      useA2AStreaming({ endpoint: 'http://localhost:8000', onStreamEnd })
    );
    await act(async () => { await result.current.sendMessage('q'); });

    expect(onStreamEnd).toHaveBeenCalledTimes(1);
  });

  it('receives a StreamingState with accumulated data', async () => {
    const onStreamEnd = jest.fn();
    mockSendMessage.mockImplementation(async () => {
      cfg().onEvent(artifactEvent('streaming_result', 'content'));
      cfg().onComplete();
      return { read: () => Promise.resolve({ done: true }) };
    });

    const { result } = renderHook(() =>
      useA2AStreaming({ endpoint: 'http://localhost:8000', onStreamEnd, updateThrottleMs: 0 })
    );
    await act(async () => { await result.current.sendMessage('q'); });

    const [state] = onStreamEnd.mock.calls[0];
    expect(state).toMatchObject({ eventCount: 1, accumulatedText: 'content' });
  });
});

// ============================================================================
// onError callback
// ============================================================================

describe('useA2AStreaming — onError', () => {
  let cfg: () => ReturnType<typeof captureClientConfig>['cfg'] extends () => infer R ? R : never;

  beforeEach(() => {
    jest.clearAllMocks();
    ({ cfg } = captureClientConfig());
  });

  it('called with the error when A2AClient fires onError', async () => {
    const onError = jest.fn();
    const err = new Error('stream interrupted');
    mockSendMessage.mockImplementation(async () => {
      cfg().onError(err);
      return { read: () => Promise.resolve({ done: true }) };
    });

    const { result } = renderHook(() =>
      useA2AStreaming({ endpoint: 'http://localhost:8000', onError })
    );
    await act(async () => { await result.current.sendMessage('q'); });

    expect(onError).toHaveBeenCalledWith(err);
  });

  it('called with thrown error when sendMessage rejects', async () => {
    const onError = jest.fn();
    const err = new Error('network error');
    mockSendMessage.mockRejectedValue(err);

    const { result } = renderHook(() =>
      useA2AStreaming({ endpoint: 'http://localhost:8000', onError })
    );
    await act(async () => { await result.current.sendMessage('q'); });

    expect(onError).toHaveBeenCalledWith(err);
  });
});

// ============================================================================
// Content accumulation
// ============================================================================

describe('useA2AStreaming — content accumulation', () => {
  let cfg: () => ReturnType<typeof captureClientConfig>['cfg'] extends () => infer R ? R : never;

  beforeEach(() => {
    jest.clearAllMocks();
    ({ cfg } = captureClientConfig());
    mockSendMessage.mockResolvedValue({ read: () => Promise.resolve({ done: true }) });
  });

  it('streaming_result chunks are appended to accumulatedText', async () => {
    mockSendMessage.mockImplementation(async () => {
      cfg().onEvent(artifactEvent('streaming_result', 'Hello '));
      cfg().onEvent(artifactEvent('streaming_result', 'World'));
      return { read: () => Promise.resolve({ done: true }) };
    });

    const { result } = renderHook(() =>
      useA2AStreaming({ endpoint: 'http://localhost:8000', updateThrottleMs: 0 })
    );
    await act(async () => { await result.current.sendMessage('q'); });

    expect(result.current.stateRef.current.accumulatedText).toBe('Hello World');
  });

  it('shouldAppend=false replaces accumulatedText', async () => {
    mockSendMessage.mockImplementation(async () => {
      cfg().onEvent(artifactEvent('streaming_result', 'Old chunk', { shouldAppend: true }));
      cfg().onEvent(artifactEvent('streaming_result', 'Fresh start', { shouldAppend: false }));
      return { read: () => Promise.resolve({ done: true }) };
    });

    const { result } = renderHook(() =>
      useA2AStreaming({ endpoint: 'http://localhost:8000', updateThrottleMs: 0 })
    );
    await act(async () => { await result.current.sendMessage('q'); });

    expect(result.current.stateRef.current.accumulatedText).toBe('Fresh start');
  });

  it('tool_notification_start events do not accumulate text', async () => {
    mockSendMessage.mockImplementation(async () => {
      cfg().onEvent(artifactEvent('tool_notification_start', 'Calling tool'));
      return { read: () => Promise.resolve({ done: true }) };
    });

    const { result } = renderHook(() =>
      useA2AStreaming({ endpoint: 'http://localhost:8000', updateThrottleMs: 0 })
    );
    await act(async () => { await result.current.sendMessage('q'); });

    expect(result.current.stateRef.current.accumulatedText).toBe('');
  });

  it('execution_plan_update events do not accumulate text', async () => {
    mockSendMessage.mockImplementation(async () => {
      cfg().onEvent(artifactEvent('execution_plan_update', 'Plan updated'));
      return { read: () => Promise.resolve({ done: true }) };
    });

    const { result } = renderHook(() =>
      useA2AStreaming({ endpoint: 'http://localhost:8000', updateThrottleMs: 0 })
    );
    await act(async () => { await result.current.sendMessage('q'); });

    expect(result.current.stateRef.current.accumulatedText).toBe('');
  });

  it('tool_start event type does not accumulate text', async () => {
    mockSendMessage.mockImplementation(async () => {
      cfg().onEvent({ id: 'e1', timestamp: 0, type: 'tool_start', artifact: { name: 'tool_notification_start' }, displayContent: 'Tool running' } as unknown);
      return { read: () => Promise.resolve({ done: true }) };
    });

    const { result } = renderHook(() =>
      useA2AStreaming({ endpoint: 'http://localhost:8000', updateThrottleMs: 0 })
    );
    await act(async () => { await result.current.sendMessage('q'); });

    expect(result.current.stateRef.current.accumulatedText).toBe('');
  });

  it('no further accumulation after hasReceivedCompleteResult=true', async () => {
    mockSendMessage.mockImplementation(async () => {
      cfg().onEvent(artifactEvent('final_result', 'Final answer'));
      cfg().onEvent(artifactEvent('streaming_result', ' trailing chunk'));
      return { read: () => Promise.resolve({ done: true }) };
    });

    const { result } = renderHook(() =>
      useA2AStreaming({ endpoint: 'http://localhost:8000', updateThrottleMs: 0 })
    );
    await act(async () => { await result.current.sendMessage('q'); });

    expect(result.current.stateRef.current.accumulatedText).toBe('Final answer');
  });

  it('onContentUpdate fires with accumulated text when content arrives', async () => {
    const onContentUpdate = jest.fn();
    mockSendMessage.mockImplementation(async () => {
      cfg().onEvent(artifactEvent('streaming_result', 'some content'));
      return { read: () => Promise.resolve({ done: true }) };
    });

    const { result } = renderHook(() =>
      useA2AStreaming({ endpoint: 'http://localhost:8000', onContentUpdate, updateThrottleMs: 0 })
    );
    await act(async () => { await result.current.sendMessage('q'); });

    expect(onContentUpdate).toHaveBeenCalledWith('some content', expect.objectContaining({ accumulatedText: 'some content' }));
  });

  it('eventCount increments for every received event', async () => {
    mockSendMessage.mockImplementation(async () => {
      cfg().onEvent(artifactEvent('streaming_result', 'a'));
      cfg().onEvent(artifactEvent('streaming_result', 'b'));
      cfg().onEvent(artifactEvent('streaming_result', 'c'));
      return { read: () => Promise.resolve({ done: true }) };
    });

    const { result } = renderHook(() =>
      useA2AStreaming({ endpoint: 'http://localhost:8000', updateThrottleMs: 0 })
    );
    await act(async () => { await result.current.sendMessage('q'); });

    expect(result.current.stateRef.current.eventCount).toBe(3);
  });
});

// ============================================================================
// Task and context ID tracking
// ============================================================================

describe('useA2AStreaming — task and context ID tracking', () => {
  let cfg: () => ReturnType<typeof captureClientConfig>['cfg'] extends () => infer R ? R : never;

  beforeEach(() => {
    jest.clearAllMocks();
    ({ cfg } = captureClientConfig());
  });

  it('taskId from event is stored in stateRef', async () => {
    mockSendMessage.mockImplementation(async () => {
      cfg().onEvent({ id: 'e1', timestamp: 0, type: 'status', taskId: 'task-abc-123', displayContent: '' } as unknown);
      return { read: () => Promise.resolve({ done: true }) };
    });

    const { result } = renderHook(() =>
      useA2AStreaming({ endpoint: 'http://localhost:8000' })
    );
    await act(async () => { await result.current.sendMessage('q'); });

    expect(result.current.stateRef.current.taskId).toBe('task-abc-123');
  });

  it('contextId from event is stored in stateRef', async () => {
    mockSendMessage.mockImplementation(async () => {
      cfg().onEvent({ id: 'e1', timestamp: 0, type: 'status', contextId: 'ctx-xyz-789', displayContent: '' } as unknown);
      return { read: () => Promise.resolve({ done: true }) };
    });

    const { result } = renderHook(() =>
      useA2AStreaming({ endpoint: 'http://localhost:8000' })
    );
    await act(async () => { await result.current.sendMessage('q'); });

    expect(result.current.stateRef.current.contextId).toBe('ctx-xyz-789');
  });
});

// ============================================================================
// Status events
// ============================================================================

describe('useA2AStreaming — status-update events', () => {
  let cfg: () => ReturnType<typeof captureClientConfig>['cfg'] extends () => infer R ? R : never;

  beforeEach(() => {
    jest.clearAllMocks();
    ({ cfg } = captureClientConfig());
  });

  it('final status event does not update accumulatedText or fire onContentUpdate', async () => {
    const onContentUpdate = jest.fn();
    mockSendMessage.mockImplementation(async () => {
      cfg().onEvent({ id: 'e1', timestamp: 0, type: 'status', isFinal: true, displayContent: 'Completed' } as unknown);
      return { read: () => Promise.resolve({ done: true }) };
    });

    const { result } = renderHook(() =>
      useA2AStreaming({ endpoint: 'http://localhost:8000', onContentUpdate, updateThrottleMs: 0 })
    );
    await act(async () => { await result.current.sendMessage('q'); });

    expect(onContentUpdate).not.toHaveBeenCalled();
    expect(result.current.stateRef.current.accumulatedText).toBe('');
  });

  it('onEvent callback fires for status events too', async () => {
    const onEvent = jest.fn();
    mockSendMessage.mockImplementation(async () => {
      cfg().onEvent({ id: 'e1', timestamp: 0, type: 'status', isFinal: true, displayContent: '' } as unknown);
      return { read: () => Promise.resolve({ done: true }) };
    });

    const { result } = renderHook(() =>
      useA2AStreaming({ endpoint: 'http://localhost:8000', onEvent })
    );
    await act(async () => { await result.current.sendMessage('q'); });

    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'status', isFinal: true }),
      expect.any(Object)
    );
  });
});
