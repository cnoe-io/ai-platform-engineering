"use client";

/**
 * ReviewConfigsTab — admin landing for AI Review configuration.
 *
 * The set of review targets is fixed in code (see
 * `lib/server/ai-review/defaults.ts`); this tab renders one nested tab per
 * target, each a `ReviewConfigEditor` pinned to that target. Adding a new
 * surface is a code change — the admin can't coin arbitrary targets, which
 * keeps the UI focused and matches how AI Suggest's task registry works.
 */

import * as React from "react";
import { ShieldCheck, Bot, BookOpen, Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ReviewConfigEditor, type ReviewConfigEditorHandle } from "./ReviewConfigEditor";

interface TargetTab {
  /** Mongo `_id` / `target` for the pinned editor. */
  target: string;
  /** Tab label. */
  label: string;
  /** Helper text under the page header. */
  hint: string;
  icon: React.ComponentType<{ className?: string }>;
}

const TARGETS: TargetTab[] = [
  {
    target: "agent-system-prompt",
    label: "Agents",
    hint: "Used by the Agent editor's Instructions step.",
    icon: Bot,
  },
  {
    target: "skill-md",
    label: "Skills",
    hint: "Used by the Skill workspace's Files step.",
    icon: BookOpen,
  },
];

export function ReviewConfigsTab() {
  const [activeTarget, setActiveTarget] = React.useState(TARGETS[0].target);
  const [savingByTarget, setSavingByTarget] = React.useState<Record<string, boolean>>({});
  const [readyByTarget, setReadyByTarget] = React.useState<Record<string, boolean>>({});
  const editorRefs = React.useRef<Record<string, ReviewConfigEditorHandle | null>>({});
  const activeSaving = savingByTarget[activeTarget] ?? false;
  const activeReady = readyByTarget[activeTarget] ?? false;

  const setTargetSaving = React.useCallback((target: string, saving: boolean) => {
    setSavingByTarget((previous) =>
      previous[target] === saving ? previous : { ...previous, [target]: saving },
    );
  }, []);

  const setTargetReady = React.useCallback((target: string, ready: boolean) => {
    setReadyByTarget((previous) =>
      previous[target] === ready ? previous : { ...previous, [target]: ready },
    );
  }, []);

  return (
    <div className="space-y-4">
      <div
        role="region"
        aria-label="AI Review configurations header"
        className="flex flex-wrap items-start justify-between gap-3"
      >
        <div>
          <h3 className="text-base font-semibold flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" />
            AI Review configurations
          </h3>
          <p className="text-xs text-muted-foreground">
            Edit the rubric that grades content before save in each consumer
            flow. Built-in defaults are seeded automatically on first edit.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          onClick={() => void editorRefs.current[activeTarget]?.save()}
          disabled={!activeReady || activeSaving}
          className="gap-1.5"
        >
          {activeSaving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Save className="h-3.5 w-3.5" />
          )}
          Save
        </Button>
      </div>

      <Tabs value={activeTarget} onValueChange={setActiveTarget} className="w-full">
        <TabsList>
          {TARGETS.map(({ target, label, icon: Icon }) => (
            <TabsTrigger key={target} value={target} className="gap-2">
              <Icon className="h-4 w-4" />
              {label}
            </TabsTrigger>
          ))}
        </TabsList>

        {TARGETS.map(({ target, hint }) => (
          <TabsContent key={target} value={target} className="space-y-3 pt-3">
            <p className="text-xs text-muted-foreground">{hint}</p>
            <ReviewConfigEditor
              ref={(instance) => {
                editorRefs.current[target] = instance;
              }}
              target={target}
              showInlineSave={false}
              onSavingChange={(saving) => setTargetSaving(target, saving)}
              onReadyChange={(ready) => setTargetReady(target, ready)}
            />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
