"use client";

import { AuthGuard } from "@/components/auth-guard";
import GraphView from "@/components/rag/GraphView";
import { useKbTabGates } from "@/hooks/use-kb-tab-gates";
import { motion } from "framer-motion";
import { useRouter,useSearchParams } from "next/navigation";

/**
 * The ontology graph is currently a global Neo4j store keyed by
 * `_datasource_id`. Per-KB filtering is on the roadmap (see
 * `docs/docs/specs/2026-05-27-per-kb-ontology-graph-filtering/`). Today
 * the tab is hidden when the caller has zero readable KBs, and a one-line
 * banner reminds users that the entities shown below are the global set.
 *
 * assisted-by Cursor claude-opus-4-7
 */
function GraphInfoBanner({ kbCount }: { kbCount: number }) {
  return (
    <div
      role="status"
      data-testid="graph-info-banner"
      className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
    >
      <strong className="font-medium">Global entity graph.</strong>{" "}
      Showing entities from every knowledge base in the deployment. Per-KB
      filtering is on the roadmap; contact an admin if you need a narrower
      scope.{" "}
      {kbCount >= 0 ? (
        <span className="text-xs text-amber-800/80 dark:text-amber-300/70">
          (you have read access to {kbCount} knowledge {kbCount === 1 ? "base" : "bases"})
        </span>
      ) : null}
    </div>
  );
}

function GraphPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { gates, orgAdminBypass } = useKbTabGates();

  // Derive exploreData directly from URL search params — no useState/useEffect needed.
  const entityType = searchParams?.get('entityType');
  const primaryKey = searchParams?.get('primaryKey');
  const exploreData = entityType && primaryKey ? { entityType, primaryKey } : null;

  const handleExploreComplete = () => {
    router.replace('/knowledge-bases/graph');
  };

  // Render the banner whenever we have a resolved KB count. `-1` from
  // the API is the documented "org-admin bypass, count unknown"
  // signal — admins still see the banner so they know the scope.
  const kbCount = gates?.kb_count ?? -1;
  const showBanner = orgAdminBypass || (gates?.has_any_kb ?? false);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {showBanner ? <GraphInfoBanner kbCount={kbCount} /> : null}
      <motion.div
        key="graph"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex-1 overflow-hidden"
      >
        <GraphView
          exploreEntityData={exploreData}
          onExploreComplete={handleExploreComplete}
        />
      </motion.div>
    </div>
  );
}

export default function Graph() {
  return (
    <AuthGuard>
      <GraphPage />
    </AuthGuard>
  );
}
