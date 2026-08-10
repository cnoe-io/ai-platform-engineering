/**
 * Tests for useSkillAiAssist — drives the streaming AI flow with a fake
 * `fetch` returning a controlled SSE body.
 */

import React from "react";
import { renderHook, act, waitFor } from "@testing-library/react";

import {
  useSkillAiAssist,
  ENHANCE_PRESETS,
} from "../use-skill-ai-assist";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock("next-auth/react", () => ({
  useSession: () => ({ data: null }),
}));

jest.mock("@/lib/config", () => ({
  getConfig: () => false, // ssoEnabled = false; no Authorization header
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Minimal stand-in for the subset of `Response` the hook touches:
 * `.ok`, `.statusText`, `.body.getReader()` (single-pass), `.json()`.
 */
function makeSSEResponse(events: Array<Record<string, unknown>>): unknown {
  const encoder = new TextEncoder();
  const chunks = events.map((ev) => encoder.encode(`data: ${JSON.stringify(ev)}\n`));
  let i = 0;
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => ({}),
    body: {
      getReader() {
        return {
          read: async () => {
            if (i >= chunks.length) return { done: true, value: undefined };
            return { done: false, value: chunks[i++] };
          },
        };
      },
    },
  };
}

/** Same shape but for a non-OK HTTP error. */
function makeHttpErrorResponse(payload: unknown, status = 500): unknown {
  return {
    ok: false,
    status,
    statusText: "Server Error",
    json: async () => payload,
    body: null,
  };
}

function setup(overrides?: {
  current?: string;
  onApply?: (next: string, parsed: unknown) => void;
}) {
  const onApply = overrides?.onApply ?? jest.fn();
  let current = overrides?.current ?? "";
  const setCurrent = (v: string) => {
    current = v;
  };
  const { result } = renderHook(() =>
    useSkillAiAssist({
      getCurrentContent: () => current,
      onApply: (next, parsed) => {
        setCurrent(next);
        onApply(next, parsed);
      },
    }),
  );
  return { result, onApply, getCurrent: () => current };
}

beforeEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).fetch = jest.fn();
});

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

describe("useSkillAiAssist — initial state", () => {
  it("starts idle with no error or log", () => {
    const { result } = setup();
    expect(result.current.status).toBe("idle");
    expect(result.current.isBusy).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.cancelled).toBe(false);
    expect(result.current.debugLog).toEqual([]);
    expect(result.current.promptSent).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Generate
// ---------------------------------------------------------------------------

describe("useSkillAiAssist — generate", () => {
  it("calls /api/skills/generate with the right shape and applies the result", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global.fetch as any).mockResolvedValueOnce(
      makeSSEResponse([
        { type: "content", text: "---\nname: gen\n---\nbody " },
        { type: "content", text: "more body" },
      ]),
    );
    const { result, onApply } = setup();
    await act(async () => {
      await result.current.generate("write a triage skill");
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe("/api/skills/generate");
    const body = JSON.parse((init.body as string) ?? "{}");
    expect(body).toMatchObject({
      type: "generate",
      description: "write a triage skill",
    });
    expect(onApply).toHaveBeenCalledTimes(1);
    const [appliedContent, parsed] = onApply.mock.calls[0];
    expect(appliedContent).toContain("name: gen");
    expect(appliedContent).toContain("body more body");
    expect(parsed).toMatchObject({ name: "gen" });
    expect(result.current.status).toBe("idle");
  });

  it("ignores empty descriptions", async () => {
    const { result } = setup();
    await act(async () => {
      await result.current.generate("   ");
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("surfaces SSE error events as `error`", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global.fetch as any).mockResolvedValueOnce(
      makeSSEResponse([
        { type: "content", text: "partial" },
        { type: "error", message: "model exploded" },
      ]),
    );
    const { result, onApply } = setup();
    await act(async () => {
      await result.current.generate("hi");
    });
    expect(onApply).not.toHaveBeenCalled();
    expect(result.current.error?.message).toBe("model exploded");
  });

  it("surfaces non-OK HTTP responses as `error`", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global.fetch as any).mockResolvedValueOnce(
      makeHttpErrorResponse({ error: "server boom" }, 500),
    );
    const { result } = setup();
    await act(async () => {
      await result.current.generate("hi");
    });
    expect(result.current.error?.message).toBe("server boom");
  });

  it("rolls back to the snapshot on cancel", async () => {
    // Slow-streaming response that never closes until aborted.
    const aborted = new Promise<Response>((_, reject) => {
      // signal will reject this when cancel() is called via fetch's
      // AbortController.
      const interval = setInterval(() => {}, 10000);
      // Clean up if test ends
      setTimeout(() => clearInterval(interval), 5000);
      // Ignore intentional cleanup
      void reject;
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global.fetch as any).mockImplementationOnce(
      (_url: string, init: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        });
      },
    );
    const { result, onApply } = setup({ current: "ORIGINAL CONTENT" });

    // Start generate but don't await — it should hang until cancel.
    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = result.current.generate("hi");
    });
    await act(async () => {
      result.current.cancel();
      await pending;
    });
    // onApply should be called once with the snapshot (ORIGINAL CONTENT)
    expect(onApply).toHaveBeenCalledWith("ORIGINAL CONTENT", null);
    expect(result.current.cancelled).toBe(true);
    void aborted; // silence
  });
});

