import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { GistView } from "../GistView";

const mockCrepeEditor = jest.fn();

jest.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

jest.mock("@/components/tome/CrepeEditor", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  return {
    CrepeEditor: React.forwardRef(function MockCrepeEditor(
      {
        initialMarkdown,
        readonly: isReadonly,
      }: {
        initialMarkdown: string;
        readonly?: boolean;
      },
      ref: React.ForwardedRef<{ getMarkdown: () => string }>,
    ) {
      mockCrepeEditor({ initialMarkdown, readonly: isReadonly });
      const [value, setValue] = React.useState(initialMarkdown);
      React.useImperativeHandle(ref, () => ({ getMarkdown: () => value }), [value]);
      return (
        <textarea
          aria-label="Gist body"
          value={value}
          readOnly={isReadonly}
          onChange={(event) => setValue(event.target.value)}
        />
      );
    }),
  };
});

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

  it("renders the gist body through TOME's readonly rich renderer", async () => {
    render(
      <GistView
        slug="example-project"
        id="gist-1"
        canEdit={false}
        onBack={jest.fn()}
      />,
    );

    await screen.findByText("Example gist");
    await waitFor(() => expect(mockCrepeEditor).toHaveBeenCalled());
    expect(mockCrepeEditor).toHaveBeenLastCalledWith(
      expect.objectContaining({
        initialMarkdown: "```youtube\nhttps://youtu.be/M7lc1UVf-VE\n```",
        readonly: true,
      }),
    );
  });

  it("lets editors update a gist and renders the saved result", async () => {
    const updatedGist = {
      id: "gist-1",
      title: "Updated gist",
      body: "Updated markdown",
      author: "test-user",
      created_at: "2026-08-14T12:00:00.000Z",
      updated_at: "2026-08-14T13:00:00.000Z",
      updated_by: "editor@example.test",
      tags: ["updated"],
    };
    (global.fetch as jest.Mock)
      .mockReset()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            gist: {
              id: "gist-1",
              title: "Example gist",
              body: "Original markdown",
              author: "test-user",
              created_at: "2026-08-14T12:00:00.000Z",
              tags: ["draft"],
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { gist: updatedGist } }),
      });

    render(
      <GistView
        slug="example-project"
        id="gist-1"
        canEdit
        onBack={jest.fn()}
      />,
    );

    await screen.findByText("Example gist");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Raw" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Gist title" }), {
      target: { value: "Updated gist" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Gist body" }), {
      target: { value: "Updated markdown" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Remove tag draft" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Add tag" }), {
      target: { value: "updated" },
    });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Add tag" }), { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(mockCrepeEditor).toHaveBeenLastCalledWith(
      expect.objectContaining({ initialMarkdown: "Updated markdown", readonly: true }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(global.fetch).toHaveBeenLastCalledWith(
        "/api/tome/projects/example-project/gists/gist-1",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({
            title: "Updated gist",
            body: "Updated markdown",
            tags: ["updated"],
          }),
        }),
      ),
    );
    await screen.findByRole("heading", { name: "Updated gist" });
    expect(mockCrepeEditor).toHaveBeenLastCalledWith(
      expect.objectContaining({ initialMarkdown: "Updated markdown", readonly: true }),
    );
  });
});
