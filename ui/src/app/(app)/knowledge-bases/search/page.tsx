"use client";

import React, { useState, useCallback } from "react";
import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { AuthGuard } from "@/components/auth-guard";
import SearchView from "@/components/rag/SearchView";

function SearchPage() {
  const router = useRouter();

  const handleExploreEntity = useCallback((entityType: string, primaryKey: string) => {
    // Navigate to graph view with query params
    router.push(`/knowledge-bases/graph?entityType=${encodeURIComponent(entityType)}&primaryKey=${encodeURIComponent(primaryKey)}`);
  }, [router]);

  return (
    <div className="flex-1 flex overflow-hidden">
      <motion.div
        key="search"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex-1 overflow-hidden"
      >
        <SearchView onExploreEntity={handleExploreEntity} />
      </motion.div>
    </div>
  );
}

export default function Search() {
  return (
    <AuthGuard>
      <SearchPage />
    </AuthGuard>
  );
}
