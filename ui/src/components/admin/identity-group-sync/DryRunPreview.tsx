"use client";

import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { IdentityGroupSyncDryRunResult } from "@/types/identity-group-sync";

interface DryRunPreviewProps {
  result: IdentityGroupSyncDryRunResult | null;
  applying: boolean;
  onApply: () => void;
}

export function DryRunPreview({ result, applying, onApply }: DryRunPreviewProps) {
  if (!result) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Dry-run preview</CardTitle>
          <CardDescription>Run a preview to see team, membership, and tuple changes.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const hasConflicts = result.conflicts.length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {hasConflicts ? <AlertCircle className="h-5 w-5 text-amber-500" /> : <CheckCircle2 className="h-5 w-5 text-green-500" />}
          Dry-run preview
        </CardTitle>
        <CardDescription>
          {result.matched_groups.length} matched group(s), {result.skipped_users.length} skipped user(s),{" "}
          {result.conflicts.length} conflict(s)
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-3">
          <Metric label="Teams to create" value={result.teams_to_create.length} />
          <Metric label="Membership sources to add" value={result.membership_sources_to_add.length} />
          <Metric label="Tuple writes" value={result.tuple_writes.length} />
        </div>
        {hasConflicts && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            Resolve conflicts before applying: {result.conflicts.map((conflict) => conflict.reason).join("; ")}
          </div>
        )}
        {result.skipped_users.length > 0 && (
          <div className="rounded-md border p-3 text-sm">
            <div className="font-medium">Skipped users</div>
            <ul className="mt-2 list-disc pl-5">
              {result.skipped_users.slice(0, 5).map((user) => (
                <li key={`${user.source_group_id}:${user.user_identifier}`}>
                  {user.user_identifier}: {user.reason}
                </li>
              ))}
            </ul>
          </div>
        )}
        <Button onClick={onApply} disabled={applying || hasConflicts}>
          {applying && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Apply reviewed sync
        </Button>
      </CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-2xl font-semibold">{value}</div>
      <div className="text-sm text-muted-foreground">{label}</div>
    </div>
  );
}
