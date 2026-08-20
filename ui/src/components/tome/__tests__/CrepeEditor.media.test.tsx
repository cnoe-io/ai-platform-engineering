import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { CrepeEditor } from "../CrepeEditor";

const mockToast = jest.fn();
const mockCreate = jest.fn().mockResolvedValue(undefined);
const mockDestroy = jest.fn();
const mockSetReadonly = jest.fn();
const mockEditorConfig = jest.fn();
const mockEditorAction = jest.fn();
const mockGetMarkdown = jest.fn(() => "# Example");
const mockCrepeConstructor = jest.fn();

type CrepeOptions = {
  featureConfigs: Record<
    string,
    {
      renderPreview?: unknown;
      previewLoading?: string;
      onUpload?: (file: File) => Promise<string>;
    }
  >;
};

jest.mock("@milkdown/crepe", () => {
  class MockCrepe {
    static Feature = {
      CodeMirror: "code-mirror",
      ImageBlock: "image-block",
    };

    editor = {
      config: mockEditorConfig,
      action: mockEditorAction,
    };

    constructor(options: CrepeOptions) {
      mockCrepeConstructor(options);
    }

    create = mockCreate;
    destroy = mockDestroy;
    setReadonly = mockSetReadonly;
    getMarkdown = mockGetMarkdown;
  }

  return { Crepe: MockCrepe };
});

