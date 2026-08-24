/**
 * @jest-environment jsdom
 */

import { act,renderHook,waitFor } from "@testing-library/react";

import {
  publishGlobalSearchPlacement,
  useGlobalSearchPlacement,
} from "../use-global-search-placement";

jest.mock("@/lib/config",() => ({
  config: { globalSearchPlacement: "sidebar" },
}));

describe("useGlobalSearchPlacement",() => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: { global_search_placement: "header-center" },
      }),
    });
  });

  it("starts with the deployment default and applies the platform override",async () => {
    const { result } = renderHook(() => useGlobalSearchPlacement());

    expect(result.current).toBe("sidebar");
    await waitFor(() => expect(result.current).toBe("header-center"));
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/admin/platform-config",
      { credentials: "same-origin" },
    );
  });

  it("updates immediately when an admin changes the placement",async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false });
    const { result } = renderHook(() => useGlobalSearchPlacement());

    act(() => publishGlobalSearchPlacement("header-right"));

    expect(result.current).toBe("header-right");
  });
});
