"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";

import { AuthGuard } from "@/components/auth-guard";
import { AgentAutomationPanel } from "@/components/autonomous/AgentAutomationPanel";
import { MyTasksPanel, type MyTasksAgent } from "@/components/autonomous/MyTasksPanel";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getConfig } from "@/lib/config";

export default function AutonomousPage() {
  return (
    <AuthGuard>
      <AutonomousWorkspace />
    </AuthGuard>
  );
}

/**
 * User-facing autonomous workspace.
 */
function AutonomousWorkspace() {
  const { data: session } = useSession();
  const autonomousAgentsEnabled = getConfig("autonomousAgentsEnabled");

  const [agents, setAgents] = useState<MyTasksAgent[]>([]);
  // Layer 2 surface. Sourced from the same list request rather than the header's
  // summary hook, so the page issues one round-trip instead of two.
  const [canManageAutomation, setCanManageAutomation] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchAgents = useCallback(async (options: { silent?: boolean } = {}) => {
    // A silent refresh keeps `loading` untouched. Flipping it would swap the
    // whole <Tabs> block for the loading placeholder, remounting it and
    // snapping the user back to "My Tasks" mid-toggle.
    if (!options.silent) setLoading(true);
    try {
      const response = await fetch("/api/autonomous/agents");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = (await response.json()) as {
        data?: { schedulable?: MyTasksAgent[]; can_manage_automation?: boolean };
      };
      setAgents(body.data?.schedulable ?? []);
      setCanManageAutomation(Boolean(body.data?.can_manage_automation));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load agents.");
      setAgents([]);
      setCanManageAutomation(false);
    } finally {
      if (!options.silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (autonomousAgentsEnabled) void fetchAgents();
  }, [autonomousAgentsEnabled, fetchAgents]);

  if (!autonomousAgentsEnabled) {
    return <div className="p-6 text-sm text-muted-foreground">Autonomous agents are disabled.</div>;
  }

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-lg font-semibold">Autonomous</h1>
        <p className="text-sm text-muted-foreground">
          Tasks you own, grouped by the agents you can automate.
        </p>
      </div>

      {error ? (
        <div className="flex items-center gap-2 text-sm text-destructive">
          <span>{error}</span>
          <Button type="button" variant="ghost" size="sm" onClick={() => void fetchAgents()}>
            Retry
          </Button>
        </div>
      ) : loading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : (
        <Tabs defaultValue="tasks" className="space-y-4">
          <TabsList>
            <TabsTrigger value="tasks">My Tasks</TabsTrigger>
            {canManageAutomation && (
              <TabsTrigger value="automation">Configure (Admin Only)</TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="tasks">
            <MyTasksPanel agents={agents} currentUserEmail={session?.user?.email ?? null} />
          </TabsContent>

          {canManageAutomation && (
            <TabsContent value="automation">
              {/* Toggling enablement changes which agents are schedulable, so
                  refresh the My Tasks sections in place rather than making the
                  user leave the page and come back. */}
              <AgentAutomationPanel onChanged={() => void fetchAgents({ silent: true })} />
            </TabsContent>
          )}
        </Tabs>
      )}
    </div>
  );
}
