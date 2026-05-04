/**
 * AiAssistButton — popover smoke test. Mocks `next-auth` and `fetch` so we
 * can drive an SSE stream end-to-end and assert the result wires into the
 * `onApply` callback.
 */

import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

jest.mock("next-auth/react", () => ({
  useSession: () => ({ data: null, status: "unauthenticated" }),
}));
jest.mock("@/lib/config", () => ({
  getConfig: (key: string) => (key === "ssoEnabled" ? false : undefined),
}));

import { AiAssistButton } from "../AiAssistButton";

/**
 * Mirror the helper used by use-skill-ai-assist.test.tsx — JSDOM doesn't
 * ship `Response` / `ReadableStream`, so we hand-roll the subset the hook
 * actually touches (`ok`, `statusText`, `json`, `body.getReader()`).
 */
function sseStream(events: Array<Record<string, unknown>>): unknown {
  const encoder = new TextEncoder();
  const chunks = events.map((ev) =>
    encoder.encode(`data: ${JSON.stringify(ev)}\n`),
  );
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

function jsonError(payload: unknown, status = 429): unknown {
  return {
    ok: false,
    status,
    statusText: "Too Many Requests",
    json: async () => payload,
    body: null,
  };
}

const fetchSpy = jest.spyOn(globalThis, "fetch") as unknown as jest.Mock;

afterEach(() => {
  fetchSpy.mockReset();
});

describe("AiAssistButton", () => {
  it("opens the popover on click and shows a Suggest button", async () => {
    render(
      <AiAssistButton
        task="describe-skill"
        getContext={() => ({})}
        onApply={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("ai-assist-trigger"));
    expect(await screen.findByTestId("ai-assist-popover")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Suggest/i }),
    ).toBeInTheDocument();
  });

  it("streams content events and applies the result", async () => {
    const onApply = jest.fn();
    fetchSpy.mockResolvedValueOnce(
      sseStream([
        {
          type: "start",
          rate_limit: { limit: 30, remaining: 29, window_ms: 300000 },
        },
        { type: "content", text: "Hello, " },
        { type: "content", text: "world." },
        { type: "done" },
      ]),
    );

    render(
      <AiAssistButton
        task="describe-skill"
        getContext={() => ({ name: "demo" })}
        onApply={onApply}
      />,
    );

    fireEvent.click(screen.getByTestId("ai-assist-trigger"));
    fireEvent.change(screen.getByLabelText(/AI Assist instruction/i), {
      target: { value: "make it punchy" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Suggest/i }));

    const proposal = await screen.findByTestId("ai-assist-proposal");
    await waitFor(() => expect(proposal).toHaveTextContent("Hello, world."));

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/ai/assist",
      expect.objectContaining({
        method: "POST",
      }),
    );
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toEqual({
      task: "describe-skill",
      context: { name: "demo", instruction: "make it punchy" },
    });

    fireEvent.click(screen.getByRole("button", { name: /^Apply/i }));
    await waitFor(() => expect(onApply).toHaveBeenCalledWith("Hello, world."));
  });

  it("renders a diff when the field already has content", async () => {
    fetchSpy.mockResolvedValueOnce(
      sseStream([
        { type: "start" },
        { type: "content", text: "new line one\nnew line two" },
        { type: "done" },
      ]),
    );

    render(
      <AiAssistButton
        task="describe-skill"
        getContext={() => ({ current_value: "old line one\nold line two" })}
        onApply={() => {}}
      />,
    );

    fireEvent.click(screen.getByTestId("ai-assist-trigger"));
    fireEvent.click(screen.getByRole("button", { name: /Suggest/i }));

    await screen.findByTestId("ai-assist-diff");
    const diff = screen.getByTestId("ai-assist-diff");
    expect(diff.textContent).toContain("old line one");
    expect(diff.textContent).toContain("new line one");
  });

  it("surfaces an error event from the stream", async () => {
    fetchSpy.mockResolvedValueOnce(
      sseStream([
        { type: "start" },
        { type: "error", message: "model unavailable" },
      ]),
    );

    render(
      <AiAssistButton
        task="describe-skill"
        getContext={() => ({})}
        onApply={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("ai-assist-trigger"));
    fireEvent.click(screen.getByRole("button", { name: /Suggest/i }));

    await waitFor(() =>
      expect(screen.getByText(/model unavailable/i)).toBeInTheDocument(),
    );
  });

  it("uses resolveTask() to switch tasks per call (generate ↔ enhance)", async () => {
    fetchSpy.mockResolvedValueOnce(
      sseStream([{ type: "start" }, { type: "content", text: "ok" }, { type: "done" }]),
    );

    const { rerender } = render(
      <AiAssistButton
        task="skill-md"
        resolveTask={(ctx) =>
          (ctx.current_value ?? "").length > 0 ? "enhance-skill-md" : "skill-md"
        }
        getContext={() => ({ current_value: "" })}
        onApply={() => {}}
      />,
    );

    fireEvent.click(screen.getByTestId("ai-assist-trigger"));
    fireEvent.click(screen.getByRole("button", { name: /Suggest/i }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    let body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.task).toBe("skill-md");

    fetchSpy.mockResolvedValueOnce(
      sseStream([{ type: "start" }, { type: "content", text: "ok" }, { type: "done" }]),
    );

    rerender(
      <AiAssistButton
        task="skill-md"
        resolveTask={(ctx) =>
          (ctx.current_value ?? "").length > 0 ? "enhance-skill-md" : "skill-md"
        }
        getContext={() => ({ current_value: "existing content" })}
        onApply={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Rerun|Suggest/i }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
    body = JSON.parse((fetchSpy.mock.calls[1][1] as RequestInit).body as string);
    expect(body.task).toBe("enhance-skill-md");
  });

  it("surfaces a 429 rate-limit response", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonError({
        success: false,
        error: 'Rate limit exceeded for task "describe-skill". Try again in 42s.',
      }),
    );

    render(
      <AiAssistButton
        task="describe-skill"
        getContext={() => ({})}
        onApply={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("ai-assist-trigger"));
    fireEvent.click(screen.getByRole("button", { name: /Suggest/i }));

    await waitFor(() =>
      expect(screen.getByText(/Rate limit exceeded/i)).toBeInTheDocument(),
    );
  });
});
