import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ConfluenceManualAdd } from "../ConfluenceManualAdd";

const pageUrl =
  "https://example.atlassian.net/wiki/spaces/PLATFORM/pages/123/Overview";

function Harness({ onSelect }: { onSelect: jest.Mock }) {
  const [value, setValue] = useState("");
  return (
    <ConfluenceManualAdd
      value={value}
      onValueChange={setValue}
      onSelect={onSelect}
    />
  );
}

describe("ConfluenceManualAdd", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("uses a space URL without calling the page preview API", async () => {
    const user = userEvent.setup();
    const onSelect = jest.fn();
    render(<Harness onSelect={onSelect} />);

    const input = screen.getByLabelText("Confluence space or page URL");
    await user.type(
      input,
      "https://example.atlassian.net/wiki/spaces/PLATFORM",
    );
    await user.click(screen.getByRole("button", { name: "Use" }));

    expect(onSelect).toHaveBeenCalledWith(
      "https://example.atlassian.net/wiki/spaces/PLATFORM",
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("previews a page tree and persists the chosen scope", async () => {
    const user = userEvent.setup();
    const onSelect = jest.fn();
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          source_url: pageUrl,
          scope: {
            page_id: "123",
            page_title: "Overview",
            space_key: "PLATFORM",
            include_descendants: true,
          },
          pages: [
            {
              id: "123",
              title: "Overview",
              parent_id: null,
              depth: 0,
              url: pageUrl,
            },
            {
              id: "456",
              title: "Architecture",
              parent_id: "123",
              depth: 1,
              url: `${pageUrl}/456`,
            },
          ],
          truncated: false,
        },
      }),
    });

    render(<Harness onSelect={onSelect} />);
    await user.type(
      screen.getByLabelText("Confluence space or page URL"),
      pageUrl,
    );
    await user.click(screen.getByRole("button", { name: "Preview" }));

    expect(await screen.findByText("Page found")).toBeInTheDocument();
    expect(screen.getByText("1 accessible subpage")).toBeInTheDocument();
    await user.click(screen.getByText("Preview included pages"));
    expect(screen.getByTitle("Architecture")).toBeInTheDocument();

    await user.click(screen.getByText("This page only"));
    await user.click(screen.getByRole("button", { name: "Add source" }));

    await waitFor(() =>
      expect(onSelect).toHaveBeenCalledWith(
        pageUrl,
        expect.objectContaining({
          page_id: "123",
          include_descendants: false,
        }),
      ),
    );
  });
});
