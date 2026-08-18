"use client";

import React, { useCallback, useEffect, useState } from "react";

import { AutonomousTeamAccessPanel } from "@/components/admin/autonomous/AutonomousTeamAccessPanel";
import { OversightGrid } from "@/components/autonomous/oversight/OversightGrid";
import { TeamTaskPanel } from "@/components/autonomous/oversight/TeamTaskPanel";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { OversightResult } from "@/lib/autonomous/oversight-grouping";

/**
 * Central admin workspace for team entitlement and task oversight.
 */
export function AutonomousOversightTab() {
  return (
    <Tabs defaultValue="team-access" className="space-y-4">
      <TabsList>
        <TabsTrigger value="team-access">Team access</TabsTrigger>
        <TabsTrigger value="task-oversight">Task oversight</TabsTrigger>
      </TabsList>
      <TabsContent value="team-access">
        <AutonomousTeamAccessPanel />
      </TabsContent>
      <TabsContent value="task-oversight">
        <TaskOversightPanel />
      </TabsContent>
    </Tabs>
  );
}

function TaskOversightPanel() {
  const [data, setData] = useState<OversightResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // undefined = grid, null = the "No team" bucket, string = a team slug.
  const [openTeam, setOpenTeam] = useState<string | null | undefined>(undefined);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/autonomous/oversight");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { data: OversightResult };
      setData(body.data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load oversight data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const selectedGroup =
    openTeam === undefined || !data
      ? null
      : openTeam === null
        ? { name: "No team", ...data.no_team }
        : data.teams.find((t) => t.slug === openTeam) ?? null;

  if (error) {
    return (
      <div className="flex items-center gap-2 text-sm text-destructive">
        <span>{error}</span>
        <Button type="button" variant="ghost" size="sm" onClick={fetchData}>
          Retry
        </Button>
      </div>
    );
  }

  if (loading || !data) {
    return <div className="text-sm text-muted-foreground">Loading…</div>;
  }

  return selectedGroup ? (
    <TeamTaskPanel
      title={selectedGroup.name}
      members={selectedGroup.members}
      onBack={() => setOpenTeam(undefined)}
      onChanged={fetchData}
    />
  ) : (
    <OversightGrid data={data} onOpenTeam={(slug) => setOpenTeam(slug)} />
  );
}
