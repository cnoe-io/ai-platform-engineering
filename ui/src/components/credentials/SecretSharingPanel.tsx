"use client";

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
}: {
  secretId: string;
  sharedWithTeams: string[];
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
    setSharedTeamIds((current) =>
      action === "share"
        ? Array.from(new Set([...current, targetTeamId]))
        : current.filter((team) => team !== targetTeamId),
    );
    setTeamId("");
  }

  return (
    <div className="mt-3 space-y-3 rounded-md border border-border p-3">
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (teamId.trim()) void updateShare("share", teamId.trim());
        }}
      >
        <label className="flex-1 space-y-1 text-xs">
          <span>Team</span>
          <select
            className="w-full rounded-md border border-input bg-background px-2 py-1"
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
        <Button type="submit" size="sm" className="self-end" disabled={!teamId.trim()}>
          Share
        </Button>
      </form>
      {sharedTeamIds.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {sharedTeamIds.map((team) => (
            <span key={team} className="rounded bg-muted px-2 py-1 text-xs">
              {team}
              <button
                type="button"
                className="ml-2 text-muted-foreground"
                onClick={() => void updateShare("revoke", team)}
              >
                revoke
              </button>
            </span>
          ))}
        </div>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
