import mermaid from "mermaid";

import {
  hydrateVidcastPreviews,
  imageFileToDataUrl,
  renderTomeCodePreview,
} from "../editor-media";

const VIDEO_ID = "de4fc0eb-7146-4044-86a3-60c3cbd976a3";

jest.mock("mermaid", () => ({
  __esModule: true,
  default: {
    initialize: jest.fn(),
    render: jest.fn(),
  },
}));

const mockedMermaid = mermaid as jest.Mocked<typeof mermaid>;

describe("TOME editor media", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders Mermaid code through the async preview callback", async () => {
    mockedMermaid.render.mockResolvedValue({ svg: "<svg>diagram</svg>" } as never);
    const firstPreview = jest.fn();
    const secondPreview = jest.fn();

    expect(renderTomeCodePreview("mermaid", "graph TD; A-->B", firstPreview)).toBeUndefined();
    expect(renderTomeCodePreview(" MERMAID ", "flowchart LR; C-->D", secondPreview)).toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockedMermaid.initialize).toHaveBeenCalledTimes(1);
    expect(mockedMermaid.initialize).toHaveBeenCalledWith({
      startOnLoad: false,
      securityLevel: "strict",
    });
    expect(mockedMermaid.render).toHaveBeenNthCalledWith(1, "tome-mermaid-0", "graph TD; A-->B");
    expect(mockedMermaid.render).toHaveBeenNthCalledWith(
      2,
      "tome-mermaid-1",
      "flowchart LR; C-->D",
    );
    for (const applyPreview of [firstPreview, secondPreview]) {
      const markup = applyPreview.mock.calls[0]?.[0] as string;
      const container = document.createElement("div");
      container.innerHTML = markup;
      expect(
        container.querySelector("button.tome-mermaid-expand"),
      ).toHaveAccessibleName("Expand Mermaid diagram");
      expect(container.querySelector(".tome-mermaid-canvas svg")?.textContent).toBe(
        "diagram",
      );
    }
  });

  it("leaves non-Mermaid code blocks unchanged", () => {
    const applyPreview = jest.fn();

    expect(renderTomeCodePreview("typescript", "const value = 1", applyPreview)).toBeNull();
    expect(applyPreview).not.toHaveBeenCalled();
  });

  it("leaves blank Mermaid code blocks unchanged", () => {
    const applyPreview = jest.fn();

    expect(renderTomeCodePreview("mermaid", "  \n", applyPreview)).toBeNull();
    expect(mockedMermaid.render).not.toHaveBeenCalled();
    expect(applyPreview).not.toHaveBeenCalled();
  });

  it("returns a text-only alert when Mermaid rejects invalid syntax", async () => {
    mockedMermaid.render.mockRejectedValue(
      new Error('<img src=x onerror="globalThis.compromised=true">'),
    );
    const applyPreview = jest.fn();

    renderTomeCodePreview("mermaid", "not valid", applyPreview);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const alert = applyPreview.mock.calls[0]?.[0] as HTMLElement;
    expect(alert).toBeInstanceOf(HTMLElement);
    expect(alert).toHaveClass("tome-mermaid-error");
    expect(alert).toHaveAttribute("role", "alert");
    expect(alert.textContent).toContain("<img src=x");
    expect(alert.querySelector("img")).toBeNull();
  });

  it("renders and hydrates a validated Vidcast block", () => {
    const applyPreview = jest.fn();

    renderTomeCodePreview(
      "vidcast",
      [
        `url: https://app.vidcast.io/share/embed/${VIDEO_ID}`,
        "title: CAIPE Demo July 2026",
      ].join("\n"),
      applyPreview,
    );

    const root = document.createElement("div");
    root.append(applyPreview.mock.calls[0]?.[0] as HTMLElement);
    expect(root.querySelector("iframe")).toBeNull();

    hydrateVidcastPreviews(root);

    const iframe = root.querySelector("iframe");
    expect(iframe).toHaveAttribute(
      "src",
      `https://app.vidcast.io/share/embed/${VIDEO_ID}`,
    );
    expect(iframe).toHaveAttribute("title", "CAIPE Demo July 2026");
    expect(iframe).toHaveAttribute("loading", "lazy");
    expect(iframe).toHaveAttribute("allow", "fullscreen; autoplay; clipboard-write");
    expect(iframe).toHaveAttribute("allowfullscreen");
    expect(root.querySelector(".tome-vidcast-link")).toHaveAttribute(
      "href",
      `https://app.vidcast.io/share/${VIDEO_ID}`,
    );
  });

  it("shows a safe error instead of previewing an untrusted Vidcast URL", () => {
    const applyPreview = jest.fn();

    renderTomeCodePreview(
      "vidcast",
      "https://example.test/share/embed/de4fc0eb-7146-4044-86a3-60c3cbd976a3",
      applyPreview,
    );

    const alert = applyPreview.mock.calls[0]?.[0] as HTMLElement;
    expect(alert).toHaveClass("tome-vidcast-error");
    expect(alert).toHaveAttribute("role", "alert");
    expect(alert.textContent).toContain("app.vidcast.io");
    expect(alert.querySelector("iframe")).toBeNull();
  });

  it("turns pasted images into persistent data URLs", async () => {
    const file = new File(["image bytes"], "diagram.png", { type: "image/png" });

    await expect(imageFileToDataUrl(file)).resolves.toBe(
      "data:image/png;base64,aW1hZ2UgYnl0ZXM=",
    );
  });

  it("rejects images that would make page revisions unsafe", async () => {
    const file = new File([new Uint8Array(2 * 1024 * 1024 + 1)], "large.png", {
      type: "image/png",
    });

    await expect(imageFileToDataUrl(file)).rejects.toThrow("2 MB or smaller");
  });

  it("rejects non-image uploads", async () => {
    const file = new File(["plain text"], "notes.txt", { type: "text/plain" });

    await expect(imageFileToDataUrl(file)).rejects.toThrow(
      "Only image files can be embedded",
    );
  });
});
