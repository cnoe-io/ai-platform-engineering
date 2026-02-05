"use client";

import React from "react";
import { motion } from "framer-motion";
import { AuthGuard } from "@/components/auth-guard";
import IngestView from "@/components/rag/IngestView";

function IngestPage() {
  return (
    <div className="flex-1 flex overflow-hidden">
      <motion.div
        key="ingest"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex-1 overflow-hidden"
      >
        <IngestView />
      </motion.div>
    </div>
  );
}

export default function Ingest() {
  return <IngestPage />;
}
