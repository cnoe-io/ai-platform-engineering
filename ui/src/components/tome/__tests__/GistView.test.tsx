import { render, screen, waitFor } from "@testing-library/react";

import { GistView } from "../GistView";

const mockMarkdownRenderer = jest.fn(() => <div data-testid="markdown-body" />);

jest.mock("@/components/shared/timeline", () => ({
  MarkdownRenderer: (props: Record<string, unknown>) => mockMarkdownRenderer(props),
}));

jest.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

describe("GistView", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          gist: {
            id: "gist-1",
            title: "Example gist",
            body: "```youtube\nhttps://youtu.be/M7lc1UVf-VE\n```",
            author: "test-user",
            created_at: "2026-08-14T12:00:00.000Z",
            tags: [],
          },
        },
      }),
    }) as jest.Mock;
  });

  it("opts the gist body into allowlisted external embeds", async () => {
    render(
      <GistView
        slug="example-project"
        id="gist-1"
        canEdit={false}
        onBack={jest.fn()}
      />,
    );

    await screen.findByText("Example gist");
    await waitFor(() => expect(mockMarkdownRenderer).toHaveBeenCalled());
    expect(mockMarkdownRenderer).toHaveBeenLastCalledWith(
      expect.objectContaining({
        content: "```youtube\nhttps://youtu.be/M7lc1UVf-VE\n```",
        variant: "final",
        enableExternalEmbeds: true,
      }),
    );
  });
});
