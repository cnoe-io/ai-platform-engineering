"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { ExternalGroup, IdentityGroupSyncDryRunResult } from "@/types/identity-group-sync";

import { DryRunPreview } from "./DryRunPreview";
import { MappingClusterEditor } from "./MappingClusterEditor";
import { OktaSyncPanel } from "./OktaSyncPanel";

interface IdentityGroupSyncTabProps {
  isAdmin: boolean;
  oktaSyncEnabled?: boolean;
}

interface ClaimSuggestion {
  source_group_id: string;
  display_name: string;
  suggested_team_slug: string;
  suggested_team_name: string;
  suggested_relationship: "member" | "admin";
  suggested_org_admin: boolean;
}

export function IdentityGroupSyncTab({ isAdmin, oktaSyncEnabled = false }: IdentityGroupSyncTabProps) {
  const [providerCount, setProviderCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [suggestionNotice, setSuggestionNotice] = useState<string | null>(null);
  const [groupName, setGroupName] = useState("Engineering Platform Users");
  const [userEmail, setUserEmail] = useState("bob@example.test");
  const [dryRun, setDryRun] = useState<IdentityGroupSyncDryRunResult | null>(null);
  const [detectedGroups, setDetectedGroups] = useState<ExternalGroup[]>([]);
  const [suggestions, setSuggestions] = useState<ClaimSuggestion[]>([]);
  const [suggestionFilter, setSuggestionFilter] = useState("");
  const [selectedSuggestionIds, setSelectedSuggestionIds] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [applying, setApplying] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [activeSubTab, setActiveSubTab] = useState<"mapping" | "okta-sync">("mapping");

  const loadProviders = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSuggestionNotice(null);
    try {
      const res = await fetch("/api/admin/identity-group-sync/providers");
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Failed to load providers");
      setProviderCount(json.data?.total ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load identity providers");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProviders();
  }, [loadProviders]);

  const runDryRun = async () => {
    setRunning(true);
    setError(null);
    setSuggestionNotice(null);
    try {
      const externalGroup: ExternalGroup & {
        members: Array<{ subject?: string; email: string; display_name: string; active: boolean }>;
      } = {
        provider_id: "oidc-claims",
        external_group_id: groupName.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        display_name: groupName,
        normalized_name: groupName.toLowerCase(),
        status: "active",
        members: [
          {
            subject: userEmail ? userEmail.replace(/[^a-z0-9]+/gi, "-").toLowerCase() : undefined,
            email: userEmail,
            display_name: userEmail,
            active: true,
          },
        ],
      };
      const res = await fetch("/api/admin/identity-group-sync/dry-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider_id: "oidc-claims",
          groups: [externalGroup],
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Dry-run failed");
      setDetectedGroups([externalGroup]);
      setDryRun(json.data?.dry_run ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Dry-run failed");
    } finally {
      setRunning(false);
    }
  };

  const loadClaimSuggestions = async () => {
    setSuggesting(true);
    setError(null);
    setSuggestionNotice(null);
    try {
      const res = await fetch("/api/admin/identity-group-sync/claim-suggestions");
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Suggestion lookup failed");
      setDetectedGroups((json.data?.groups as ExternalGroup[] | undefined) ?? []);
      setSuggestions((json.data?.suggestions as ClaimSuggestion[] | undefined) ?? []);
      setSelectedSuggestionIds(new Set());
      setDryRun((json.data?.dry_run as IdentityGroupSyncDryRunResult | null | undefined) ?? null);
      if (json.data?.reason === "missing_session_group_claims") {
        setDetectedGroups([]);
        setSuggestionNotice("Sign out and sign back in to refresh cached OIDC claim groups before using suggestions.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Suggestion lookup failed");
    } finally {
      setSuggesting(false);
    }
  };

  const applyDryRun = async (options?: { acknowledgeRemovalRisks?: boolean }) => {
    if (!dryRun) return;
    setApplying(true);
    setError(null);
    setSuggestionNotice(null);
    try {
      const res = await fetch("/api/admin/identity-group-sync/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reviewed: true,
          acknowledge_removal_risks: options?.acknowledgeRemovalRisks === true,
          dry_run: dryRun,
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Apply failed");
      await loadProviders();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Apply failed");
    } finally {
      setApplying(false);
    }
  };

  const buildSelectedTeamDryRun = (selected: ClaimSuggestion[]): IdentityGroupSyncDryRunResult => ({
    matched_groups: [],
    ignored_groups: [],
    teams_to_create: selected.map((suggestion) => ({
      slug: suggestion.suggested_team_slug,
      name: suggestion.suggested_team_name,
      source_group_id: suggestion.source_group_id,
    })),
    membership_sources_to_add: [],
    membership_sources_to_remove: [],
    tuple_writes: [],
    tuple_deletes: [],
    skipped_users: [],
    conflicts: [],
    safety_warnings: [],
  });

  const addSelectedSuggestionsAsTeams = async () => {
    const selected = suggestions.filter((suggestion) => selectedSuggestionIds.has(suggestion.source_group_id));
    if (selected.length === 0) return;
    setApplying(true);
    setError(null);
    setSuggestionNotice(null);
    try {
      const selectedDryRun = buildSelectedTeamDryRun(selected);
      const res = await fetch("/api/admin/identity-group-sync/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reviewed: true,
          acknowledge_removal_risks: false,
          dry_run: selectedDryRun,
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Apply failed");
      setDryRun(selectedDryRun);
      setSuggestions((current) =>
        current.filter((suggestion) => !selectedSuggestionIds.has(suggestion.source_group_id))
      );
      setSelectedSuggestionIds(new Set());
      await loadProviders();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Apply failed");
    } finally {
      setApplying(false);
    }
  };

  const providerSummary = loading
    ? "Loading providers..."
    : `${providerCount} provider${providerCount === 1 ? "" : "s"} configured`;
  const normalizedSuggestionFilter = suggestionFilter.trim().toLowerCase();
  const filteredSuggestions = normalizedSuggestionFilter
    ? suggestions.filter((suggestion) =>
        [
          suggestion.source_group_id,
          suggestion.display_name,
          suggestion.suggested_team_slug,
          suggestion.suggested_team_name,
          suggestion.suggested_relationship,
        ]
          .join(" ")
          .toLowerCase()
          .includes(normalizedSuggestionFilter)
      )
    : suggestions;
  const selectedSuggestions = suggestions.filter((suggestion) =>
    selectedSuggestionIds.has(suggestion.source_group_id)
  );
  const toggleSuggestion = (sourceGroupId: string) => {
    setSelectedSuggestionIds((current) => {
      const next = new Set(current);
      if (next.has(sourceGroupId)) {
        next.delete(sourceGroupId);
      } else {
        next.add(sourceGroupId);
      }
      return next;
    });
  };

  return (
    <div className="space-y-4">
      {oktaSyncEnabled && (
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setActiveSubTab("mapping")}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              activeSubTab === "mapping"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            Group Mapping
          </button>
          <button
            type="button"
            onClick={() => setActiveSubTab("okta-sync")}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              activeSubTab === "okta-sync"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            Okta Background Sync
          </button>
        </div>
      )}

      {(!oktaSyncEnabled || activeSubTab === "mapping") && (
        <>
          <Card className="overflow-hidden">
            <CardHeader>
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div className="space-y-2">
                  <CardTitle>Identity Group Sync</CardTitle>
                  <CardDescription>
                    Review IdP group claims, preview CAIPE team changes, then apply the approved sync plan.
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={providerCount > 0 ? "status" : "outline"}>{providerSummary}</Badge>
                  <Button variant="outline" size="sm" onClick={loadProviders} disabled={loading}>
                    {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                    Refresh
                  </Button>
                </div>
              </div>
            </CardHeader>
          </Card>

          {error && <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">{error}</div>}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                Review detected groups
              </CardTitle>
              <CardDescription>
                Use cached group claims from the current admin session, match known rules, and stage team suggestions for review.
                Nothing is applied automatically.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={loadClaimSuggestions} disabled={!isAdmin || suggesting}>
                  {suggesting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Suggest from my groups
                </Button>
                <span className="text-sm text-muted-foreground">
                  Uses server-side cached claim groups; the full group list is not stored in the session cookie.
                </span>
              </div>
              {suggestionNotice && (
                <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
                  {suggestionNotice}
                </div>
              )}
              {suggestions.length > 0 && (
                <div className="space-y-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <Input
                      type="search"
                      aria-label="Filter detected groups"
                      placeholder="Filter detected groups or suggested teams..."
                      value={suggestionFilter}
                      onChange={(event) => setSuggestionFilter(event.target.value)}
                      className="sm:max-w-md"
                    />
                    <span className="text-xs text-muted-foreground">
                      Showing {filteredSuggestions.length} of {suggestions.length}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-background/50 p-3">
                    <span className="text-sm text-muted-foreground">
                      {selectedSuggestions.length === 0
                        ? "Select one or more detected groups to create CAIPE teams."
                        : `${selectedSuggestions.length} selected for team creation.`}
                    </span>
                    <Button
                      size="sm"
                      onClick={addSelectedSuggestionsAsTeams}
                      disabled={applying || selectedSuggestions.length === 0}
                    >
                      {applying && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Add {selectedSuggestions.length} selected as CAIPE{" "}
                      {selectedSuggestions.length === 1 ? "team" : "teams"}
                    </Button>
                  </div>
                  <div
                    role="region"
                    aria-label="Claim group suggestions"
                    className="grid max-h-[28rem] gap-3 overflow-y-auto rounded-lg border bg-muted/20 p-3 md:grid-cols-2"
                  >
                    {filteredSuggestions.length > 0 ? (
                      filteredSuggestions.map((suggestion) => (
                        <button
                          key={suggestion.source_group_id}
                          type="button"
                          aria-pressed={selectedSuggestionIds.has(suggestion.source_group_id)}
                          className={`group flex w-full flex-col gap-2 rounded-md border p-4 text-left transition-colors hover:border-primary/40 hover:bg-muted/50 ${
                            selectedSuggestionIds.has(suggestion.source_group_id)
                              ? "border-primary/70 bg-primary/10"
                              : "bg-background"
                          }`}
                          onClick={() => toggleSuggestion(suggestion.source_group_id)}
                        >
                          <span className="flex items-start justify-between gap-3">
                            <span>
                              <span className="block font-medium">{suggestion.suggested_team_name}</span>
                              <span className="block text-xs text-muted-foreground">
                                {selectedSuggestionIds.has(suggestion.source_group_id)
                                  ? "Selected claim group"
                                  : "Detected claim group"}
                              </span>
                            </span>
                            <Badge variant={suggestion.suggested_relationship === "admin" ? "tool" : "secondary"}>
                              {suggestion.suggested_relationship}
                            </Badge>
                          </span>
                          <span className="text-xs text-muted-foreground">
                            Suggest team:{suggestion.suggested_team_slug}
                            {suggestion.suggested_org_admin ? " - org admin grant review required" : ""}
                          </span>
                        </button>
                      ))
                    ) : (
                      <div className="rounded-md border border-dashed bg-background/60 p-4 text-sm text-muted-foreground md:col-span-2">
                        No detected groups match this filter.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="rounded-lg border bg-card p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="font-medium">Need to test one group manually?</div>
                <div className="text-sm text-muted-foreground">
                  Keep this as an explicit preview path for hand-entered IdP groups.
                </div>
              </div>
              <Button variant="outline" onClick={() => setManualOpen((open) => !open)}>
                Manual dry-run
              </Button>
            </div>
          </div>

          {manualOpen && (
            <MappingClusterEditor
              groupName={groupName}
              setGroupName={setGroupName}
              userEmail={userEmail}
              setUserEmail={setUserEmail}
              onDryRun={runDryRun}
              disabled={!isAdmin || running}
            />
          )}

          <DryRunPreview result={dryRun} detectedGroups={detectedGroups} applying={applying} onApply={applyDryRun} />
        </>
      )}

      {oktaSyncEnabled && activeSubTab === "okta-sync" && (
        <OktaSyncPanel isAdmin={isAdmin} />
      )}
    </div>
  );
}
