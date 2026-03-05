"use client";

import React, { useCallback, useRef, useState } from "react";
import {
  X,
  Upload,
  Link2,
  FileText,
  AlertCircle,
  Loader2,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { TaskConfig, TaskStep } from "@/types/task-config";

interface ImportDialogProps {
  open: boolean;
  onClose: () => void;
  savedConfigs: TaskConfig[];
  onLoadConfig: (config: TaskConfig) => void;
  onImportSteps: (name: string, category: string, steps: TaskStep[]) => void;
}

type Tab = "saved" | "file" | "url";

export function ImportDialog({
  open,
  onClose,
  savedConfigs,
  onLoadConfig,
  onImportSteps,
}: ImportDialogProps) {
  const [tab, setTab] = useState<Tab>("saved");
  const [url, setUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetState = () => {
    setError(null);
    setSuccess(null);
    setIsLoading(false);
  };

  const parseYamlContent = async (yamlText: string) => {
    const response = await fetch("/api/task-configs/seed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ yaml_content: yamlText }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || `Import failed: ${response.status}`);
    }

    const result = await response.json();
    return result;
  };

  const handleFileUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      resetState();
      setIsLoading(true);

      try {
        const text = await file.text();
        const result = await parseYamlContent(text);
        setSuccess(
          `Imported ${result.data?.count ?? 0} workflow(s) from ${file.name}. Go to the list view to see them.`
        );
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to parse YAML file"
        );
      } finally {
        setIsLoading(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    []
  );

  const handleUrlImport = useCallback(async () => {
    if (!url.trim()) return;

    resetState();
    setIsLoading(true);

    try {
      const proxyUrl = `/api/task-configs/seed`;
      const fetchRes = await fetch(url.trim());
      if (!fetchRes.ok) {
        throw new Error(`Failed to fetch URL: ${fetchRes.status}`);
      }
      const yamlText = await fetchRes.text();
      const result = await parseYamlContent(yamlText);
      setSuccess(
        `Imported ${result.data?.count ?? 0} workflow(s) from URL. Go to the list view to see them.`
      );
      setUrl("");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to import from URL"
      );
    } finally {
      setIsLoading(false);
    }
  }, [url]);

  if (!open) return null;

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "saved", label: "Saved Configs", icon: <FileText className="h-3.5 w-3.5" /> },
    { id: "file", label: "Upload YAML", icon: <Upload className="h-3.5 w-3.5" /> },
    { id: "url", label: "From URL", icon: <Link2 className="h-3.5 w-3.5" /> },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-background/80 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="relative w-full max-w-xl mx-4 rounded-xl border border-border bg-card shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <h2 className="text-sm font-bold text-foreground">
            Import / Load Workflow
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex border-b border-border">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => {
                setTab(t.id);
                resetState();
              }}
              className={cn(
                "flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-semibold transition-colors",
                tab === t.id
                  ? "text-primary border-b-2 border-primary"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>

        <div className="p-5 max-h-[60vh] overflow-y-auto">
          {error && (
            <div className="flex items-start gap-2 mb-4 p-3 rounded-lg border border-red-500/30 bg-red-500/5 text-xs text-red-400">
              <AlertCircle className="h-4 w-4 shrink-0 mt-px" />
              {error}
            </div>
          )}

          {success && (
            <div className="flex items-start gap-2 mb-4 p-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 text-xs text-emerald-400">
              <CheckCircle2 className="h-4 w-4 shrink-0 mt-px" />
              {success}
            </div>
          )}

          {tab === "saved" && (
            <SavedConfigsList
              configs={savedConfigs}
              onLoad={(config) => {
                onLoadConfig(config);
                onClose();
              }}
            />
          )}

          {tab === "file" && (
            <div className="space-y-4">
              <p className="text-xs text-muted-foreground">
                Upload a <code className="text-foreground">task_config.yaml</code> file
                to import workflows into MongoDB.
              </p>
              <div
                className={cn(
                  "border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer",
                  "hover:border-primary/50 hover:bg-primary/5",
                  "border-border"
                )}
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
                <p className="text-sm font-medium text-foreground mb-1">
                  Click to upload YAML file
                </p>
                <p className="text-xs text-muted-foreground">
                  .yaml or .yml files supported
                </p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".yaml,.yml"
                onChange={handleFileUpload}
                className="hidden"
              />
              {isLoading && (
                <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Importing...
                </div>
              )}
            </div>
          )}

          {tab === "url" && (
            <div className="space-y-4">
              <p className="text-xs text-muted-foreground">
                Paste a raw URL to a <code className="text-foreground">task_config.yaml</code> file
                (e.g. a GitHub raw URL).
              </p>
              <div className="flex gap-2">
                <Input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://raw.githubusercontent.com/..."
                  className="text-sm flex-1"
                />
                <Button
                  size="sm"
                  onClick={handleUrlImport}
                  disabled={isLoading || !url.trim()}
                  className="gap-1.5 shrink-0"
                >
                  {isLoading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Link2 className="h-3.5 w-3.5" />
                  )}
                  Import
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SavedConfigsList({
  configs,
  onLoad,
}: {
  configs: TaskConfig[];
  onLoad: (config: TaskConfig) => void;
}) {
  const [search, setSearch] = useState("");

  const filtered = configs.filter(
    (c) =>
      !search.trim() ||
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.category.toLowerCase().includes(search.toLowerCase())
  );

  if (configs.length === 0) {
    return (
      <div className="text-center py-8">
        <FileText className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
        <p className="text-xs text-muted-foreground">
          No saved task configs yet.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search saved configs..."
        className="text-sm h-8"
      />

      <div className="space-y-1 max-h-[40vh] overflow-y-auto">
        {filtered.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-4">
            No configs match your search.
          </p>
        )}
        {filtered.map((config) => (
          <button
            key={config.id}
            onClick={() => onLoad(config)}
            className={cn(
              "w-full text-left rounded-lg border border-border p-3 transition-all",
              "hover:border-primary/40 hover:bg-primary/5"
            )}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold text-foreground truncate">
                {config.name}
              </span>
              <span className="text-[9px] text-muted-foreground font-mono shrink-0 ml-2">
                {config.tasks.length} step{config.tasks.length !== 1 ? "s" : ""}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded">
                {config.category}
              </span>
              {config.is_system && (
                <span className="text-[9px] font-semibold text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                  System
                </span>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
