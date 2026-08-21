import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TextDecoder, TextEncoder } from "node:util";
import type { ReactNode } from "react";

import { useTomeChatStore } from "@/store/tome-chat-store";
import { ChatPanel } from "../ChatPanel";

Object.assign(global, { TextDecoder, TextEncoder });

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

describe("ChatPanel stream session", () => {
  beforeEach(() => {
    useTomeChatStore.getState().reset();
    jest.clearAllMocks();
  });

  it("keeps receiving a TOME response while the panel is unmounted", async () => {
    let releaseChunk: ((result: ReadableStreamReadResult<Uint8Array>) => void) | null = null;
    let firstRead = true;
    const stream = {
      getReader: () => ({
        read: () => {
          if (!firstRead) return Promise.resolve({ done: true, value: undefined });
          firstRead = false;
          return new Promise<ReadableStreamReadResult<Uint8Array>>((resolve) => {
            releaseChunk = resolve;
          });
        },
      }),
    } as ReadableStream<Uint8Array>;

    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/chat/history") && !init?.method) {
        return {
          ok: true,
          json: async () => ({
            data: {
              session: null,
              messages: [],
              readOnly: false,
              sessionOwner: null,
            },
          }),
        } as Response;
      }
      if (url.endsWith("/chat/history") && init?.method === "POST") {
        return {
          ok: true,
          json: async () => ({ data: { sessionId: "00000000-0000-4000-8000-000000000001" } }),
        } as Response;
      }
      if (url.endsWith("/chat") && init?.method === "POST") {
        return {
          ok: true,
          body: stream,
          headers: new Headers({
            "X-Tome-Session-Id": "00000000-0000-4000-8000-000000000001",
          }),
        } as Response;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as jest.Mock;

    const firstRender = render(
      <ChatPanel slug="example-project" projectTitle="Example Project" />,
    );
    const composer = await screen.findByPlaceholderText("Ask about this project…");
    fireEvent.change(composer, { target: { value: "Summarize this project" } });
    fireEvent.click(screen.getByTitle("Send"));

    await waitFor(() => {
      const chat = useTomeChatStore.getState().chats["example-project:active"];
      expect(chat?.streaming).toBe(true);
      expect(chat?.streamDestination).toEqual({
        href: "/projects/example-project/tome",
        label: "Example Project",
      });
    });

    firstRender.unmount();

    await act(async () => {
      const encoder = new TextEncoder();
      releaseChunk!({
        done: false,
        value: encoder.encode(
          'event: session\ndata: {"session_id":"sdk-session"}\n\n' +
            'event: token\ndata: {"text":"Response continues"}\n\n' +
            'event: done\ndata: {}\n\n',
        ),
      });
    });

    await waitFor(() => {
      expect(useTomeChatStore.getState().chats["example-project:active"]?.streaming).toBe(false);
    });

    render(<ChatPanel slug="example-project" />);
    expect(await screen.findByText("Response continues")).toBeInTheDocument();
  });
});
