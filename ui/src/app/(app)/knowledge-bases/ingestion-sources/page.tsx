"use client";

import IngestionSourcesView from "@/components/rag/IngestionSourcesView";
import { motion } from "framer-motion";

function IngestionSourcesPage() {
  return (
    <div className="flex-1 flex overflow-hidden">
      <motion.div
        key="ingestion-sources"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex-1 overflow-hidden"
      >
        <IngestionSourcesView />
      </motion.div>
    </div>
  );
}

export default function IngestionSources() {
  return <IngestionSourcesPage />;
}
