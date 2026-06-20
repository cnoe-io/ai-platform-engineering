"use client";

// assisted-by Codex Codex-sonnet-4-6

import React from "react";

import { Button } from "@/components/ui/button";

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

export function SecretSharingPanel({
  secretId,
  sharedWithTeams,
  onSharingChange,
}: {
  secretId: string;
  sharedWithTeams: string[];
  onSharingChange?: (teamIds: string[]) => void;
}) {
  const [teamId, setTeamId] = React.useState("");
  const [sharedTeamIds, setSharedTeamIds] = React.useState(sharedWithTeams);
  const [teamOptions, setTeamOptions] = React.useState<TeamOption[]>([]);
  const [error, setError] = React.useState<string | null>(null);

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

  const shareableTeams = teamOptions.filter((team) => {
    const value = teamValue(team);
    return value && !sharedTeamIds.includes(value);
  });

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
      queueMicrotask(() => onSharingChange?.(next));
      return next;
    });
    setTeamId("");
  }

  return (
    <div className="space-y-4">
      <form
        className="space-y-6"
        onSubmit={(event) => {
          event.preventDefault();
          if (teamId.trim()) void updateShare("share", teamId.trim());
        }}
      >
        <label className="space-y-1.5 text-sm">
          <span>Team</span>
          <select
            className="w-full rounded-md border border-input bg-background px-3 py-2"
            value={teamId}
            onChange={(event) => setTeamId(event.target.value)}
          >
            <option value="">Select a team</option>
            {shareableTeams.map((team) => {
              const value = teamValue(team);
              return (
                <option key={value} value={value}>
                  {team.name || value}
                </option>
              );
            })}
          </select>
        </label>
        <Button type="submit" size="sm" className="mt-1" disabled={!teamId.trim()}>
          Share
        </Button>
      </form>
      {sharedTeamIds.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Shared teams
          </p>
          {sharedTeamIds.map((team) => (
            <div
              key={team}
              className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm"
            >
              <span>Shared with {team}</span>
              <button
                type="button"
                className="text-xs font-medium text-muted-foreground hover:text-destructive"
                onClick={() => void updateShare("revoke", team)}
              >
                Revoke
              </button>
            </div>
          ))}
        </div>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
