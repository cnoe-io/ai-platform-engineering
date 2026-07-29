import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

import {
  RemoteMCPCatalogDialog,
  type RemoteMCPTemplate,
} from "../RemoteMCPCatalogDialog";

const catalogConfig = {
  success: true,
  data: {
    remote_mcp_catalog: {
      enabled_providers: null,
      custom_entries: [
        {
          id: "example-search",
          name: "Example Search",
          description: "Search example documents",
          endpoint: "https://mcp.example.test/mcp",
          provider_key: "example-search",
        },
      ],
    },
  },
};

function renderCatalog(options: {
  onSelect?: (template: RemoteMCPTemplate) => void;
} = {}) {
  const onSelect = options.onSelect ?? jest.fn();
  render(
    <RemoteMCPCatalogDialog
      open
      onOpenChange={jest.fn()}
      onSelect={onSelect}
      onSelectCustom={jest.fn()}
    />,
  );
  return { onSelect };
}

describe("RemoteMCPCatalogDialog", () => {
  beforeEach(() => {
    global.fetch = jest.fn(async () => ({
      json: async () => catalogConfig,
    })) as unknown as typeof fetch;
  });

  it.each([
    ["Figma", "https://mcp.figma.com/mcp", "figma"],
    ["Box", "https://mcp.box.com", "box"],
    ["Airtable", "https://mcp.airtable.com/mcp", "airtable"],
  ])("pre-fills the official %s MCP endpoint", async (name, endpoint, provider) => {
    const { onSelect } = renderCatalog();

    fireEvent.click(await screen.findByText(name, { exact: true }));

    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        name,
        endpoint,
        credential_sources: [
          expect.objectContaining({
            kind: "provider_connection",
            provider,
          }),
        ],
      }),
    );
  });

  it("pre-fills the public AWS Knowledge MCP endpoint without credentials", async () => {
    const { onSelect } = renderCatalog();

    fireEvent.click(await screen.findByText("AWS Knowledge", { exact: true }));

    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "AWS Knowledge",
        endpoint: "https://knowledge-mcp.global.api.aws",
        credential_sources: [],
      }),
    );
  });

  it("filters built-in and custom providers by name, hostname, and description", async () => {
    renderCatalog();
    const search = await screen.findByRole("searchbox", { name: "Search MCP providers" });

    fireEvent.change(search, { target: { value: "airtable" } });
    expect(screen.getByText("Airtable", { exact: true })).toBeInTheDocument();
    expect(screen.queryByText("Box", { exact: true })).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: "mcp.box.com" } });
    expect(screen.getByText("Box", { exact: true })).toBeInTheDocument();
    expect(screen.queryByText("Airtable", { exact: true })).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: "example documents" } });
    expect(screen.getByText("Example Search", { exact: true })).toBeInTheDocument();
    expect(screen.queryByText("Box", { exact: true })).not.toBeInTheDocument();
  });

  it("shows a no-results state while preserving the custom-server action", async () => {
    renderCatalog();

    fireEvent.change(
      await screen.findByRole("searchbox", { name: "Search MCP providers" }),
      { target: { value: "no-such-provider" } },
    );

    expect(screen.getByText("No MCP providers found")).toBeInTheDocument();
    expect(screen.getByText("Custom", { exact: true })).toBeInTheDocument();
  });

  it("keeps search outside the bounded scrolling results region", async () => {
    renderCatalog();
    const search = await screen.findByRole("searchbox", { name: "Search MCP providers" });
    const results = screen.getByTestId("mcp-provider-results");

    expect(results).toHaveClass("min-h-0", "overflow-y-auto");
    expect(results.contains(search)).toBe(false);
  });

  it("renders the three providers from local logo assets", async () => {
    renderCatalog();
    await screen.findByText("Figma", { exact: true });

    for (const [name, src] of [
      ["Figma", "/provider-logos/figma.svg"],
      ["Box", "/provider-logos/box.svg"],
      ["Airtable", "/provider-logos/airtable.svg"],
    ]) {
      const tile = screen.getByText(name, { exact: true }).closest("button");
      expect(tile).not.toBeNull();
      expect(tile!.querySelector("img")).toHaveAttribute("src", src);
    }
  });
});
