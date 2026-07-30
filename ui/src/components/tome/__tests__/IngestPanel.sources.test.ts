import { sourcesFromProject } from "@/components/tome/IngestPanel";

describe("sourcesFromProject", () => {
  it("shows every selected Confluence root with its exact descendant scope", () => {
    const rows = sourcesFromProject({
      confluence_url: "https://example.atlassian.net/wiki/spaces/ENG",
      confluence_page_scopes: [
        {
          page_id: "123",
          page_title: "Architecture",
          space_key: "ENG",
          include_descendants: true,
        },
        {
          page_id: "456",
          page_title: "Release checklist",
          space_key: "ENG",
          include_descendants: false,
        },
      ],
    });

    expect(rows).toEqual([
      {
        kind: "confluence",
        label: "Confluence",
        connectorKey: "atlassian",
        items: [
          {
            label: "Architecture",
            detail: "Space ENG · This page and all subpages",
            href: "https://example.atlassian.net/wiki/spaces/ENG/pages/123",
          },
          {
            label: "Release checklist",
            detail: "Space ENG · This page only",
            href: "https://example.atlassian.net/wiki/spaces/ENG/pages/456",
          },
        ],
      },
    ]);
  });

  it("labels a selection without page roots as the entire space", () => {
    const rows = sourcesFromProject({
      confluence_url: "https://example.atlassian.net/wiki/spaces/ENG",
    });

    expect(rows[0]?.items).toEqual([
      {
        label: "Entire ENG space",
        detail: "https://example.atlassian.net/wiki/spaces/ENG",
        href: "https://example.atlassian.net/wiki/spaces/ENG",
      },
    ]);
  });

  it("supports the legacy singular page scope", () => {
    const rows = sourcesFromProject({
      confluence_url: "https://example.atlassian.net/wiki/spaces/ENG",
      confluence_page_scope: {
        page_id: "789",
        page_title: "Operations",
        space_key: "ENG",
        include_descendants: true,
      },
    });

    expect(rows[0]?.items[0]).toEqual({
      label: "Operations",
      detail: "Space ENG · This page and all subpages",
      href: "https://example.atlassian.net/wiki/spaces/ENG/pages/789",
    });
  });

  it("does not mislabel a legacy page URL as an entire-space selection", () => {
    const rows = sourcesFromProject({
      confluence_url:
        "https://example.atlassian.net/wiki/spaces/ENG/pages/987/Legacy-page",
    });

    expect(rows[0]?.items[0]).toEqual({
      label: "Page 987",
      detail: "Space ENG · This page and all subpages",
      href: "https://example.atlassian.net/wiki/spaces/ENG/pages/987/Legacy-page",
    });
  });
});