jest.mock(
  "@milkdown/kit/preset/commonmark",
  () => ({ linkAttr: { key: "link-attr" } }),
  { virtual: true },
);
jest.mock(
  "@milkdown/kit/core",
  () => ({ editorViewCtx: "editor-view-ctx" }),
  { virtual: true },
);
jest.mock("@milkdown/utils", () => ({ replaceAll: jest.fn() }), { virtual: true });
jest.mock("@/lib/tome/citations", () => ({ classifyCitationHref: jest.fn() }));
jest.mock("@/components/shared/timeline/MarkdownRenderer", () => ({
  renderInlineMarkdown: jest.fn((value: string) => value),
}));
jest.mock("@/components/ui/copy-button", () => ({ copyTextToClipboard: jest.fn() }));
jest.mock("@/components/ui/toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

describe("CrepeEditor media configuration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreate.mockResolvedValue(undefined);
  });

  it("wires Mermaid previews and persistent image uploads into Crepe", async () => {
    const { unmount } = render(
      <CrepeEditor initialMarkdown="# Example" readonly />,
    );

    await waitFor(() => expect(mockCrepeConstructor).toHaveBeenCalledTimes(1));
    const options = mockCrepeConstructor.mock.calls[0][0] as CrepeOptions;
    const codeMirror = options.featureConfigs["code-mirror"];
    const imageBlock = options.featureConfigs["image-block"];

    expect(codeMirror.renderPreview).toEqual(expect.any(Function));
    expect(codeMirror.previewLoading).toBe("Rendering Mermaid diagram…");
    expect(imageBlock.onUpload).toEqual(expect.any(Function));

    const file = new File(["image bytes"], "example.png", { type: "image/png" });
    await expect(imageBlock.onUpload?.(file)).resolves.toBe(
      "data:image/png;base64,aW1hZ2UgYnl0ZXM=",
    );
    expect(mockToast).not.toHaveBeenCalled();

    unmount();
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });

  it("surfaces image validation failures through the editor toast", async () => {
    render(<CrepeEditor initialMarkdown="# Example" />);

    await waitFor(() => expect(mockCrepeConstructor).toHaveBeenCalledTimes(1));
    const options = mockCrepeConstructor.mock.calls[0][0] as CrepeOptions;
    const upload = options.featureConfigs["image-block"].onUpload;
    const file = new File(["not an image"], "example.txt", { type: "text/plain" });

    await expect(upload?.(file)).rejects.toThrow("Only image files");
    expect(mockToast).toHaveBeenCalledWith(
      "Only image files can be embedded.",
      "error",
    );
  });

  it("opens an accessible lightbox for a rendered Mermaid diagram", async () => {
    const { container } = render(<CrepeEditor initialMarkdown="# Example" readonly />);
    const host = container.querySelector(".milkdown-host") as HTMLDivElement;
    host.innerHTML = [
      '<div class="tome-mermaid-preview">',
      '<button type="button" class="tome-mermaid-expand" aria-label="Expand Mermaid diagram">Expand</button>',
      '<div class="tome-mermaid-canvas">',
      '<svg viewBox="0 0 1800 600" aria-label="Example diagram"></svg>',
      "</div>",
      "</div>",
    ].join("");

    fireEvent.click(screen.getByRole("button", { name: "Expand Mermaid diagram" }));

    const dialog = await screen.findByRole("dialog", { name: "Mermaid diagram" });
    expect(dialog).toBeVisible();
    expect(dialog.querySelector(".tome-mermaid-lightbox-canvas svg")).toHaveAttribute(
      "aria-label",
      "Example diagram",
    );
    const canvas = dialog.querySelector(".tome-mermaid-lightbox-canvas") as HTMLDivElement;
    const zoomOut = screen.getByRole("button", { name: "Zoom out Mermaid diagram" });
    const zoomReset = screen.getByRole("button", { name: "Reset Mermaid zoom" });
    const zoomIn = screen.getByRole("button", { name: "Zoom in Mermaid diagram" });

    expect(zoomReset).toHaveTextContent("100%");
    expect(canvas).toHaveStyle("--tome-mermaid-expanded-width: 1800px");

    fireEvent.click(zoomOut);
    expect(zoomReset).toHaveTextContent("75%");
    expect(canvas).toHaveStyle("--tome-mermaid-expanded-width: 1350px");

    fireEvent.click(zoomIn);
    expect(zoomReset).toHaveTextContent("100%");
    expect(canvas).toHaveStyle("--tome-mermaid-expanded-width: 1800px");

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
  });

  it("hydrates sanitized external placeholders into allowlisted iframes", async () => {
    const { container } = render(<CrepeEditor initialMarkdown="# Example" readonly />);
    const host = container.querySelector(".milkdown-host") as HTMLDivElement;
    host.innerHTML = [
      '<div class="tome-embed-preview tome-youtube-preview"',
      ' data-embed-provider="youtube"',
      ' data-embed-src="https://www.youtube-nocookie.com/embed/M7lc1UVf-VE"',
      ' data-embed-title="Example video">',
      '<div class="tome-embed-frame tome-video-frame"></div>',
      "</div>",
    ].join("");

    const iframe = await waitFor(() => {
      const value = host.querySelector("iframe");
      expect(value).toBeInTheDocument();
      return value as HTMLIFrameElement;
    });
    expect(iframe).toHaveAttribute(
      "src",
      "https://www.youtube-nocookie.com/embed/M7lc1UVf-VE",
    );
    expect(iframe).toHaveAttribute("title", "Example video");
  });

  it("deletes the underlying block when an embed's remove button is clicked in edit mode", () => {
    const dispatch = jest.fn();
    const node = { nodeSize: 4 };
    const deleteTr = { name: "delete-tr" };
    const tr = { delete: jest.fn().mockReturnValue(deleteTr) };
    const view = {
      posAtDOM: jest.fn().mockReturnValue(10),
      state: {
        doc: {
          resolve: jest.fn().mockReturnValue({
            depth: 1,
            before: jest.fn().mockReturnValue(5),
            node: jest.fn().mockReturnValue(node),
          }),
        },
        tr,
      },
      dispatch,
    };
    mockEditorAction.mockImplementation((fn: (ctx: { get: () => unknown }) => void) =>
      fn({ get: () => view }),
    );

    const { container } = render(<CrepeEditor initialMarkdown="# Example" />);
    const host = container.querySelector(".milkdown-host") as HTMLDivElement;
    host.innerHTML = [
      '<div class="tome-embed-preview tome-youtube-preview">',
      '<button type="button" class="tome-embed-remove" aria-label="Remove YouTube embed"></button>',
      "</div>",
    ].join("");

    fireEvent.click(screen.getByRole("button", { name: "Remove YouTube embed" }));

    expect(view.posAtDOM).toHaveBeenCalled();
    expect(tr.delete).toHaveBeenCalledWith(5, 9);
    expect(dispatch).toHaveBeenCalledWith(deleteTr);
  });

  it("does not delete an embed's block when clicked in read-only view mode", () => {
    const { container } = render(<CrepeEditor initialMarkdown="# Example" readonly />);
    const host = container.querySelector(".milkdown-host") as HTMLDivElement;
    host.innerHTML = [
      '<div class="tome-embed-preview tome-youtube-preview">',
      '<button type="button" class="tome-embed-remove" aria-label="Remove YouTube embed"></button>',
      "</div>",
    ].join("");

    fireEvent.click(screen.getByRole("button", { name: "Remove YouTube embed" }));

    expect(mockEditorAction).not.toHaveBeenCalled();
  });
});
