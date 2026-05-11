/**
 * @jest-environment jsdom
 *
 * useAgenticSdlcStream wraps EventSource with the contracted reconnect
 * policy. Tests use a tiny fake EventSource to drive the lifecycle
 * deterministically -- no timers, no real network.
 */
import { act, renderHook } from "@testing-library/react";
import { useAgenticSdlcStream } from "@/hooks/use-agentic-sdlc-stream";

interface ListenerMap {
  [event: string]: Array<(e: MessageEvent | Event) => void>;
}

class FakeEventSource {
  static last: FakeEventSource | null = null;
  static instances: FakeEventSource[] = [];

  url: string;
  readyState = 0;
  onerror: ((e: Event) => void) | null = null;
  onopen: ((e: Event) => void) | null = null;
  private listeners: ListenerMap = {};

  constructor(url: string) {
    this.url = url;
    FakeEventSource.last = this;
    FakeEventSource.instances.push(this);
  }

  addEventListener(name: string, fn: (e: MessageEvent | Event) => void) {
    if (!this.listeners[name]) this.listeners[name] = [];
    this.listeners[name].push(fn);
  }

  emit(name: string, data: unknown) {
    const ev = new MessageEvent(name, { data: JSON.stringify(data) });
    (this.listeners[name] ?? []).forEach((fn) => fn(ev));
  }

  emitOpen() {
    const ev = new Event("open");
    if (this.onopen) this.onopen(ev);
    (this.listeners["open"] ?? []).forEach((fn) => fn(ev));
  }

  emitError() {
    if (this.onerror) this.onerror(new Event("error"));
  }

  close() {
    this.readyState = 2;
  }
}

const originalEventSource = (globalThis as { EventSource?: unknown })
  .EventSource;

beforeAll(() => {
  (globalThis as { EventSource?: unknown }).EventSource = FakeEventSource;
});

afterAll(() => {
  if (originalEventSource === undefined) {
    delete (globalThis as { EventSource?: unknown }).EventSource;
  } else {
    (globalThis as { EventSource?: unknown }).EventSource = originalEventSource;
  }
});

beforeEach(() => {
  FakeEventSource.last = null;
  FakeEventSource.instances = [];
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("useAgenticSdlcStream", () => {
  it("opens an EventSource against the URL and reports status=open after onopen", () => {
    const onEvent = jest.fn();
    const { result } = renderHook(() =>
      useAgenticSdlcStream({ url: "/sse", onEvent }),
    );
    expect(FakeEventSource.last?.url).toBe("/sse");
    expect(result.current.status).toBe("connecting");

    act(() => FakeEventSource.last!.emitOpen());
    expect(result.current.status).toBe("open");
    expect(result.current.retryCount).toBe(0);
  });

  it("dispatches known events to onEvent with parsed JSON data", () => {
    const onEvent = jest.fn();
    renderHook(() => useAgenticSdlcStream({ url: "/sse", onEvent }));
    act(() => FakeEventSource.last!.emitOpen());

    act(() =>
      FakeEventSource.last!.emit("artifact_upserted", {
        artifact_id: "PR_1",
      }),
    );
    expect(onEvent).toHaveBeenCalledWith({
      event: "artifact_upserted",
      data: { artifact_id: "PR_1" },
    });
  });

  it("ignores malformed JSON without crashing the stream", () => {
    const onEvent = jest.fn();
    renderHook(() => useAgenticSdlcStream({ url: "/sse", onEvent }));
    act(() => FakeEventSource.last!.emitOpen());

    act(() => {
      const ev = new MessageEvent("artifact_upserted", { data: "not-json" });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const listeners = (FakeEventSource.last as any).listeners[
        "artifact_upserted"
      ];
      listeners.forEach((fn: (e: Event) => void) => fn(ev));
    });
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("reconnects on error using the documented exponential backoff", () => {
    const onEvent = jest.fn();
    renderHook(() => useAgenticSdlcStream({ url: "/sse", onEvent }));
    act(() => FakeEventSource.last!.emitOpen());
    expect(FakeEventSource.instances.length).toBe(1);

    act(() => FakeEventSource.last!.emitError());
    // First retry scheduled at 2s (next = 1, backoff = 2^1 * 1000)
    expect(FakeEventSource.instances.length).toBe(1);
    act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(FakeEventSource.instances.length).toBe(2);

    // Second retry scheduled at 4s
    act(() => FakeEventSource.last!.emitError());
    act(() => {
      jest.advanceTimersByTime(4000);
    });
    expect(FakeEventSource.instances.length).toBe(3);
  });

  it("stops trying after a terminal error code (feature_disabled)", () => {
    const onEvent = jest.fn();
    renderHook(() => useAgenticSdlcStream({ url: "/sse", onEvent }));
    act(() => FakeEventSource.last!.emitOpen());
    act(() =>
      FakeEventSource.last!.emit("error", {
        code: "feature_disabled",
        message: "off",
      }),
    );

    // Despite a follow-up onerror, no new EventSource is created.
    act(() => FakeEventSource.last!.emitError());
    act(() => {
      jest.advanceTimersByTime(60_000);
    });
    expect(FakeEventSource.instances.length).toBe(1);
  });

  it("closes the stream when url becomes null and re-opens when set again", () => {
    const onEvent = jest.fn();
    const { rerender } = renderHook(
      ({ url }: { url: string | null }) =>
        useAgenticSdlcStream({ url, onEvent }),
      { initialProps: { url: "/sse" as string | null } },
    );
    expect(FakeEventSource.instances.length).toBe(1);

    rerender({ url: null });
    expect(FakeEventSource.last!.readyState).toBe(2);

    rerender({ url: "/sse-2" });
    expect(FakeEventSource.instances.length).toBe(2);
    expect(FakeEventSource.last!.url).toBe("/sse-2");
  });
});
