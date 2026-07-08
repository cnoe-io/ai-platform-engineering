// assisted-by claude code claude-sonnet-4-6
"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TeamMultiPicker, type TeamPickerOption } from "@/components/ui/team-picker";
import { Loader2, Share2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

interface WorkflowRunShareDialogProps {
  runId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Currently shared team slugs from the run document. */
  initialSharedWithTeams?: string[];
}

interface Team {
  _id: string;
  slug: string;
  name: string;
}

export function WorkflowRunShareDialog({
  runId,
  open,
  onOpenChange,
  initialSharedWithTeams = [],
}: WorkflowRunShareDialogProps) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [selected, setSelected] = useState<string[]>(initialSharedWithTeams);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync selected list when the dialog re-opens with fresh props
  useEffect(() => {
    if (open) {
      setSelected(initialSharedWithTeams);
      setError(null);
    }
  }, [open, initialSharedWithTeams]);

  // Load available teams once when the dialog opens
  useEffect(() => {
    if (!open || teams.length > 0) return;
    (async () => {
      try {
        const res = await fetch("/api/auth/my-roles");
        if (!res.ok) return;
        const data = await res.json();
        const rows: Team[] = Array.isArray(data.teams) ? data.teams : [];
        setTeams(rows);
      } catch { /* best-effort */ }
    })();
  }, [open, teams.length]);

  const options: TeamPickerOption[] = teams.map((t) => ({
    slug: t.slug,
    name: t.name,
    _id: t._id,
  }));

  const handleSave = useCallback(async () => {
    setError(null);
    setIsSaving(true);
    try {
      const res = await fetch(`/api/workflow-runs/${encodeURIComponent(runId)}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shared_with_teams: selected }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        setError(body.error ?? `Request failed with status ${res.status}`);
        return;
      }
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error");
    } finally {
      setIsSaving(false);
    }
  }, [runId, selected, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="h-4 w-4" />
            Share Workflow Run
          </DialogTitle>
          <DialogDescription>
            Team members of the selected teams will be able to view and resume this run.
          </DialogDescription>
        </DialogHeader>

        <div className="py-2">
          <TeamMultiPicker
            options={options}
            selected={selected}
            onChange={setSelected}
            placeholder="Add teams…"
            disabled={isSaving}
            allowClearAll
          />
        </div>

        {error && (
          <p className="text-xs text-red-500 mt-1">{error}</p>
        )}

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={isSaving}>
            {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
