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
