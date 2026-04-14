"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  SkillsGallery,
  TrySkillsGateway,
} from "@/components/skills";
import { AuthGuard } from "@/components/auth-guard";

type SkillsTab = "browse" | "gateway";

export default function SkillsPage() {
  const router = useRouter();
  const [skillsTab, setSkillsTab] = useState<SkillsTab>("browse");

  const handleEditConfig = (config: { id: string }) => {
    router.push(`/skills/editor?id=${encodeURIComponent(config.id)}`);
  };

  const handleCreateNew = () => {
    router.push("/skills/editor");
  };

  return (
    <AuthGuard>
      <div className="flex flex-col h-full overflow-hidden">
        <div className="shrink-0 border-b border-border px-6 pt-4 pb-2 flex gap-2">
          <button
            type="button"
            onClick={() => setSkillsTab("browse")}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              skillsTab === "browse"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted"
            }`}
          >
            Browse
          </button>
          <button
            type="button"
            onClick={() => setSkillsTab("gateway")}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              skillsTab === "gateway"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted"
            }`}
          >
            Try API / Gateway
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          <AnimatePresence mode="wait">
            {skillsTab === "gateway" && (
              <motion.div
                key="gateway"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
              >
                <TrySkillsGateway />
              </motion.div>
            )}
            {skillsTab === "browse" && (
              <motion.div
                key="gallery"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="h-full"
              >
                <SkillsGallery
                  onEditConfig={handleEditConfig}
                  onCreateNew={handleCreateNew}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </AuthGuard>
  );
}
