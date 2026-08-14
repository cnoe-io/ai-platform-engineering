import { normalizeVidcastUrl, parseVidcastEmbed } from "../vidcast";

const VIDEO_ID = "de4fc0eb-7146-4044-86a3-60c3cbd976a3";

describe("TOME Vidcast embeds", () => {
  it("accepts canonical embed URLs and optional titles", () => {
    expect(
      parseVidcastEmbed(
        [
          `url: https://app.vidcast.io/share/embed/${VIDEO_ID}`,
          "title: CAIPE Demo July 2026",
        ].join("\n"),
      ),
    ).toEqual({
      ok: true,
      value: {
        src: `https://app.vidcast.io/share/embed/${VIDEO_ID}`,
        title: "CAIPE Demo July 2026",
        watchUrl: `https://app.vidcast.io/share/${VIDEO_ID}`,
      },
    });
  });

  it("accepts a share URL by itself and converts it to an embed URL", () => {
    expect(
      parseVidcastEmbed(
        `https://app.vidcast.io/share/${VIDEO_ID}?autoplay=1&cc=1&t=30`,
      ),
    ).toEqual({
      ok: true,
      value: {
        src: `https://app.vidcast.io/share/embed/${VIDEO_ID}?autoplay=1&cc=1&t=30`,
        title: "Vidcast video",
        watchUrl: `https://app.vidcast.io/share/${VIDEO_ID}?autoplay=1&cc=1&t=30`,
      },
    });
  });

  it.each([
    "http://app.vidcast.io/share/embed/de4fc0eb-7146-4044-86a3-60c3cbd976a3",
    "https://app.vidcast.io.example.test/share/embed/de4fc0eb-7146-4044-86a3-60c3cbd976a3",
    "https://example.test/share/embed/de4fc0eb-7146-4044-86a3-60c3cbd976a3",
    "https://app.vidcast.io/share/embed/not-a-video",
    "https://app.vidcast.io/share/embed/de4fc0eb-7146-4044-86a3-60c3cbd976a3?unknown=1",
    "https://app.vidcast.io/share/embed/de4fc0eb-7146-4044-86a3-60c3cbd976a3?autoplay=yes",
    "https://app.vidcast.io/share/embed/de4fc0eb-7146-4044-86a3-60c3cbd976a3#fragment",
  ])("rejects unsafe or unsupported URL %s", (url) => {
    expect(normalizeVidcastUrl(url)).toBeNull();
  });

  it("rejects unsupported block fields", () => {
    expect(
      parseVidcastEmbed(
        [
          `url: https://app.vidcast.io/share/embed/${VIDEO_ID}`,
          "allow: camera *",
        ].join("\n"),
      ),
    ).toEqual({
      ok: false,
      error: "Unsupported or duplicate Vidcast field: allow.",
    });
  });
});
