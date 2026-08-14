import {
  normalizeArxivUrl,
  normalizeYouTubeUrl,
  parseTomeEmbed,
} from "../embeds";

const YOUTUBE_ID = "M7lc1UVf-VE";

describe("TOME external embeds", () => {
  describe("YouTube", () => {
    it("normalizes watch URLs to the privacy-enhanced player", () => {
      expect(
        normalizeYouTubeUrl(
          `https://www.youtube.com/watch?v=${YOUTUBE_ID}&t=1m30s&si=tracking-token`,
        ),
      ).toEqual({
        src: `https://www.youtube-nocookie.com/embed/${YOUTUBE_ID}?start=90`,
        watchUrl: `https://www.youtube.com/watch?v=${YOUTUBE_ID}&t=90`,
      });
    });

    it.each([
      `https://youtu.be/${YOUTUBE_ID}`,
      `https://www.youtube.com/shorts/${YOUTUBE_ID}`,
      `https://www.youtube-nocookie.com/embed/${YOUTUBE_ID}`,
    ])("accepts common video URL %s", (url) => {
      expect(normalizeYouTubeUrl(url)?.src).toBe(
        `https://www.youtube-nocookie.com/embed/${YOUTUBE_ID}`,
      );
    });

    it.each([
      `http://www.youtube.com/watch?v=${YOUTUBE_ID}`,
      `https://youtube.example.test/watch?v=${YOUTUBE_ID}`,
      "https://www.youtube.com/watch?v=invalid",
      `https://youtu.be/${YOUTUBE_ID}/unexpected`,
      `https://www.youtube.com/watch?v=${YOUTUBE_ID}&t=tomorrow`,
      `https://www.youtube.com/watch?v=${YOUTUBE_ID}#fragment`,
    ])("rejects unsafe or invalid URL %s", (url) => {
      expect(normalizeYouTubeUrl(url)).toBeNull();
    });

    it("parses titled YouTube blocks", () => {
      expect(
        parseTomeEmbed(
          "youtube",
          [`url: https://youtu.be/${YOUTUBE_ID}`, "title: Example walkthrough"].join("\n"),
        ),
      ).toEqual({
        ok: true,
        value: {
          provider: "youtube",
          kind: "video",
          src: `https://www.youtube-nocookie.com/embed/${YOUTUBE_ID}`,
          title: "Example walkthrough",
          watchUrl: `https://www.youtube.com/watch?v=${YOUTUBE_ID}`,
          linkLabel: "Watch on YouTube",
        },
      });
    });
  });

  describe("arXiv", () => {
    it.each([
      "1706.03762",
      "arXiv:1706.03762",
      "https://arxiv.org/abs/1706.03762",
      "https://arxiv.org/html/1706.03762",
      "https://arxiv.org/pdf/1706.03762.pdf",
    ])("normalizes modern paper reference %s to a PDF", (value) => {
      expect(normalizeArxivUrl(value)).toEqual({
        src: "https://arxiv.org/pdf/1706.03762",
        watchUrl: "https://arxiv.org/abs/1706.03762",
      });
    });

    it("accepts legacy identifiers and explicit versions", () => {
      expect(normalizeArxivUrl("arXiv:hep-th/9901001v2")).toEqual({
        src: "https://arxiv.org/pdf/hep-th/9901001v2",
        watchUrl: "https://arxiv.org/abs/hep-th/9901001v2",
      });
    });

    it.each([
      "http://arxiv.org/abs/1706.03762",
      "https://arxiv.example.test/abs/1706.03762",
      "https://arxiv.org/search/1706.03762",
      "https://arxiv.org/abs/1706.03762?download=1",
      "https://arxiv.org/abs/not-a-paper",
      "https://arxiv.org/abs/%E0%A4%A",
    ])("rejects unsafe or invalid reference %s", (value) => {
      expect(normalizeArxivUrl(value)).toBeNull();
    });

    it("parses titled arXiv blocks", () => {
      expect(
        parseTomeEmbed(
          "arxiv",
          ["url: https://arxiv.org/abs/1706.03762", "title: Attention Is All You Need"].join(
            "\n",
          ),
        ),
      ).toEqual({
        ok: true,
        value: {
          provider: "arxiv",
          kind: "document",
          src: "https://arxiv.org/pdf/1706.03762",
          title: "Attention Is All You Need",
          watchUrl: "https://arxiv.org/abs/1706.03762",
          linkLabel: "Open on arXiv",
        },
      });
    });
  });

  it("ignores unsupported fenced languages", () => {
    expect(parseTomeEmbed("typescript", "const value = 1")).toBeNull();
  });
});
