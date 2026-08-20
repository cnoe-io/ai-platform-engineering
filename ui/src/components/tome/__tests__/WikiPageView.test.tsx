import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { WikiPageView } from "../WikiPageView";

jest.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

jest.mock("@/components/tome/CrepeEditor", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  return {
    CrepeEditor: React.forwardRef(function MockCrepeEditor(
      {
        initialMarkdown,
        readonly,
      }: {
        initialMarkdown: string;
        readonly: boolean;
      },
      ref: React.ForwardedRef<{ getMarkdown: () => string }>,
    ) {
      const [value, setValue] = React.useState(initialMarkdown);
      React.useImperativeHandle(ref, () => ({ getMarkdown: () => value }), [value]);
      return (
        <textarea
          aria-label={readonly ? "Wiki preview" : "Wiki editor"}
          value={value}
          readOnly={readonly}
          onChange={(event) => setValue(event.target.value)}
        />
      );
    }),
  };
});

describe("WikiPageView", () => {
  it("previews an unsaved rich edit before saving", async () => {
    const onWrite = jest.fn().mockResolvedValue(undefined);

    render(
      <WikiPageView
        slug="example-project"
        path="charter.md"
        markdown={"---\ntitle: Example charter\nkind: stable\n---\nOriginal markdown"}
        onWrite={onWrite}
        onReload={jest.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Wiki editor" }), {
      target: { value: "Updated markdown" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));

    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Wiki preview" })).toHaveValue(
      "Updated markdown",
    );
    expect(onWrite).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onWrite).toHaveBeenCalledTimes(1));
    expect(onWrite).toHaveBeenCalledWith(
      "charter.md",
      expect.stringContaining("Updated markdown"),
      "edit charter.md",
    );
  });

  it("preserves a raw draft while entering and leaving preview", async () => {
    const onWrite = jest.fn().mockResolvedValue(undefined);

    render(
      <WikiPageView
        slug="example-project"
        path="charter.md"
        markdown={"---\ntitle: Example charter\nkind: stable\n---\nOriginal markdown"}
        onWrite={onWrite}
        onReload={jest.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Raw" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Raw markdown editor" }), {
      target: { value: "Updated raw markdown" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));

    expect(screen.getByRole("textbox", { name: "Wiki preview" })).toHaveValue(
      "Updated raw markdown",
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("textbox", { name: "Raw markdown editor" })).toHaveValue(
      "Updated raw markdown",
    );
  });
});
