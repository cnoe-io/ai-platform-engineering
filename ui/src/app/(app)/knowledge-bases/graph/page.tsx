"use client";

import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useSearchParams, useRouter } from "next/navigation";
import { AuthGuard } from "@/components/auth-guard";
import GraphView from "@/components/rag/GraphView";
import { useKbTabGates } from "@/hooks/use-kb-tab-gates";

/**
 * Phase-4 follow-up note: the ontology graph is currently a global
 * Neo4j store keyed by `_datasource_id`. Per-KB filtering is on the
 * roadmap (see `docs/docs/specs/2026-05-27-per-kb-ontology-graph-filtering/`
 * once that spec lands). Today the tab is hidden when the caller has
 * zero readable KBs (PR 2 / PR 5 of the 2026-05-27 fine-grained KB
 * ReBAC plan), and a one-line banner reminds users that the entities
 * shown below are the global set.
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
  const [exploreData, setExploreData] = useState<{ entityType: string; primaryKey: string } | null>(null);
  const { gates, orgAdminBypass } = useKbTabGates();

  useEffect(() => {
    const entityType = searchParams?.get('entityType');
    const primaryKey = searchParams?.get('primaryKey');

    if (entityType && primaryKey) {
      setExploreData({ entityType, primaryKey });
    } else {
      setExploreData(null);
    }
  }, [searchParams]);

  const handleExploreComplete = () => {
    setExploreData(null);
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
