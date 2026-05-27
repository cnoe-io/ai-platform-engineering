/**
 * Tests for the Knowledge Bases &rarr; Graph page banner.
 *
 * The banner must render when:
 *   - the caller has at least one readable KB (`has_any_kb=true`), or
 *   - the BFF served the org-admin bypass (`orgAdminBypass=true`).
 *
 * It must stay hidden when the caller has no readable KB and is not an
 * admin — that state is already handled upstream by the `kb-tab-gates`
 * route (the tab itself is disabled) but we double-check the page is a
 * no-op in that case so a deep-link doesn't render an "empty" banner.
 *
 * assisted-by Cursor claude-opus-4-7
 */

import React from "react";
import { render, screen } from "@testing-library/react";

const replaceMock = jest.fn();
let mockGates: {
  search: boolean;
  data_sources: boolean;
  graph: boolean;
  mcp_tools: boolean;
  has_any_kb: boolean;
  kb_count: number;
} = {
  search: true,
  data_sources: true,
  graph: true,
  mcp_tools: true,
  has_any_kb: true,
  kb_count: 3,
};
let mockOrgAdminBypass = false;

jest.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: jest.fn(), replace: replaceMock, back: jest.fn() }),
  usePathname: () => "/knowledge-bases/graph",
}));

jest.mock("@/components/auth-guard", () => ({
  AuthGuard: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock("@/hooks/use-kb-tab-gates", () => ({
  useKbTabGates: () => ({
    gates: mockGates,
    loading: false,
    error: null,
    orgAdminBypass: mockOrgAdminBypass,
    visibleTabs: [],
    refresh: jest.fn(),
  }),
}));

jest.mock("@/components/rag/GraphView", () => ({
  __esModule: true,
  default: () => <div data-testid="graph-view">GraphView</div>,
}));

jest.mock("framer-motion", () => ({
  motion: new Proxy(
    {},
    {
      get:
        () =>
        ({ children, ...rest }: { children?: React.ReactNode; [k: string]: unknown }) => (
          <div {...(rest as Record<string, unknown>)}>{children}</div>
        ),
    },
  ),
}));

import Graph from "../page";

describe("Knowledge Bases &rarr; Graph page banner", () => {
  beforeEach(() => {
    replaceMock.mockReset();
    mockGates = {
      search: true,
      data_sources: true,
      graph: true,
      mcp_tools: true,
      has_any_kb: true,
      kb_count: 3,
    };
    mockOrgAdminBypass = false;
  });

  it("renders the amber info banner with the readable-KB count when the caller has any readable KBs", () => {
    render(<Graph />);

    const banner = screen.getByTestId("graph-info-banner");
    expect(banner).toBeInTheDocument();
    expect(banner.textContent).toContain("Global entity graph.");
    expect(banner.textContent).toContain("3 knowledge bases");
    expect(screen.getByTestId("graph-view")).toBeInTheDocument();
  });

  it("renders the banner without a count when the BFF served the org-admin bypass", () => {
    mockOrgAdminBypass = true;
    mockGates = {
      search: true,
      data_sources: true,
      graph: true,
      mcp_tools: true,
      has_any_kb: false,
      kb_count: -1,
    };

    render(<Graph />);

    const banner = screen.getByTestId("graph-info-banner");
    expect(banner).toBeInTheDocument();
    expect(banner.textContent).toContain("Global entity graph.");
    expect(banner.textContent).not.toContain("0 knowledge");
  });

  it("does not render the banner when the caller has no readable KBs and is not an admin", () => {
    mockGates = {
      search: false,
      data_sources: false,
      graph: false,
      mcp_tools: false,
      has_any_kb: false,
      kb_count: 0,
    };
    mockOrgAdminBypass = false;

    render(<Graph />);

    expect(screen.queryByTestId("graph-info-banner")).not.toBeInTheDocument();
    expect(screen.getByTestId("graph-view")).toBeInTheDocument();
  });

  it("uses the singular noun when exactly one KB is readable", () => {
    mockGates = {
      search: true,
      data_sources: true,
      graph: true,
      mcp_tools: true,
      has_any_kb: true,
      kb_count: 1,
    };

    render(<Graph />);

    const banner = screen.getByTestId("graph-info-banner");
    expect(banner.textContent).toContain("1 knowledge base)");
  });
});
