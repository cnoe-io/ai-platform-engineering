import { render, screen, waitFor } from "@testing-library/react";
import { TextDecoder, TextEncoder } from "node:util";
import { ReadableStream } from "node:stream/web";
import type { ReactNode } from "react";

import { useTomeChatStore } from "@/store/tome-chat-store";
import { ChatPanel } from "../ChatPanel";

Object.assign(global, { TextDecoder, TextEncoder, ReadableStream });

jest.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));
jest.mock("@/components/chat/AuditNotice", () => ({
  AuditNotice: () => <span>Audit notice</span>,
}));
jest.mock("@/components/chat/MessageActions", () => ({
  MessageActions: () => null,
}));
jest.mock("@/components/shared/timeline", () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <span>{content}</span>,
}));
jest.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

describe("ChatPanel full-reload recovery", () => {
  beforeEach(() => {
    useTomeChatStore.getState().reset();
    jest.clearAllMocks();
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/chat/history")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              session: {
                id: "00000000-0000-4000-8000-000000000001",
                sdkSessionId: null,
                userId: "test-user@example.com",
              },
              messages: [
                { role: "user", content: "Summarize this project" },
              ],
              activeRun: {
                id: "run-1",
                sessionId: "00000000-0000-4000-8000-000000000001",
              },
              readOnly: false,
              sessionOwner: "test-user@example.com",
            },
          }),
        } as Response;
      }
      if (url.endsWith("/chat/runs/run-1")) {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                'id: 1\nevent: token\ndata: {"text":"Recovered response"}\n\n' +
                  'id: 2\nevent: done\ndata: {"model":"example-model"}\n\n',
              ),
            );
            controller.close();
          },
        });
        return { ok: true, status: 200, body: stream } as Response;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as jest.Mock;
  });

  it("discovers, replays, and completes an active server run", async () => {
    render(<ChatPanel slug="example-project" />);

    expect(await screen.findByText("Summarize this project")).toBeInTheDocument();
    expect(await screen.findByText("Recovered response")).toBeInTheDocument();
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/tome/projects/example-project/chat/runs/run-1",
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });
  });

  it("reattaches again after navigating away during reload recovery", async () => {
    let runRequests = 0;
    global.fetch = jest.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/chat/history")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: {
                session: {
                  id: "00000000-0000-4000-8000-000000000001",
                  sdkSessionId: null,
                  userId: "test-user@example.com",
                },
                messages: [{ role: "user", content: "Summarize this project" }],
                activeRun: {
                  id: "run-1",
                  sessionId: "00000000-0000-4000-8000-000000000001",
                },
                readOnly: false,
                sessionOwner: "test-user@example.com",
              },
            }),
          } as Response;
        }
        if (url.endsWith("/chat/runs/run-1")) {
          runRequests += 1;
          if (runRequests === 1) {
            const stream = new ReadableStream<Uint8Array>({
              start(controller) {
                init?.signal?.addEventListener("abort", () => {
                  controller.error(new DOMException("Aborted", "AbortError"));
                });
              },
            });
            return { ok: true, status: 200, body: stream } as Response;
          }
          const stream = new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode(
                  'id: 1\nevent: token\ndata: {"text":"Recovered after navigation"}\n\n' +
                    'id: 2\nevent: done\ndata: {}\n\n',
                ),
              );
              controller.close();
            },
          });
          return { ok: true, status: 200, body: stream } as Response;
        }
        throw new Error(`Unexpected fetch: ${url}`);
      },
    ) as jest.Mock;

    const firstRender = render(<ChatPanel slug="example-project" />);
    await waitFor(() => expect(runRequests).toBe(1));
    expect(
      useTomeChatStore.getState().chats["example-project:active"]?.resumeRunId,
    ).toBe("run-1");

    firstRender.unmount();
    render(<ChatPanel slug="example-project" />);

    expect(await screen.findByText("Recovered after navigation")).toBeInTheDocument();
    await waitFor(() => {
      const chat = useTomeChatStore.getState().chats["example-project:active"];
      expect(runRequests).toBe(2);
      expect(chat?.streaming).toBe(false);
      expect(chat?.resumeRunId).toBeNull();
    });
  });
});
