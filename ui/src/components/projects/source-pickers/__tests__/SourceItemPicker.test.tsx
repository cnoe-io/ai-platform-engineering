import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

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
  it("collapses the picker into a compact 'Connected to X · Change' row once a Confluence space is selected", async () => {
    const user = userEvent.setup();
    const sourceUrl = "https://example.atlassian.net/wiki/spaces/PLATFORM";
    render(
      <SourceItemPicker
        adapter={SOURCE_ADAPTERS.confluence}
        selected={[sourceUrl]}
        onChange={jest.fn()}
        confluencePageScopes={[]}
      />,
    );

    expect(screen.getByText(sourceUrl)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(SOURCE_ADAPTERS.confluence.searchPlaceholder)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Change" }));

    expect(
      screen.getByPlaceholderText(SOURCE_ADAPTERS.confluence.searchPlaceholder),
    ).toBeInTheDocument();
  });
});
