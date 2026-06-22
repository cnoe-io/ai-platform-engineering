"use client";

// assisted-by Codex Codex-sonnet-4-6

import React from "react";

import { Button } from "@/components/ui/button";
import { TeamPicker,type TeamPickerOption } from "@/components/ui/team-picker";

interface TeamOption {
  _id?: string;
  id?: string;
  slug?: string;
  name?: string;
}

function apiData<T>(payload: unknown): T {
  const response = payload as { data?: T } & T;
  return response.data ?? response;
}

function teamValue(team: TeamOption): string {
  return String(team.slug || team._id || team.id || "");
}

function teamMatchesValue(team: TeamOption, value: string): boolean {
  return team.slug === value || team._id === value || team.id === value;
}

function firstSharedTeamValue(teamOptions: TeamOption[], sharedTeamIds: string[]): string {
  for (const sharedTeamId of sharedTeamIds) {
    const team = teamOptions.find((option) => teamMatchesValue(option, sharedTeamId));
    if (team) return teamValue(team) || sharedTeamId;
  }
  return sharedTeamIds[0] ?? "";
}

export function SecretSharingPanel({
  secretId,
  sharedWithTeams,
  onSharingChange,
}: {
  secretId: string;
  sharedWithTeams: string[];
  onSharingChange?: (teamIds: string[]) => void;
}) {
  const [teamId, setTeamId] = React.useState(sharedWithTeams[0] ?? "");
  const [sharedTeamIds, setSharedTeamIds] = React.useState(sharedWithTeams);
  const [teamOptions, setTeamOptions] = React.useState<TeamOption[]>([]);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setSharedTeamIds(sharedWithTeams);
    setTeamId((current) => {
      if (!current) return firstSharedTeamValue(teamOptions, sharedWithTeams);
      const selected = teamOptions.find((team) => teamMatchesValue(team, current));
      const currentStillShared = sharedWithTeams.some((sharedTeamId) =>
        selected ? teamMatchesValue(selected, sharedTeamId) : sharedTeamId === current,
      );
      return currentStillShared ? current : firstSharedTeamValue(teamOptions, sharedWithTeams);
    });
  }, [sharedWithTeams, teamOptions]);

  React.useEffect(() => {
    async function loadTeams() {
      try {
        const response = await fetch("/api/admin/teams");
        if (!response.ok) {
          throw new Error("Could not load teams");
        }
        const payload = apiData<{ teams?: TeamOption[] }>(await response.json());
        setTeamOptions(payload.teams ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load teams");
      }
    }
    void loadTeams();
  }, []);

  const teamPickerOptions = teamOptions.filter((team) => teamValue(team)).map<TeamPickerOption>((team) => {
    const value = teamValue(team);
    return {
      slug: value,
      name: team.name,
      id: team.id,
      _id: team._id,
    };
  });

  const selectedTeam = teamOptions.find((team) => teamMatchesValue(team, teamId));
  const selectedTeamHasAccess = Boolean(
    teamId &&
      sharedTeamIds.some((sharedTeamId) =>
        selectedTeam ? teamMatchesValue(selectedTeam, sharedTeamId) : sharedTeamId === teamId,
      ),
  );
  const selectedSharedTeamId = teamId && selectedTeam
    ? sharedTeamIds.find((sharedTeamId) => teamMatchesValue(selectedTeam, sharedTeamId))
    : undefined;

  async function updateShare(action: "share" | "revoke", targetTeamId: string) {
    setError(null);
    const response = await fetch(`/api/credentials/secrets/${secretId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, teamId: targetTeamId }),
    });
    if (!response.ok) {
      setError("Could not update sharing");
      return;
    }
    setSharedTeamIds((current) => {
      const next =
        action === "share"
          ? Array.from(new Set([...current, targetTeamId]))
          : current.filter((team) => team !== targetTeamId);
      queueMicrotask(() => {
        onSharingChange?.(next);
        setTeamId(action === "share" ? targetTeamId : firstSharedTeamValue(teamOptions, next));
      });
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Choose a team that can use this saved secret in configured services. The secret value stays
        protected and is never shown.
      </p>
      <form
        className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          if (teamId.trim()) {
            void updateShare(
              selectedTeamHasAccess ? "revoke" : "share",
              selectedTeamHasAccess ? selectedSharedTeamId ?? teamId.trim() : teamId.trim(),
            );
          }
        }}
      >
        <div className="space-y-1.5 text-sm">
          <label htmlFor="secret-share-team">Team access</label>
          <TeamPicker
            id="secret-share-team"
            value={teamId}
            onChange={setTeamId}
            options={teamPickerOptions}
            placeholder={teamPickerOptions.length === 0 ? "No teams available" : "Select a team"}
            searchPlaceholder="Search teams..."
            emptyLabel="No teams match"
            disabled={teamPickerOptions.length === 0}
          />
        </div>
        <Button type="submit" size="sm" disabled={!teamId.trim()}>
          {selectedTeamHasAccess ? "Revoke access" : "Grant access"}
        </Button>
      </form>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
