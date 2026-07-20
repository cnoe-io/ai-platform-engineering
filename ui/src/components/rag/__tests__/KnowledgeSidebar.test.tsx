/**
 * KnowledgeSidebar render-time RBAC gate tests.
 *
 * Verifies the Knowledge sidebar RBAC behavior:
 * - Org admins (org_admin_bypass=true) see every tab as a clickable Link.
 * - Non-admins with zero readable KBs see every tab rendered as the
 *   disabled-with-tooltip variant AND see the empty-state banner.
 * - Non-admins with at least one readable KB see the allowed tabs as
 *   Links, the empty-state banner is suppressed, and graph still respects
 *   the `graphRagEnabled` prop.
 * - Non-admins granted an explicit capability (search/ingest) but no KB see
 *   those capability tabs as Links and the share-request banner suppressed.
 * - While the hook is loading, all tabs are disabled (fail-closed).
 */

import React from "react";
import { render, screen } from "@testing-library/react";

jest.mock("next/link", () => {
  return React.forwardRef<HTMLAnchorElement, { children: React.ReactNode; href: string; className?: string }>(
    function MockLink({ children, href, className }, ref) {
      return (
        <a ref={ref} href={href} className={className} data-testid={`kb-link-${href}`}>
          {children}
        </a>
      );
    },
  );
});

