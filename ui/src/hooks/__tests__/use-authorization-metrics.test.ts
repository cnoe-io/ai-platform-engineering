import { act, renderHook, waitFor } from "@testing-library/react";
import {
  type AuthorizationMetricsRange,
  type AuthorizationStatsResponse,
  useAuthorizationMetrics,
} from "../use-authorization-metrics";

const RESPONSE: AuthorizationStatsResponse = {
  decisions: {
    allow: 8,
    byReason: [{ reason: "OK", count: 8 }],
    deny: 2,
    denyRate: 0.2,
    policyDeny: 2,
    policyDenyRate: 0.2,
    topDenied: [{ resource: "resource:primary", count: 2 }],
    total: 10,
    truncated: false,
    unavailable: 0,
    unavailableRate: 0,
  },
  persistence: true,
  window: "86400s",
};

function okResponse(body: unknown = RESPONSE): Promise<Response> {
  return Promise.resolve({
    json: async () => body,
    ok: true,
    status: 200,
  } as Response);
}

describe("useAuthorizationMetrics", () => {
  beforeEach(() => {
    (global.fetch as jest.Mock) = jest.fn(() => okResponse());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("loads rolling presets and exposes an initial loading state", async () => {
    const range: AuthorizationMetricsRange = { label: "24 hours", seconds: 86_400 };
    const { result } = renderHook(() => useAuthorizationMetrics(range, { refreshInterval: 0 }));

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).toEqual(RESPONSE);
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/admin/authz/stats?rangeSeconds=86400",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("refetches with exact custom bounds when the shared filter changes", async () => {
    const initial: AuthorizationMetricsRange = { label: "1 hour", seconds: 3_600 };
    const custom: AuthorizationMetricsRange = {
      end: "1780444800",
      label: "custom",
      seconds: 172_800,
      start: "1780272000",
    };
    const { rerender } = renderHook(
      ({ range }) => useAuthorizationMetrics(range, { refreshInterval: 0 }),
      { initialProps: { range: initial } },
    );
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

    rerender({ range: custom });

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      "/api/admin/authz/stats?from=1780272000&to=1780444800",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    ));
  });

  it("keeps the last good data visible when a refresh fails", async () => {
    const range: AuthorizationMetricsRange = { label: "24 hours", seconds: 86_400 };
    const { result } = renderHook(() => useAuthorizationMetrics(range, { refreshInterval: 0 }));
    await waitFor(() => expect(result.current.data).toEqual(RESPONSE));
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error("refresh failed"));

    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.data).toEqual(RESPONSE);
    expect(result.current.error).toBe("refresh failed");
    expect(result.current.loading).toBe(false);
  });
});
