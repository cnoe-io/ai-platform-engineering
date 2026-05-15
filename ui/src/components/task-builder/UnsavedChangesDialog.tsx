"use client";

import React from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface UnsavedChangesDialogProps {
  open: boolean;
  onDiscard: () => void;
  onCancel: () => void;
  /** Optional dialog headline. Defaults preserve Task Builder copy. */
  title?: string;
  /** Optional body text. Defaults preserve Task Builder copy. */
  description?: string;
  /** Optional label for the destructive (discard) button. */
  discardLabel?: string;
  /** Optional label for the cancel (keep editing) button. */
  cancelLabel?: string;
}

export function UnsavedChangesDialog({
  open,
  onDiscard,
  onCancel,
  title = "Unsaved changes",
  description = "You have unsaved changes in the Task Builder. They will be lost if you leave now.",
  discardLabel = "Discard changes",
  cancelLabel = "Keep editing",
}: UnsavedChangesDialogProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div
        className="absolute inset-0 bg-background/80 backdrop-blur-sm"
        onClick={onCancel}
      />
      <div className="relative w-full max-w-sm mx-4 rounded-xl border border-border bg-card shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <div className="p-6 text-center">
          <div className="mx-auto w-12 h-12 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mb-4">
            <AlertTriangle className="h-6 w-6 text-amber-400" />
          </div>
          <h3 className="text-base font-bold text-foreground mb-1">
            {title}
          </h3>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {description}
          </p>
        </div>
        <div className="flex gap-2 px-6 pb-6">
          <Button
            variant="outline"
            className="flex-1"
            onClick={onCancel}
          >
            {cancelLabel}
          </Button>
          <Button
            variant="destructive"
            className="flex-1"
            onClick={onDiscard}
          >
            {discardLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
