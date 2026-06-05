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
          <CardTitle>Preview changes</CardTitle>
          <CardDescription>
            Detect your groups or run a manual test to preview which teams, members, and access grants
            would change.
          </CardDescription>
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

  const teamChanges = groupChangesByTeam(result);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {hasConflicts ? <AlertCircle className="h-5 w-5 text-amber-500" /> : <CheckCircle2 className="h-5 w-5 text-green-500" />}
          Preview changes
        </CardTitle>
        <CardDescription>
          {result.matched_groups.length} matched group(s), {result.skipped_users.length} skipped user(s),{" "}
          {result.conflicts.length} conflict(s). Each card below shows one identity group and the CAIPE
          team it would change.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-3">
          {teamChanges.map((team) => (
            <div key={team.slug} className="rounded-md border bg-background/60 p-4">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                {team.sourceGroupId && (
                  <>
                    <span className="font-medium" title={team.sourceGroupId}>
                      {team.sourceGroupId}
                    </span>
                    <span aria-hidden className="text-muted-foreground">
                      &rarr;
                    </span>
                  </>
                )}
                <span className="font-medium">{team.name}</span>
                <span className="text-xs text-muted-foreground">({team.slug})</span>
                {team.created && (
                  <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                    new team
                  </span>
                )}
              </div>
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                <ChangePill label="members added" value={team.membersAdded} tone="add" />
                <ChangePill label="members removed" value={team.membersRemoved} tone="remove" />
                <ChangePill label="access grants" value={team.tupleWrites} tone="add" />
                <ChangePill label="access revokes" value={team.tupleDeletes} tone="remove" />
              </div>
            </div>
          ))}
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

function ChangePill({ label, value, tone }: { label: string; value: number; tone: "add" | "remove" }) {
  if (value === 0) return null;
  const sign = tone === "add" ? "+" : "−";
  const toneClass = tone === "add" ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800";
  return (
    <span className={`rounded-full px-2 py-0.5 font-medium ${toneClass}`}>
      {sign}
      {value} {label}
    </span>
  );
}

interface TeamChangeSummary {
  slug: string;
  name: string;
  sourceGroupId?: string;
  created: boolean;
  membersAdded: number;
  membersRemoved: number;
  tupleWrites: number;
  tupleDeletes: number;
}

// Collapse the flat dry-run lists into one row per CAIPE team so each change
// reads as "identity group -> team: +N members, +N grants".
function groupChangesByTeam(result: IdentityGroupSyncDryRunResult): TeamChangeSummary[] {
  const order: string[] = [];
  const byTeam = new Map<string, TeamChangeSummary>();
  const ensure = (slug: string, name?: string): TeamChangeSummary => {
    let summary = byTeam.get(slug);
    if (!summary) {
      summary = {
        slug,
        name: name || slug,
        created: false,
        membersAdded: 0,
        membersRemoved: 0,
        tupleWrites: 0,
        tupleDeletes: 0,
      };
      byTeam.set(slug, summary);
      order.push(slug);
    } else if (name && summary.name === summary.slug) {
      summary.name = name;
    }
    return summary;
  };

  for (const team of result.teams_to_create) {
    const summary = ensure(team.slug, team.name);
    summary.created = true;
    summary.sourceGroupId = team.source_group_id;
  }
  for (const source of result.membership_sources_to_add) {
    const summary = ensure(source.team_slug);
    summary.membersAdded += 1;
    if (!summary.sourceGroupId && source.external_group_id) summary.sourceGroupId = source.external_group_id;
  }
  for (const source of result.membership_sources_to_remove) {
    const summary = ensure(source.team_slug);
    summary.membersRemoved += 1;
    if (!summary.sourceGroupId && source.external_group_id) summary.sourceGroupId = source.external_group_id;
  }
  for (const tuple of result.tuple_writes) {
    ensure(teamSlugFromObject(tuple.object)).tupleWrites += 1;
  }
  for (const tuple of result.tuple_deletes) {
    ensure(teamSlugFromObject(tuple.object)).tupleDeletes += 1;
  }

  return order.map((slug) => byTeam.get(slug)!);
}

// Tuple objects look like "team:platform"; fall back to the raw value otherwise.
function teamSlugFromObject(object: string): string {
  const [type, id] = object.split(":");
  return type === "team" && id ? id : object;
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
