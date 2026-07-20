"use client";

import {
  WorkspaceSectionNavigation,
  type WorkspaceNavigationGroup,
} from "@/components/layout/WorkspaceNavigation";
import { RagAuthIndicator } from "@/components/rag/RagAuthBanner";
import { useKbTabGates } from "@/hooks/use-kb-tab-gates";
import type { KbTabKey } from "@/lib/rbac/types";
import { Database,GitFork,Search,Wrench } from "lucide-react";
import { usePathname } from "next/navigation";

interface KnowledgeSidebarProps {
  graphRagEnabled: boolean;
}

const NAV_ITEMS: Array<{
  id: string;
  gateKey: KbTabKey;
  label: string;
  href: string;
  icon: typeof Search;
  description: string;
  requiresGraphRag?: boolean;
}> = [
  {
    id: "search",
    gateKey: "search",
    label: "Search",
    href: "/knowledge-bases/search",
    icon: Search,
    description: "Search your knowledge base",
  },
  {
    id: "ingest",
    gateKey: "data_sources",
    label: "Data Sources",
    href: "/knowledge-bases/ingest",
    icon: Database,
    description: "Ingest and manage sources",
  },
  {
    id: "graph",
    gateKey: "graph",
    label: "Graph",
    href: "/knowledge-bases/graph",
    icon: GitFork,
    description: "Explore entity relationships",
    requiresGraphRag: true,
  },
  {
    id: "mcp-tools",
    gateKey: "mcp_tools",
    label: "MCP Tools",
    href: "/knowledge-bases/mcp-tools",
    icon: Wrench,
    description: "Configure MCP search tools",
  },
];

function activeTabForPath(pathname: string | null): string {
  if (pathname?.includes("/mcp-tools")) return "mcp-tools";
  if (pathname?.includes("/ingest")) return "ingest";
  if (pathname?.includes("/graph")) return "graph";
  return "search";
}

function NoKnowledgeBaseAccessBanner({ testId }: { testId: string }): React.ReactElement {
  return (
    <div
      aria-live="polite"
      className="rounded-lg border border-amber-300/40 bg-amber-100/20 px-3 py-2 text-xs text-amber-900 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-200"
      data-testid={testId}
      role="status"
    >
      You don&apos;t have access to any knowledge bases yet. Ask a team admin to share one
      with your team.
    </div>
  );
}

export function KnowledgeSidebar({
  graphRagEnabled,
}: KnowledgeSidebarProps): React.ReactElement {
  const pathname = usePathname();
  const { gates,loading: gatesLoading,orgAdminBypass } = useKbTabGates();
  const activeTab = activeTabForPath(pathname);

  const hasExplicitCapability = gates.can_ingest === true || gates.can_search === true;
  const showNoKbBanner =
    !gatesLoading &&
    !orgAdminBypass &&
    gates.has_any_kb === false &&
    !hasExplicitCapability;

  const groups: WorkspaceNavigationGroup[] = [{
    id: "knowledge-base-sections",
    items: NAV_ITEMS.map((item) => {
      const graphDisabled = item.requiresGraphRag && !graphRagEnabled;
      const rbacAllowed = !gatesLoading && gates[item.gateKey] === true;
      const disabled = Boolean(graphDisabled || !rbacAllowed);
      const disabledReason = graphDisabled
        ? "Graph RAG is disabled in the RAG server config"
        : gatesLoading
          ? "Checking access…"
          : "You don't have access to this knowledge base section";
      return {
        ...item,
        disabled,
        disabledReason,
        prefetch: true,
        testId: disabled ? `kb-tab-disabled-${item.id}` : `kb-link-${item.href}`,
      };
    }),
  }];

  const accessStatus = (
    <div className="mt-7 px-2">
      <div className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground">
        Knowledge Base access
      </div>
      <div className="flex justify-start">
        <RagAuthIndicator />
      </div>
    </div>
  );

  return (
    <WorkspaceSectionNavigation
      activeItemId={activeTab}
      desktopFooter={(
        <>
          {showNoKbBanner ? (
            <div className="mt-4">
              <NoKnowledgeBaseAccessBanner testId="kb-sidebar-no-access-banner" />
            </div>
          ) : null}
          {accessStatus}
        </>
      )}
      groups={groups}
      mobileFooter={showNoKbBanner ? (
        <NoKnowledgeBaseAccessBanner testId="kb-mobile-no-access-banner" />
      ) : null}
      navigationLabel="Knowledge Base sections"
      pickerLabel="Knowledge Base section"
    />
  );
}
