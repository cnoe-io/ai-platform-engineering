"use client";

import { RagAuthIndicator } from "@/components/rag/RagAuthBanner";
import { Button } from "@/components/ui/button";
import { useKbTabGates } from "@/hooks/use-kb-tab-gates";
import type { KbTabKey } from "@/lib/rbac/types";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import {
BarChart3,
BookOpen,
ChevronLeft,
ChevronRight,
Database,
GitFork,
Search,
Wrench,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface KnowledgeSidebarProps {
  collapsed: boolean;
  onCollapse: (collapsed: boolean) => void;
  graphRagEnabled: boolean;
}

const navItems: Array<{
  id: string;
  /** Key into the KB tab-gate map returned by GET /api/rbac/kb-tab-gates. */
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
  {
    id: "evaluation",
    // Reuse the data_sources gate so this tab is enabled wherever Data Sources is
    // (avoids adding a new RBAC tab gate + /api/rbac/kb-tab-gates change).
    gateKey: "data_sources",
    label: "Evaluation",
    href: "/knowledge-bases/evaluation",
    icon: BarChart3,
    description: "Run RAG evaluations",
  },
];

export function KnowledgeSidebar({ collapsed, onCollapse, graphRagEnabled }: KnowledgeSidebarProps) {
  const pathname = usePathname();
  const { gates, loading: gatesLoading, orgAdminBypass } = useKbTabGates();

  const getActiveTab = () => {
    if (pathname?.includes("/mcp-tools")) return "mcp-tools";
    if (pathname?.includes("/evaluation")) return "evaluation";
    if (pathname?.includes("/search")) return "search";
    if (pathname?.includes("/ingest")) return "ingest";
    if (pathname?.includes("/graph")) return "graph";
    return "search";
  };

  const activeTab = getActiveTab();
  // Only nudge "ask an admin to share a KB" when the user genuinely has nothing
  // to do here. A team granted an explicit capability (search/ingest) with no KB
  // assigned yet now has enabled tabs, so the share-request banner would
  // contradict them — each tab's own empty state guides them instead.
  const hasExplicitCapability = gates.can_ingest === true || gates.can_search === true;
  const showNoKbBanner =
    !collapsed &&
    !gatesLoading &&
    !orgAdminBypass &&
    gates.has_any_kb === false &&
    !hasExplicitCapability;

  return (
    <motion.div
      initial={false}
      animate={{ width: collapsed ? 64 : 280 }}
      transition={{ duration: 0.2 }}
      className="flex flex-col h-full bg-card/50 backdrop-blur-sm border-r border-border/50 shrink-0 overflow-hidden"
    >
      {/* Collapse Toggle */}
      <div className="flex items-center justify-end p-2 h-12">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onCollapse(!collapsed)}
          className="h-8 w-8 hover:bg-muted"
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronLeft className="h-4 w-4" />
          )}
        </Button>
      </div>

      {/* Knowledge Base Info */}
      {!collapsed && (
        <div 
          className="mx-3 mb-4 relative overflow-hidden rounded-xl border border-primary/20 p-4"
          style={{
            background: `linear-gradient(to bottom right, color-mix(in srgb, var(--gradient-from) 20%, transparent), color-mix(in srgb, var(--gradient-to) 15%, transparent), transparent)`
          }}
        >
          <div className="relative">
            <div className="w-10 h-10 mb-3 rounded-xl gradient-primary-br flex items-center justify-center shadow-lg shadow-primary/30">
              <BookOpen className="h-5 w-5 text-white" />
            </div>
            <p className="text-sm font-semibold gradient-text">Knowledge Bases</p>
            <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
              Manage your data sources, search content, and explore relationships.
            </p>
          </div>
        </div>
      )}

      {showNoKbBanner && (
        <div
          role="status"
          aria-live="polite"
          data-testid="kb-sidebar-no-access-banner"
          className="mx-3 mb-3 rounded-md border border-amber-300/40 bg-amber-100/20 px-3 py-2 text-xs text-amber-900 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-200"
        >
          You don&apos;t have access to any knowledge bases yet. Ask a team admin to share one
          with your team.
        </div>
      )}

      {/* Navigation Items */}
      <div className="flex-1 px-2">
        {!collapsed && (
          <div className="px-1 py-2 flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wider">
            <span>Navigation</span>
          </div>
        )}

        <nav className="space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            const graphDisabled = item.requiresGraphRag && !graphRagEnabled;
            // Fail-closed: while gates load OR if RBAC denies, the tab renders as
            // disabled-with-tooltip rather than a link the user could click and 403.
            const rbacAllowed = gatesLoading ? false : gates[item.gateKey] === true;
            const rbacDisabled = !rbacAllowed;
            const isDisabled = graphDisabled || rbacDisabled;
            const disabledTooltip = graphDisabled
              ? "Graph RAG is disabled in the RAG server config"
              : gatesLoading
                ? "Checking access…"
                : "You don't have access to any knowledge bases yet";

            if (isDisabled) {
              return (
                <div
                  key={item.id}
                  data-testid={`kb-tab-disabled-${item.id}`}
                  className={cn(
                    "flex items-center gap-3 p-2 rounded-lg cursor-not-allowed opacity-50",
                    collapsed && "justify-center"
                  )}
                  title={disabledTooltip}
                >
                  <div className={cn(
                    "shrink-0 w-8 h-8 rounded-md flex items-center justify-center bg-muted"
                  )}>
                    <Icon className="h-4 w-4 text-muted-foreground" />
                  </div>
                  {!collapsed && (
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-muted-foreground">
                        {item.label}
                      </p>
                      <p className="text-xs text-muted-foreground/70 truncate">
                        {item.description}
                      </p>
                    </div>
                  )}
                </div>
              );
            }

            return (
              <Link
                key={item.id}
                href={item.href}
                prefetch={true}
                className={cn(
                  "flex items-center gap-3 p-2 rounded-lg transition-all",
                  isActive
                    ? "bg-primary/10 border border-primary/30"
                    : "hover:bg-muted/50 border border-transparent",
                  collapsed && "justify-center"
                )}
              >
                <div className={cn(
                  "shrink-0 w-8 h-8 rounded-md flex items-center justify-center",
                  isActive
                    ? "bg-primary/20"
                    : "bg-muted"
                )}>
                  <Icon className={cn(
                    "h-4 w-4",
                    isActive
                      ? "text-primary"
                      : "text-muted-foreground"
                  )} />
                </div>
                {!collapsed && (
                  <div className="flex-1 min-w-0">
                    <p className={cn(
                      "text-sm font-medium",
                      isActive ? "text-primary" : "text-foreground"
                    )}>
                      {item.label}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {item.description}
                    </p>
                  </div>
                )}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Auth Status at bottom */}
      <div className={cn(
        "border-t border-border/50",
        collapsed ? "p-2 flex justify-center" : "p-3"
      )}>
        {!collapsed && (
          <div className="flex flex-col items-center gap-2">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">RAG Status</span>
            <RagAuthIndicator />
          </div>
        )}
        {collapsed && (
          <RagAuthIndicator compact />
        )}
      </div>
    </motion.div>
  );
}