jest.mock("next/navigation", () => ({
  usePathname: () => "/knowledge-bases/search",
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock("lucide-react", () => ({
  Database: (p: unknown) => <svg data-testid="icon-database" {...p} />,
  Search: (p: unknown) => <svg data-testid="icon-search" {...p} />,
  GitFork: (p: unknown) => <svg data-testid="icon-gitfork" {...p} />,
  ChevronDown: (p: unknown) => <svg data-testid="icon-chev-down" {...p} />,
  Wrench: (p: unknown) => <svg data-testid="icon-wrench" {...p} />,
  Lock: (p: unknown) => <svg data-testid="icon-lock" {...p} />,
  ShieldQuestion: (p: unknown) => <svg data-testid="icon-shieldq" {...p} />,
}));

jest.mock("@/lib/utils", () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(" "),
}));

jest.mock("@/components/ui/button", () => ({
  Button: ({ children, ...rest }: unknown) => <button {...rest}>{children}</button>,
}));

jest.mock("@/components/rag/RagAuthBanner", () => ({
  RagAuthIndicator: () => <div data-testid="rag-auth-indicator" />,
}));

const mockUseKbTabGates = jest.fn();
jest.mock("@/hooks/use-kb-tab-gates", () => ({
  useKbTabGates: () => mockUseKbTabGates(),
}));

import { KnowledgeSidebar } from "../KnowledgeSidebar";

function setGates(gates: {
  search?: boolean;
  data_sources?: boolean;
  graph?: boolean;
  mcp_tools?: boolean;
  has_any_kb?: boolean;
  kb_count?: number;
  can_ingest?: boolean;
  can_search?: boolean;
  loading?: boolean;
  orgAdminBypass?: boolean;
}) {
  mockUseKbTabGates.mockReturnValue({
    gates: {
      search: gates.search ?? false,
      data_sources: gates.data_sources ?? false,
      graph: gates.graph ?? false,
      mcp_tools: gates.mcp_tools ?? false,
      has_any_kb: gates.has_any_kb ?? false,
      kb_count: gates.kb_count ?? 0,
      can_ingest: gates.can_ingest ?? false,
      can_search: gates.can_search ?? false,
    },
    loading: gates.loading ?? false,
    error: null,
    orgAdminBypass: gates.orgAdminBypass ?? false,
    visibleTabs: [],
    refresh: jest.fn(),
  });
}

describe("<KnowledgeSidebar /> RBAC gates", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("org admin sees every tab as a link and no empty-state banner", () => {
    setGates({
      search: true,
      data_sources: true,
      graph: true,
      mcp_tools: true,
      has_any_kb: true,
      kb_count: -1,
      orgAdminBypass: true,
    });
    render(<KnowledgeSidebar graphRagEnabled={true} />);

    expect(screen.getByTestId("kb-link-/knowledge-bases/search")).toBeInTheDocument();
    expect(screen.getByTestId("kb-link-/knowledge-bases/ingest")).toBeInTheDocument();
    expect(screen.getByTestId("kb-link-/knowledge-bases/graph")).toBeInTheDocument();
    expect(screen.getByTestId("kb-link-/knowledge-bases/mcp-tools")).toBeInTheDocument();
    expect(screen.queryByTestId("kb-sidebar-no-access-banner")).not.toBeInTheDocument();
  });

  it("non-admin with zero readable KBs sees disabled tabs and the empty-state banner", () => {
    setGates({
      search: false,
      data_sources: false,
      graph: false,
      mcp_tools: false,
      has_any_kb: false,
      kb_count: 0,
      orgAdminBypass: false,
    });
    render(<KnowledgeSidebar graphRagEnabled={true} />);

    expect(screen.getByTestId("kb-sidebar-no-access-banner")).toBeInTheDocument();
    expect(screen.queryByTestId("kb-link-/knowledge-bases/search")).not.toBeInTheDocument();
    expect(screen.queryByTestId("kb-link-/knowledge-bases/ingest")).not.toBeInTheDocument();
    expect(screen.queryByTestId("kb-link-/knowledge-bases/graph")).not.toBeInTheDocument();
    expect(screen.queryByTestId("kb-link-/knowledge-bases/mcp-tools")).not.toBeInTheDocument();
    expect(screen.getByTestId("kb-tab-disabled-search")).toBeInTheDocument();
    expect(screen.getByTestId("kb-tab-disabled-ingest")).toBeInTheDocument();
    expect(screen.getByTestId("kb-tab-disabled-graph")).toBeInTheDocument();
    expect(screen.getByTestId("kb-tab-disabled-mcp-tools")).toBeInTheDocument();
  });

  it("team granted Search+Ingest with no KB assigned sees those tabs as links and NO share-request banner", () => {
    // Regression guard for the screenshot-2 scenario: the org admin enabled both
    // capabilities for the team but assigned no KB. The capability-driven tabs
    // must be clickable links (not greyed out), and the "ask an admin to share a
    // KB" banner must be suppressed because it would contradict them.
    setGates({
      search: true,
      data_sources: true,
      graph: false,
      mcp_tools: true,
      has_any_kb: false,
      kb_count: 0,
      can_ingest: true,
      can_search: true,
      orgAdminBypass: false,
    });
    render(<KnowledgeSidebar graphRagEnabled={true} />);

    expect(screen.queryByTestId("kb-sidebar-no-access-banner")).not.toBeInTheDocument();
    expect(screen.getByTestId("kb-link-/knowledge-bases/search")).toBeInTheDocument();
    expect(screen.getByTestId("kb-link-/knowledge-bases/ingest")).toBeInTheDocument();
    expect(screen.getByTestId("kb-link-/knowledge-bases/mcp-tools")).toBeInTheDocument();
    // Graph stays disabled — it is purely read-driven and there is no readable KB.
    expect(screen.getByTestId("kb-tab-disabled-graph")).toBeInTheDocument();
  });

  it("non-admin with at least one readable KB sees allowed tabs as links and no banner", () => {
    setGates({
      search: true,
      data_sources: true,
      graph: true,
      mcp_tools: true,
      has_any_kb: true,
      kb_count: 2,
      orgAdminBypass: false,
    });
    render(<KnowledgeSidebar graphRagEnabled={true} />);

    expect(screen.queryByTestId("kb-sidebar-no-access-banner")).not.toBeInTheDocument();
    expect(screen.getByTestId("kb-link-/knowledge-bases/search")).toBeInTheDocument();
    expect(screen.getByTestId("kb-link-/knowledge-bases/ingest")).toBeInTheDocument();
    expect(screen.getByTestId("kb-link-/knowledge-bases/graph")).toBeInTheDocument();
    expect(screen.getByTestId("kb-link-/knowledge-bases/mcp-tools")).toBeInTheDocument();
  });

  it("graphRagEnabled=false disables Graph even when RBAC allows it", () => {
    setGates({
      search: true,
      data_sources: true,
      graph: true,
      mcp_tools: true,
      has_any_kb: true,
      kb_count: 1,
    });
    render(<KnowledgeSidebar graphRagEnabled={false} />);

    expect(screen.getByTestId("kb-tab-disabled-graph")).toBeInTheDocument();
    expect(screen.queryByTestId("kb-link-/knowledge-bases/graph")).not.toBeInTheDocument();
  });

  it("fails closed while gates are loading", () => {
    setGates({
      search: true,
      data_sources: true,
      graph: true,
      mcp_tools: true,
      has_any_kb: true,
      kb_count: 1,
      loading: true,
    });
    render(<KnowledgeSidebar graphRagEnabled={true} />);
    expect(screen.queryByTestId("kb-link-/knowledge-bases/search")).not.toBeInTheDocument();
    expect(screen.getByTestId("kb-tab-disabled-search")).toBeInTheDocument();
  });

  it("uses the page-style navigation without a collapse control", () => {
    setGates({ has_any_kb: false });
    render(<KnowledgeSidebar graphRagEnabled={true} />);
    expect(screen.getByTestId("kb-sidebar-no-access-banner")).toBeInTheDocument();
    expect(screen.queryByRole("button",{ name: /knowledge base navigation/i })).not.toBeInTheDocument();
  });
});
