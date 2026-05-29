"use client";

import { useState } from "react";
import { AlertCircle, CheckCircle2, Info, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ExternalGroup, IdentityGroupSyncDryRunResult } from "@/types/identity-group-sync";

interface DryRunPreviewProps {
  result: IdentityGroupSyncDryRunResult | null;
  detectedGroups?: ExternalGroup[];
  applying: boolean;
  onApply: (options?: { acknowledgeRemovalRisks?: boolean }) => void;
}

export function DryRunPreview({ result, detectedGroups = [], applying, onApply }: DryRunPreviewProps) {
  const [acknowledgedRemovalRisks, setAcknowledgedRemovalRisks] = useState(false);

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
  const safetyWarnings = result.safety_warnings ?? [];
  const requiresAcknowledgement = safetyWarnings.some((warning) => warning.requires_acknowledgement);
  const changeCount =
    result.teams_to_create.length +
    result.membership_sources_to_add.length +
    result.membership_sources_to_remove.length +
    result.tuple_writes.length +
    result.tuple_deletes.length;
  const detectedGroupRows = mergeDetectedGroups(detectedGroups, result.matched_groups, result.ignored_groups);

  if (changeCount === 0 && !hasConflicts && result.skipped_users.length === 0) {
    if (detectedGroupRows.length > 0) {
      const matchedIds = new Set(result.matched_groups.map((group) => group.external_group_id));
      const ignoredIds = new Set(result.ignored_groups.map((group) => group.external_group_id));
      const alreadyRepresentedCount = detectedGroupRows.filter((group) => matchedIds.has(group.external_group_id)).length;
      const unmatchedCount = detectedGroupRows.filter((group) => ignoredIds.has(group.external_group_id)).length;

      return (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-500" />
              Detected groups are already represented
            </CardTitle>
            <CardDescription>
              {detectedGroupRows.length} group(s) were found in this preview. No team, membership, or tuple changes are
              needed right now.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-3">
              <Metric label="detected" value={detectedGroupRows.length} />
              <Metric label="already represented" value={alreadyRepresentedCount} />
              <Metric label="unmatched" value={unmatchedCount} />
            </div>
            <details className="rounded-md border bg-background/60 p-3">
              <summary className="cursor-pointer text-sm font-medium">Detected groups</summary>
              <div className="mt-3 grid gap-2">
                {detectedGroupRows.map((group) => {
                  const status = matchedIds.has(group.external_group_id)
                    ? "Already represented"
                    : ignoredIds.has(group.external_group_id)
                      ? "No enabled sync rule matched"
                      : "Detected";
                  return (
                    <div
                      key={`${group.provider_id}:${group.external_group_id}`}
                      className="flex flex-col gap-1 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div>
                        <div className="font-medium">{group.display_name || group.external_group_id}</div>
                        <div className="text-xs text-muted-foreground">{group.external_group_id}</div>
                      </div>
                      <span className="text-sm text-muted-foreground">{status}</span>
                    </div>
                  );
                })}
              </div>
            </details>
          </CardContent>
        </Card>
      );
    }

    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Info className="h-5 w-5 text-muted-foreground" />
            No sync changes to apply
          </CardTitle>
          <CardDescription>
            The detected groups did not produce team, membership, or tuple changes. Add or enable sync rules, or use
            manual dry-run to test a specific upstream group.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

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
        <div className="grid gap-3 md:grid-cols-5">
          <Metric label="Teams to create" value={result.teams_to_create.length} />
          <Metric label="Membership sources to add" value={result.membership_sources_to_add.length} />
          <Metric label="Membership sources to remove" value={result.membership_sources_to_remove.length} />
          <Metric label="Tuple writes" value={result.tuple_writes.length} />
          <Metric label="Tuple deletes" value={result.tuple_deletes.length} />
        </div>
        {safetyWarnings.length > 0 && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
            <div className="font-medium">Removal risk review required</div>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {safetyWarnings.map((warning, index) => (
                <li key={`${warning.code}:${warning.team_slug ?? "global"}:${index}`}>{warning.message}</li>
              ))}
            </ul>
            {requiresAcknowledgement && (
              <label className="mt-3 flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={acknowledgedRemovalRisks}
                  onChange={(event) => setAcknowledgedRemovalRisks(event.target.checked)}
                />
                Acknowledge removal risks
              </label>
            )}
          </div>
        )}
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
        <Button
          onClick={() => onApply({ acknowledgeRemovalRisks: acknowledgedRemovalRisks && requiresAcknowledgement })}
          disabled={applying || hasConflicts || (requiresAcknowledgement && !acknowledgedRemovalRisks)}
        >
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

function mergeDetectedGroups(...groups: ExternalGroup[][]): ExternalGroup[] {
  const seen = new Set<string>();
  const merged: ExternalGroup[] = [];
  for (const group of groups.flat()) {
    const key = `${group.provider_id}:${group.external_group_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(group);
  }
  return merged;
}
