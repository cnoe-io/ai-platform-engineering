import { render,screen,waitFor } from "@testing-library/react";
import { MarkdownRenderer } from "../MarkdownRenderer";

jest.mock("remend", () => ({
  __esModule: true,
  default: (content: string) => content,
}), { virtual: true });

jest.mock("marked-shiki", () => ({
  __esModule: true,
  default: ({
    highlight,
  }: {
    highlight: (code: string, lang: string, props: string[]) => Promise<string>;
  }) => ({
    async: true,
    async walkTokens(token: {
      type: string;
      lang?: string;
      text: string;
      block?: boolean;
    }) {
      if (token.type !== "code") return;
      const [lang = "text", ...props] = token.lang?.split(" ") ?? [];
      token.type = "html";
      token.block = true;
      token.text = `${await highlight(token.text, lang, props)}\n`;
    },
  }),
}));

jest.mock("shiki", () => ({
  bundledLanguages: { text: true },
  createHighlighter: jest.fn(async () => ({
    codeToHtml: (code: string) => `<pre class="shiki"><code>${code}</code></pre>`,
    getLoadedLanguages: () => ["text"],
    loadLanguage: jest.fn(),
  })),
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
      "```vidcast",
      "url: https://app.vidcast.io/share/embed/4e2a9de5-2d25-420b-a59a-acdb321bd1b3",
      "title: Example Vidcast",
      "```",
      "",
      "```youtube",
      "url: https://www.youtube.com/watch?v=b4STimVN60E",
      "title: Example video",
      "```",
      "",
      "```arxiv",
      "url: https://arxiv.org/html/2607.12662v1",
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
      expect(enabled.container.querySelectorAll("iframe")).toHaveLength(3),
    );

    expect(enabled.container.querySelector(".tome-vidcast-iframe")).toHaveAttribute(
      "src",
      "https://app.vidcast.io/share/embed/4e2a9de5-2d25-420b-a59a-acdb321bd1b3",
    );
    expect(enabled.container.querySelector(".tome-youtube-iframe")).toHaveAttribute(
      "src",
      "https://www.youtube-nocookie.com/embed/b4STimVN60E",
    );
    expect(enabled.container.querySelector(".tome-arxiv-iframe")).toHaveAttribute(
      "src",
      "https://arxiv.org/pdf/2607.12662v1",
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
