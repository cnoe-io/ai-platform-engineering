"use client";

import { GitBranch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export interface RebacGraphTeamOption {
  slug: string;
  name: string;
}

export function RebacGraphFilters({
  teams,
  scope,
  allScopeValue,
  onScopeChange,
  onRender,
}: {
  teams: RebacGraphTeamOption[];
  scope: string;
  allScopeValue: string;
  onScopeChange: (scope: string) => void;
  onRender: () => void;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-[1fr_auto]">
      <div>
        <Label htmlFor="graph-scope">Graph scope</Label>
        <select
          id="graph-scope"
          className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
          value={scope}
          onChange={(event) => onScopeChange(event.target.value)}
        >
          <option value={allScopeValue}>All relationships in the system</option>
          {teams.map((team) => (
            <option key={team.slug} value={team.slug}>
              {team.name} ({team.slug})
            </option>
          ))}
        </select>
      </div>
      <Button variant="outline" className="self-end gap-2" onClick={onRender}>
        <GitBranch className="h-4 w-4" />
        Render graph
      </Button>
    </div>
  );
}
