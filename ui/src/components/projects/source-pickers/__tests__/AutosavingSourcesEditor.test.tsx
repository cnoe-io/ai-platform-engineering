import { act, fireEvent, render, screen } from "@testing-library/react";

import { AutosavingSourcesEditor } from "../AutosavingSourcesEditor";

const selectedSources = {
  confluence_url: "https://example.atlassian.net/wiki/spaces/PLATFORM",
  confluence_page_scopes: [
    {
      page_id: "123",
      page_title: "Architecture",
      space_key: "PLATFORM",
      include_descendants: true,
    },
  ],
};

jest.mock("../SourcesEditor", () => ({
  SourcesEditor: ({
    onChange,
  }: {
    onChange: (next: typeof selectedSources) => void;
  }) => (
    <button type="button" onClick={() => onChange(selectedSources)}>
      Select page root
    </button>
  ),
}));

describe("AutosavingSourcesEditor", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          project: {
            slug: "example",
            sources: selectedSources,
          },
        },
      }),
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("saves source selections after the debounce timeout", async () => {
    render(
      <AutosavingSourcesEditor
        slug="example"
        kinds={["confluence"]}
        value={{}}
        onChange={jest.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Select page root" }));
    expect(screen.getByText("Source changes pending…")).toBeInTheDocument();

    await act(async () => {
      jest.advanceTimersByTime(800);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText("Source selections saved")).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledWith("/api/projects/example", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sources: {
          ...selectedSources,
          repos: [],
          confluence_page_scope: null,
        },
      }),
    });
  });

  it("flushes a pending save when focus leaves the source editor", async () => {
    render(
      <>
        <AutosavingSourcesEditor
          slug="example"
          kinds={["confluence"]}
          value={{}}
          onChange={jest.fn()}
        />
        <button type="button">Outside</button>
      </>,
    );

    const selectButton = screen.getByRole("button", {
      name: "Select page root",
    });
    selectButton.focus();
    await act(async () => {
      fireEvent.click(selectButton);
      fireEvent.blur(selectButton, {
        relatedTarget: screen.getByRole("button", { name: "Outside" }),
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Source selections saved")).toBeInTheDocument();
  });
});
