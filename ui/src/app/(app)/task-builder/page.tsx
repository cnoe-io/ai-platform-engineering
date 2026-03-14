"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Pencil, Trash2, Workflow, Copy } from "lucide-react";
import { AuthGuard } from "@/components/auth-guard";
import { TaskBuilderCanvas } from "@/components/task-builder";
import { WorkflowTemplateDialog, type WorkflowTemplate } from "@/components/task-builder/WorkflowTemplateDialog";
import { labelFor } from "@/hooks/use-agent-tools";
import { useTaskConfigStore } from "@/store/task-config-store";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { TaskConfig, TaskStep } from "@/types/task-config";

type ViewMode = "list" | "editor";

export default function TaskBuilderPage() {
  const router = useRouter();
  const { configs, isLoading, loadConfigs, deleteConfig } = useTaskConfigStore();
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [editingConfig, setEditingConfig] = useState<TaskConfig | undefined>(undefined);
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [seedSteps, setSeedSteps] = useState<TaskStep[] | undefined>(undefined);
  const [seedName, setSeedName] = useState<string | undefined>(undefined);
  const [seedCategory, setSeedCategory] = useState<string | undefined>(undefined);

  useEffect(() => {
    loadConfigs();
  }, [loadConfigs]);

  const handleCreateNew = () => {
    setTemplateDialogOpen(true);
  };

  const handleTemplateSelect = (template: WorkflowTemplate) => {
    setEditingConfig(undefined);
    if (template.steps.length > 0) {
      setSeedSteps(template.steps);
      setSeedName(template.name !== "Blank Workflow" ? template.name : undefined);
      setSeedCategory(template.category);
    } else {
      setSeedSteps(undefined);
      setSeedName(undefined);
      setSeedCategory(undefined);
    }
    setViewMode("editor");
  };

  const handleClone = (config: TaskConfig) => {
    setEditingConfig(undefined);
    setSeedSteps(config.tasks.map((t) => ({ ...t })));
    setSeedName(`${config.name} (Copy)`);
    setSeedCategory(config.category);
    setViewMode("editor");
  };

  const handleEdit = (config: TaskConfig) => {
    setEditingConfig(config);
    setSeedSteps(undefined);
    setSeedName(undefined);
    setSeedCategory(undefined);
    setViewMode("editor");
  };

  const handleDelete = async (config: TaskConfig) => {
    if (config.is_system) return;
    if (!window.confirm(`Delete "${config.name}"? This cannot be undone.`)) return;
    await deleteConfig(config.id);
  };

  const handleBack = () => {
    setViewMode("list");
    setEditingConfig(undefined);
    setSeedSteps(undefined);
    setSeedName(undefined);
    setSeedCategory(undefined);
    loadConfigs();
  };

  const grouped = configs.reduce<Record<string, TaskConfig[]>>((acc, c) => {
    const cat = c.category || "Custom";
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(c);
    return acc;
  }, {});

  return (
    <AuthGuard>
      <div className="flex flex-col h-full overflow-hidden">
        <AnimatePresence mode="wait">
          {viewMode === "list" && (
            <motion.div
              key="list"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="flex-1 overflow-y-auto p-6"
            >
              <div className="max-w-5xl mx-auto">
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
                      <Workflow className="h-6 w-6 text-primary" />
                      Task Builder
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1">
                      Create and manage self-service workflows for the supervisor agent
                    </p>
                  </div>
                  <Button onClick={handleCreateNew} className="gap-1.5 gradient-primary text-white">
                    <Plus className="h-4 w-4" />
                    New Workflow
                  </Button>
                </div>

                {isLoading ? (
                  <div className="flex items-center justify-center py-20">
                    <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
                  </div>
                ) : configs.length === 0 ? (
                  <div className="text-center py-20">
                    <Workflow className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
                    <h3 className="text-lg font-semibold text-foreground mb-2">No task configs yet</h3>
                    <p className="text-sm text-muted-foreground mb-4">
                      Create your first self-service workflow or seed from task_config.yaml
                    </p>
                    <Button onClick={handleCreateNew} className="gap-1.5">
                      <Plus className="h-4 w-4" />
                      Create Workflow
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-8">
                    {Object.entries(grouped).map(([category, categoryConfigs]) => (
                      <div key={category}>
                        <h2 className="text-sm font-bold text-muted-foreground uppercase tracking-wider mb-3">
                          {category}
                        </h2>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                          {categoryConfigs.map((config) => (
                            <div
                              key={config.id}
                              className={cn(
                                "group border rounded-xl p-4 transition-all hover:border-primary/50 hover:shadow-md cursor-pointer",
                                "bg-card/50 border-border"
                              )}
                              onClick={() => handleEdit(config)}
                            >
                              <div className="flex items-start justify-between mb-2">
                                <h3 className="text-sm font-semibold text-foreground leading-tight">
                                  {config.name}
                                </h3>
                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button
                                    onClick={(e) => { e.stopPropagation(); handleClone(config); }}
                                    className="p-1 rounded hover:bg-primary/10 text-muted-foreground hover:text-primary"
                                    title="Clone workflow"
                                  >
                                    <Copy className="h-3.5 w-3.5" />
                                  </button>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); handleEdit(config); }}
                                    className="p-1 rounded hover:bg-primary/10 text-muted-foreground hover:text-primary"
                                    title="Edit workflow"
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                  </button>
                                  {!config.is_system && (
                                    <button
                                      onClick={(e) => { e.stopPropagation(); handleDelete(config); }}
                                      className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                                      title="Delete workflow"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  )}
                                </div>
                              </div>
                              {config.description && (
                                <p className="text-xs text-muted-foreground line-clamp-2 mb-3">
                                  {config.description}
                                </p>
                              )}
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] font-mono text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded">
                                  {config.tasks.length} step{config.tasks.length !== 1 ? "s" : ""}
                                </span>
                                {config.is_system && (
                                  <span className="text-[10px] font-semibold text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                                    System
                                  </span>
                                )}
                                <span className="text-[10px] text-muted-foreground">
                                  {config.tasks.map((t) => t.subagent).filter((v, i, a) => a.indexOf(v) === i).map(labelFor).join(", ")}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {viewMode === "editor" && (
            <motion.div
              key="editor"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="flex-1 overflow-hidden"
            >
              <TaskBuilderCanvas
                existingConfig={editingConfig}
                initialSteps={seedSteps}
                initialName={seedName}
                initialCategory={seedCategory}
                onBack={handleBack}
              />
            </motion.div>
          )}
        </AnimatePresence>

        <WorkflowTemplateDialog
          open={templateDialogOpen}
          onClose={() => setTemplateDialogOpen(false)}
          onSelect={handleTemplateSelect}
        />
      </div>
    </AuthGuard>
  );
}
