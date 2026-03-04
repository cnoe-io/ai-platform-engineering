"use client";

import React, { useState } from "react";
import { Brain, Bug, Eye, ArrowDownToLine, Clock, Info, ExternalLink, Settings } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  useFeatureFlagStore,
  FEATURE_FLAGS,
  CATEGORY_LABELS,
  type FeatureFlag,
  type FeatureFlagCategory,
  type FeatureFlagIcon,
} from "@/store/feature-flag-store";

const FLAG_ICONS: Record<FeatureFlagIcon, React.ReactNode> = {
  Brain: <Brain className="h-4 w-4" />,
  Bug: <Bug className="h-4 w-4" />,
  Eye: <Eye className="h-4 w-4" />,
  ArrowDownToLine: <ArrowDownToLine className="h-4 w-4" />,
  Clock: <Clock className="h-4 w-4" />,
};

const CATEGORY_ORDER: FeatureFlagCategory[] = ["ai", "chat", "developer"];

interface PreferencesModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function FlagRow({ flag }: { flag: FeatureFlag }) {
  const { flags, toggle } = useFeatureFlagStore();
  const [showInfo, setShowInfo] = useState(false);
  const enabled = flags[flag.id] ?? flag.defaultValue;

  return (
    <div className="rounded-lg border border-border hover:border-border/80 transition-colors">
      <div className="flex items-center gap-3 px-4 py-3">
        <span className={cn(
          "shrink-0 p-1.5 rounded-lg transition-colors",
          enabled ? "text-primary bg-primary/10" : "text-muted-foreground bg-muted/50"
        )}>
          {FLAG_ICONS[flag.icon]}
        </span>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium">{flag.label}</span>
            <button
              onClick={() => setShowInfo(!showInfo)}
              className={cn(
                "p-0.5 rounded transition-colors",
                showInfo
                  ? "text-primary"
                  : "text-muted-foreground/40 hover:text-muted-foreground"
              )}
              aria-label={`Info about ${flag.label}`}
            >
              <Info className="h-3 w-3" />
            </button>
          </div>
          <span className="text-xs text-muted-foreground">{flag.description}</span>
        </div>

        <button
          onClick={() => toggle(flag.id)}
          className="shrink-0"
          role="switch"
          aria-checked={enabled}
          aria-label={`Toggle ${flag.label}`}
        >
          <div
            className={cn(
              "relative w-10 h-6 rounded-full transition-colors",
              enabled ? "bg-primary" : "bg-muted-foreground/30"
            )}
          >
            <div
              className={cn(
                "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
                enabled ? "translate-x-[18px]" : "translate-x-0.5"
              )}
            />
          </div>
        </button>
      </div>

      {showInfo && (
        <div className="px-4 pb-3">
          <div className="p-2.5 rounded-lg bg-muted/40 border border-border/50 text-xs text-muted-foreground leading-relaxed">
            {flag.detail}
            {flag.docsUrl && (
              <a
                href={flag.docsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 mt-1.5 text-primary hover:underline font-medium"
              >
                Learn more
                <ExternalLink className="h-2.5 w-2.5" />
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function PreferencesModal({ open, onOpenChange }: PreferencesModalProps) {
  const flagsByCategory = CATEGORY_ORDER
    .map((cat) => ({
      category: cat,
      label: CATEGORY_LABELS[cat],
      flags: FEATURE_FLAGS.filter((f) => f.category === cat),
    }))
    .filter((g) => g.flags.length > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] p-0">
        <DialogHeader className="p-6 pb-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl gradient-primary-br">
              <Settings className="h-5 w-5 text-white" />
            </div>
            <div>
              <DialogTitle>Your Preferences</DialogTitle>
              <DialogDescription>
                Personal settings for your account only
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="p-6 overflow-y-auto max-h-[60vh] space-y-6">
          {flagsByCategory.map(({ category, label, flags }) => (
            <div key={category}>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                {label}
              </h3>
              <div className="space-y-2">
                {flags.map((flag) => (
                  <FlagRow key={flag.id} flag={flag} />
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="p-4 border-t border-border bg-muted/20">
          <p className="text-[11px] text-center text-muted-foreground">
            These preferences apply to your account only and sync across devices.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
