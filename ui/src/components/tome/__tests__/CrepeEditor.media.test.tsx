import { render, waitFor } from "@testing-library/react";

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
});
