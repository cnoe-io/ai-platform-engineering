import { render, screen } from "@testing-library/react";

import { SOURCE_ADAPTERS } from "../adapters";
import { SourceItemPicker } from "../SourceItemPicker";

jest.mock("../useSourceOptions", () => ({
  useSourceOptions: () => ({
    connected: true,
    connectedTo: "example.atlassian.net",
    options: [],
    loading: false,
    manageUrl: "",
    search: jest.fn(),
    reload: jest.fn(),
  }),
}));

jest.mock("../ConfluenceSpaceBrowser", () => ({
  ConfluenceSpaceBrowser: () => null,
}));

jest.mock("../ConfluenceManualAdd", () => ({
  ConfluenceManualAdd: () => null,
}));

describe("SourceItemPicker", () => {
  it("shows each saved Confluence page root and its descendant scope", () => {
    const sourceUrl = "https://example.atlassian.net/wiki/spaces/PLATFORM";
    render(
      <SourceItemPicker
        adapter={SOURCE_ADAPTERS.confluence}
        selected={[sourceUrl]}
        onChange={jest.fn()}
        confluencePageScopes={[
          {
            page_id: "123",
            page_title: "Architecture",
            space_key: "PLATFORM",
            include_descendants: true,
          },
          {
            page_id: "456",
            page_title: "Runbooks",
            space_key: "PLATFORM",
            include_descendants: false,
          },
        ]}
      />,
    );

    expect(screen.getByText("Saved Confluence scope")).toBeInTheDocument();
    expect(screen.getByText("2 page roots selected")).toBeInTheDocument();
    expect(screen.getByText("Page and all subpages")).toBeInTheDocument();
    expect(screen.getByText("Page only")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Architecture" })).toHaveAttribute(
      "href",
      "https://example.atlassian.net/wiki/spaces/PLATFORM/pages/123",
    );
    expect(screen.getByRole("link", { name: "Runbooks" })).toHaveAttribute(
      "href",
      "https://example.atlassian.net/wiki/spaces/PLATFORM/pages/456",
    );
    expect(screen.getByRole("link", { name: sourceUrl })).toHaveAttribute(
      "href",
      sourceUrl,
    );
  });

  it("states explicitly when the entire Confluence space is saved", () => {
    const sourceUrl = "https://example.atlassian.net/wiki/spaces/PLATFORM";
    render(
      <SourceItemPicker
        adapter={SOURCE_ADAPTERS.confluence}
        selected={[sourceUrl]}
        onChange={jest.fn()}
        confluencePageScopes={[]}
      />,
    );

    expect(screen.getByText("Entire space selected")).toBeInTheDocument();
    expect(
      screen.getByText("All accessible pages in this space are included."),
    ).toBeInTheDocument();
  });
});
