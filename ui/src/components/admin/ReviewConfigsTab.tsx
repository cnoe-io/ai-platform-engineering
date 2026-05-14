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
import { ShieldCheck, Bot, BookOpen } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ReviewConfigEditor } from "./ReviewConfigEditor";

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
    label: "Dynamic agents",
    hint: "Used by the Dynamic Agent editor's Instructions step.",
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
  return (
    <div className="space-y-4">
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

      <Tabs defaultValue={TARGETS[0].target} className="w-full">
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
            <ReviewConfigEditor target={target} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
