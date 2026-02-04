"use client";

import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useSearchParams, useRouter } from "next/navigation";
import { AuthGuard } from "@/components/auth-guard";
import GraphView from "@/components/rag/GraphView";

function GraphPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [exploreData, setExploreData] = useState<{ entityType: string; primaryKey: string } | null>(null);

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
    // Remove query params
    router.replace('/knowledge-bases/graph');
  };

  return (
    <div className="flex-1 flex overflow-hidden">
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
  return <GraphPage />;
}
