"use client";

import {
  WorkspaceNavigationList,
  type WorkspaceNavigationGroup,
} from "@/components/layout/WorkspaceNavigation";
import { useKbTabGates } from "@/hooks/use-kb-tab-gates";
import { Database,GitFork,Plug,Search,Wrench } from "lucide-react";
import { usePathname } from "next/navigation";

interface KnowledgeSidebarProps {
  graphRagEnabled: boolean;
}

export const KNOWLEDGE_NAV_ITEMS: Array<{
  id: string;
  label: string;
  href: string;
  icon: typeof Search;
  description: string;
  requiresGraphRag?: boolean;
}> = [
  {
    id: "search",
    label: "Search",
    href: "/knowledge-bases/search",
    icon: Search,
    description: "Search your knowledge base",
  },
  {
    id: "ingest",
    label: "Data Sources",
    href: "/knowledge-bases/ingest",
    icon: Database,
    description: "Ingest and manage sources",
  },
  {
    id: "graph",
    label: "Graph",
    href: "/knowledge-bases/graph",
    icon: GitFork,
    description: "Explore entity relationships",
    requiresGraphRag: true,
  },
  {
    id: "mcp-tools",
    label: "MCP Tools",
    href: "/knowledge-bases/mcp-tools",
    icon: Wrench,
    description: "Configure MCP search tools",
  },
  {
    id: "ingestion-sources",
    label: "Ingestion Sources",
    href: "/knowledge-bases/ingestion-sources",
    icon: Plug,
    description: "Manage where content is ingested from",
  },
];

export function knowledgeTabForPath(pathname: string | null): string {
  if (!pathname?.startsWith("/knowledge-bases")) return "";
  if (pathname?.includes("/mcp-tools")) return "mcp-tools";
  if (pathname?.includes("/ingestion-sources")) return "ingestion-sources";
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
  const activeTab = knowledgeTabForPath(pathname);

  const hasExplicitCapability = gates.can_ingest === true || gates.can_search === true;
  const showNoKbBanner =
    !gatesLoading &&
    !orgAdminBypass &&
    gates.has_any_kb === false &&
    !hasExplicitCapability;

  const groups: WorkspaceNavigationGroup[] = [{
    id: "knowledge-base-sections",
    items: KNOWLEDGE_NAV_ITEMS
      .filter((item) => !item.requiresGraphRag || graphRagEnabled)
      .map((item) => ({
        ...item,
        testId: `kb-link-${item.href}`,
      })),
  }];

  return (
    <>
      <WorkspaceNavigationList
        activeItemId={activeTab}
        ariaLabel="Knowledge Base sections"
        groups={groups}
      />
      {showNoKbBanner ? (
        <div className="mt-4">
          <NoKnowledgeBaseAccessBanner testId="kb-sidebar-no-access-banner" />
        </div>
      ) : null}
    </>
  );
}
