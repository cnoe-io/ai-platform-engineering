import { render,screen,waitFor } from "@testing-library/react";
import { MarkdownRenderer } from "../MarkdownRenderer";

jest.mock("remend", () => ({
  __esModule: true,
  default: (content: string) => content,
}), { virtual: true });

jest.mock("marked-shiki", () => ({
  __esModule: true,
  default: () => ({}),
}));

jest.mock("shiki", () => ({
  bundledLanguages: {},
  createHighlighter: jest.fn(),
}));

describe("MarkdownRenderer links", () => {
  it("opens external and relative links in a new tab", async () => {
    render(
      <MarkdownRenderer
        content="[External](https://example.com/docs) [Internal](/chat/example)"
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "External" })).toHaveAttribute("target", "_blank");
      expect(screen.getByRole("link", { name: "Internal" })).toHaveAttribute("target", "_blank");
    });

    for (const link of screen.getAllByRole("link")) {
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    }
  });

  it("renders allowlisted external embeds only when explicitly enabled", async () => {
    const content = [
      "```youtube",
      "url: https://youtu.be/M7lc1UVf-VE",
      "title: Example video",
      "```",
      "",
      "```arxiv",
      "url: https://arxiv.org/abs/1706.03762",
      "title: Example paper",
      "```",
    ].join("\n");
    const disabled = render(<MarkdownRenderer content={content} />);

    await waitFor(() => expect(disabled.container.querySelector("pre")).toBeInTheDocument());
    expect(disabled.container.querySelector("iframe")).toBeNull();
    disabled.unmount();

    const enabled = render(
      <MarkdownRenderer content={content} enableExternalEmbeds />,
    );
    await waitFor(() =>
      expect(enabled.container.querySelectorAll("iframe")).toHaveLength(2),
    );

    expect(enabled.container.querySelector(".tome-youtube-iframe")).toHaveAttribute(
      "src",
      "https://www.youtube-nocookie.com/embed/M7lc1UVf-VE",
    );
    expect(enabled.container.querySelector(".tome-arxiv-iframe")).toHaveAttribute(
      "src",
      "https://arxiv.org/pdf/1706.03762",
    );
  });

  it("shows a safe error for invalid opted-in embeds", async () => {
    const { container } = render(
      <MarkdownRenderer
        content={[
          "```youtube",
          "https://example.test/watch?v=M7lc1UVf-VE",
          "```",
        ].join("\n")}
        enableExternalEmbeds
      />,
    );

    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeInTheDocument());
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.textContent).toContain("Could not embed YouTube");
  });
});