// ---------------------------------------------------------------------------
// Enhance
// ---------------------------------------------------------------------------

describe("useSkillAiAssist — enhance", () => {
  it("requires existing SKILL.md content", async () => {
    const { result } = setup({ current: "" });
    await act(async () => {
      await result.current.enhance({ instruction: "do thing" });
    });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(result.current.error?.message).toMatch(
      /Add SKILL\.md content/i,
    );
  });

  it("requires either an instruction or at least one preset", async () => {
    const { result } = setup({ current: "existing body" });
    await act(async () => {
      await result.current.enhance({});
    });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(result.current.error?.message).toMatch(/Select at least one/i);
  });

  it("composes preset instructions into the body", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global.fetch as any).mockResolvedValueOnce(
      makeSSEResponse([{ type: "content", text: "ok" }]),
    );
    const { result } = setup({ current: "existing body" });
    await act(async () => {
      await result.current.enhance({
        presetLabels: [ENHANCE_PRESETS[0].label, ENHANCE_PRESETS[2].label],
        customInstruction: "and also be funny",
      });
    });
    const init = (global.fetch as jest.Mock).mock.calls[0][1];
    const body = JSON.parse(init.body);
    expect(body.type).toBe("enhance");
    expect(body.current_content).toBe("existing body");
    expect(body.instruction).toContain(ENHANCE_PRESETS[0].instruction);
    expect(body.instruction).toContain(ENHANCE_PRESETS[2].instruction);
    expect(body.instruction).toContain("and also be funny");
  });

  it("prefers an explicit instruction over presets when both supplied", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global.fetch as any).mockResolvedValueOnce(
      makeSSEResponse([{ type: "content", text: "ok" }]),
    );
    const { result } = setup({ current: "x" });
    await act(async () => {
      await result.current.enhance({
        instruction: "literal instruction",
        presetLabels: [ENHANCE_PRESETS[0].label],
      });
    });
    const init = (global.fetch as jest.Mock).mock.calls[0][1];
    const body = JSON.parse(init.body);
    expect(body.instruction).toBe("literal instruction");
  });
});

// ---------------------------------------------------------------------------
// Debug log
// ---------------------------------------------------------------------------

describe("useSkillAiAssist — debug", () => {
  it("populates debug log and promptSent during a run", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global.fetch as any).mockResolvedValueOnce(
      makeSSEResponse([
        { type: "content", text: "---\nname: x\n---\nb" },
      ]),
    );
    const { result } = setup();
    await act(async () => {
      await result.current.generate("yo");
    });
    await waitFor(() => {
      expect(result.current.debugLog.length).toBeGreaterThan(0);
    });
    expect(result.current.promptSent).toBe("[generate] yo");
  });

  it("resetDebug() clears the log and promptSent", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global.fetch as any).mockResolvedValueOnce(
      makeSSEResponse([{ type: "content", text: "---\nname: x\n---\nb" }]),
    );
    const { result } = setup();
    await act(async () => {
      await result.current.generate("yo");
    });
    expect(result.current.debugLog.length).toBeGreaterThan(0);
    act(() => result.current.resetDebug());
    expect(result.current.debugLog).toEqual([]);
    expect(result.current.promptSent).toBe("");
  });
});

void React;
