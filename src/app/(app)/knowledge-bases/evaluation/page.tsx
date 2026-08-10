"use client";

import EvaluationView from "@/components/rag/EvaluationView";
import { motion } from "framer-motion";

function EvaluationPage() {
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <motion.div
        key="evaluation"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex-1 flex flex-col min-h-0"
      >
        <EvaluationView />
      </motion.div>
    </div>
  );
}

export default function Evaluation() {
  return <EvaluationPage />;
}
