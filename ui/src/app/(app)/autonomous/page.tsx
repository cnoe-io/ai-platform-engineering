// Copyright CNOE Contributors (https://cnoe.io)
// SPDX-License-Identifier: Apache-2.0

"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { AuthGuard } from "@/components/auth-guard";
import { useAdminRole } from "@/hooks/use-admin-role";
import { getConfig } from "@/lib/config";
import { OversightGrid } from "@/components/autonomous/oversight/OversightGrid";
import { TeamTaskPanel } from "@/components/autonomous/oversight/TeamTaskPanel";
import type { OversightResult } from "@/lib/autonomous/oversight-grouping";

export default function AutonomousPage() {
  return (
    <AuthGuard>
      <AutonomousOversight />
    </AuthGuard>
  );
}

function AutonomousOversight() {
  const router = useRouter();
  const { isAdmin, loading: roleLoading } = useAdminRole();
  const autonomousAgentsEnabled = getConfig("autonomousAgentsEnabled");

  const [data, setData] = useState<OversightResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [openTeam, setOpenTeam] = useState<string | null | undefined>(undefined); // undefined = grid

  // Redirect non-admins once the role resolves.
  useEffect(() => {
    if (!roleLoading && !isAdmin) router.replace("/dynamic-agents");
  }, [roleLoading, isAdmin, router]);

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
    if (isAdmin && autonomousAgentsEnabled) fetchData();
  }, [isAdmin, autonomousAgentsEnabled, fetchData]);

  if (roleLoading || !isAdmin) return null;
  if (!autonomousAgentsEnabled) {
    return <div className="p-6 text-sm text-muted-foreground">Autonomous agents are disabled.</div>;
  }

  const selectedGroup =
    openTeam === undefined || !data
      ? null
      : openTeam === null
        ? { name: "No team", ...data.no_team }
        : data.teams.find((t) => t.slug === openTeam) ?? null;

  return (
    <div className="space-y-4 p-6">
      <h1 className="text-lg font-semibold">Autonomous oversight</h1>
      {error ? (
        <div className="flex items-center gap-2 text-sm text-destructive">
          <span>{error}</span>
          <button type="button" className="underline" onClick={fetchData}>Retry</button>
        </div>
      ) : loading || !data ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : selectedGroup ? (
        <TeamTaskPanel
          title={selectedGroup.name}
          members={selectedGroup.members}
          onBack={() => setOpenTeam(undefined)}
          onChanged={fetchData}
        />
      ) : (
        <OversightGrid data={data} onOpenTeam={(slug) => setOpenTeam(slug)} />
      )}
    </div>
  );
}
