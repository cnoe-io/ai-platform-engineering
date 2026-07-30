import {
  isConfluencePageUrl,
  normalizeConfluencePageScope,
  normalizeConfluencePageScopes,
  parseConfluenceUrl,
} from "../confluence-source";

describe("parseConfluenceUrl", () => {
  it("parses a space URL", () => {
    expect(
      parseConfluenceUrl("https://example.atlassian.net/wiki/spaces/PLATFORM"),
    ).toEqual({
      url: "https://example.atlassian.net/wiki/spaces/PLATFORM",
      base_url: "https://example.atlassian.net",
      space_key: "PLATFORM",
      page_id: undefined,
    });
  });

  it("parses a modern page URL", () => {
    expect(
      parseConfluenceUrl(
        "https://example.atlassian.net/wiki/spaces/PLATFORM/pages/12345/Overview",
      ),
    ).toMatchObject({
      base_url: "https://example.atlassian.net",
      space_key: "PLATFORM",
      page_id: "12345",
    });
  });

  it.each([
    "https://example.atlassian.net/wiki/pages/12345",
    "https://example.atlassian.net/wiki/pages/viewpage.action?pageId=12345",
  ])("parses page id from %s", (url) => {
    expect(parseConfluenceUrl(url)?.page_id).toBe("12345");
    expect(isConfluencePageUrl(url)).toBe(true);
  });

  it("rejects invalid input", () => {
    expect(parseConfluenceUrl("not a url")).toBeNull();
  });
});

describe("normalizeConfluencePageScope", () => {
  it("normalizes a valid scope", () => {
    expect(
      normalizeConfluencePageScope({
        page_id: " 123 ",
        page_title: " Overview ",
        space_key: " PLATFORM ",
        include_descendants: false,
      }),
    ).toEqual({
      page_id: "123",
      page_title: "Overview",
      space_key: "PLATFORM",
      include_descendants: false,
    });
  });

  it("rejects a scope without a numeric page id", () => {
    expect(
      normalizeConfluencePageScope({
        page_id: "overview",
        page_title: "Overview",
        space_key: "PLATFORM",
      }),
    ).toBeUndefined();
  });
});

describe("normalizeConfluencePageScopes", () => {
  it("normalizes and deduplicates page roots", () => {
    expect(
      normalizeConfluencePageScopes([
        {
          page_id: " 123 ",
          page_title: " Overview ",
          space_key: " PLATFORM ",
        },
        {
          page_id: "123",
          page_title: "Duplicate",
          space_key: "PLATFORM",
        },
        {
          page_id: "invalid",
          page_title: "Ignored",
          space_key: "PLATFORM",
        },
      ]),
    ).toEqual([
      {
        page_id: "123",
        page_title: "Overview",
        space_key: "PLATFORM",
        include_descendants: true,
      },
    ]);
  });
});
