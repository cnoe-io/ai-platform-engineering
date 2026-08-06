import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";

const mockReplace = jest.fn();
const mockToast = jest.fn();
let mockSearchParams = new URLSearchParams("collection=primary-collection");

jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => mockSearchParams,
}));

jest.mock("@/components/ui/toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

jest.mock("framer-motion", () => {
  const ReactModule = jest.requireActual<typeof React>("react");
  const MotionDiv = ReactModule.forwardRef<
    HTMLDivElement,
    React.HTMLAttributes<HTMLDivElement> & {
      children?: React.ReactNode;
      whileHover?: { y?: number };
      whileDrag?: unknown;
      initial?: unknown;
      animate?: unknown;
      exit?: unknown;
      transition?: unknown;
      layout?: unknown;
      drag?: unknown;
      dragMomentum?: unknown;
      dragSnapToOrigin?: unknown;
      onDragEnd?: unknown;
    }
  >(({ children, whileHover, ...props }, ref) => {
    const {
      whileDrag: _whileDrag,
      initial: _initial,
      animate: _animate,
      exit: _exit,
      transition: _transition,
      layout: _layout,
      drag: _drag,
      dragMomentum: _dragMomentum,
      dragSnapToOrigin: _dragSnapToOrigin,
      onDragEnd: _onDragEnd,
      ...domProps
    } = props;
    return (
      <div ref={ref} data-hover-y={whileHover?.y} {...domProps}>
        {children}
      </div>
    );
  });
  MotionDiv.displayName = "MotionDiv";
  return {
    AnimatePresence: ({ children }: { children: React.ReactNode }) => (
      <>{children}</>
    ),
    motion: { div: MotionDiv },
  };
});

import { RagCollectionsView } from "../RagCollectionsView";

function jsonResponse(body: unknown): Response {
  return { ok: true, json: async () => body } as Response;
}

describe("RagCollectionsView", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSearchParams = new URLSearchParams("collection=primary-collection");
    global.fetch = jest.fn(
      async (url: RequestInfo | URL, init?: RequestInit) => {
        const href = String(url);
        if (
          href === "/api/rag/collections/primary-collection" &&
          init?.method === "DELETE"
        ) {
          return jsonResponse({ success: true, data: { deleted: true } });
        }
        if (href === "/api/rag/collections") {
          return jsonResponse({
            success: true,
            data: {
              collections: [
                {
                  _id: "primary-collection",
                  name: "Primary collection",
                  description: "Shared operational knowledge",
                  is_platform: false,
                  source_ids: ["slack-channel-C00000000"],
                  owner_subject: "owner-subject",
                  maintainer_team_slugs: [],
                  reader_team_slugs: [],
                  global_read: false,
                  created_by: "owner-subject",
                  created_at: "2026-08-06T00:00:00.000Z",
                  updated_at: "2026-08-06T00:00:00.000Z",
                  _permissions: {
                    can_read: true,
                    can_publish: true,
                    can_manage: true,
                    can_delegate: false,
                  },
                },
              ],
            },
          });
        }
        if (href === "/api/dynamic-agents/datasources?purpose=publish") {
          return jsonResponse({
            success: true,
            data: {
              datasources: [
                {
                  datasource_id: "slack-channel-C00000000",
                  name: "Slack: #primary",
                  source_type: "slack",
                  document_count: 3,
                  chunk_count: 8,
                  can_manage: false,
                  can_read: true,
                },
                {
                  datasource_id: "web-docs",
                  name: "Web docs",
                  source_type: "web",
                  document_count: 4,
                  chunk_count: 12,
                  can_manage: true,
                  can_read: true,
                },
                {
                  datasource_id: "managed-only",
                  name: "Managed only",
                  source_type: "jira",
                  can_manage: true,
                  can_read: false,
                },
              ],
            },
          });
        }
        if (href === "/api/dynamic-agents/teams") {
          return jsonResponse({ success: true, data: [] });
        }
        throw new Error(`Unexpected fetch: ${href}`);
      },
    );
  });

  it("keeps the detail pane closed until a collection is selected", async () => {
    mockSearchParams = new URLSearchParams();
    render(<RagCollectionsView />);

    expect(
      await screen.findByText("Select or create a RAG collection."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Collection settings")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("knowledge-card-datasource-slack-channel-C00000000"),
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: /Primary collection/i }),
    );

    expect(await screen.findByText("Collection settings")).toBeInTheDocument();
    expect(mockReplace).toHaveBeenCalledWith(
      "/knowledge-bases/collections?collection=primary-collection",
      { scroll: false },
    );
  });

  it("describes collection creation in terms of management and search access", async () => {
    render(<RagCollectionsView />);

    fireEvent.click(
      await screen.findByRole("button", { name: "New Collection" }),
    );
    expect(
      screen.getByText(
        "Create a private collection from datasources you manage. An administrator can later give teams permission to manage the collection or search its content.",
      ),
    ).toBeInTheDocument();
  });

  it("confirms that deleting a collection leaves its data unchanged", async () => {
    jest.spyOn(window, "confirm").mockReturnValue(true);
    render(<RagCollectionsView />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Delete collection" }),
    );

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        "Collection deleted. Datasources and indexed content remain unchanged.",
        "success",
      ),
    );
  });

  it("reuses datasource cards and compact rows while preserving publish gates", async () => {
    render(<RagCollectionsView />);

    expect(
      await screen.findByText(
        "Collections group datasources so they can be assigned and managed together.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/wholesale stale-chunk replacement/i),
    ).not.toBeInTheDocument();

    const selected = screen.getByTestId(
      "knowledge-card-datasource-slack-channel-C00000000",
    );
    expect(selected).toHaveTextContent("Slack: #primary");
    expect(selected).toHaveTextContent("3 documents · 8 chunks");
    expect(selected.querySelector('img[src="/slack.svg"]')).not.toBeNull();
    expect(
      selected.querySelector('[data-knowledge-card-surface="true"]'),
    ).not.toHaveAttribute("data-rarity");
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();

    const managedOnly = screen.getByRole("button", { name: /Managed only/i });
    expect(managedOnly).toBeDisabled();
    expect(managedOnly).toHaveAttribute(
      "title",
      "A personal collection can only include datasources you can already search",
    );

    fireEvent.click(screen.getByRole("button", { name: /Web docs/i }));
    expect(
      await screen.findByTestId("knowledge-card-datasource-web-docs"),
    ).toHaveTextContent("4 documents · 12 chunks");

    fireEvent.click(
      screen.getByRole("button", { name: "Remove Slack: #primary" }),
    );
    await waitFor(() =>
      expect(
        screen.queryByTestId(
          "knowledge-card-datasource-slack-channel-C00000000",
        ),
      ).not.toBeInTheDocument(),
    );
  });
});
