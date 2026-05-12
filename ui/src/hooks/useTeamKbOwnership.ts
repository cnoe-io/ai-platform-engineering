"use client";

import { useState, useEffect, useCallback } from "react";
import type { KbPermission } from "@/lib/rbac/types";

interface TeamKbInfo {
  teamId: string;
  teamName: string;
  permission: KbPermission;
}

interface TeamKbOwnershipMap {
  [datasourceId: string]: TeamKbInfo[];
}

interface TeamBasic {
  _id: string;
  name: string;
}

interface KbAssignmentResponse {
  data: {
    team_id: string;
    kb_ids: string[];
    kb_permissions: Record<string, KbPermission>;
  };
}

export function useTeamKbOwnership() {
  const [ownershipMap, setOwnershipMap] = useState<TeamKbOwnershipMap>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const teamsRes = await fetch("/api/admin/teams");
      if (!teamsRes.ok) return;
      const teamsData = (await teamsRes.json()) as {
        data?: { teams?: TeamBasic[] };
      };
      const teams: TeamBasic[] = teamsData.data?.teams ?? [];

      const map: TeamKbOwnershipMap = {};

      await Promise.all(
        teams.map(async (team) => {
          try {
            const res = await fetch(
              `/api/admin/teams/${team._id}/kb-assignments`
            );
            if (!res.ok) return;
            const data = (await res.json()) as KbAssignmentResponse;
            const assignment = data.data;
            for (const kbId of assignment.kb_ids) {
              if (!map[kbId]) map[kbId] = [];
              map[kbId].push({
                teamId: team._id,
                teamName: team.name,
                permission: assignment.kb_permissions[kbId] || "read",
              });
            }
          } catch {
            // Individual team fetch failure is non-critical
          }
        })
      );

      setOwnershipMap(map);
    } catch {
      // Non-critical
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const getTeamsForKb = useCallback(
    (datasourceId: string): TeamKbInfo[] => {
      return ownershipMap[datasourceId] ?? [];
    },
    [ownershipMap]
  );

  const hasTeamPermission = useCallback(
    (
      datasourceId: string,
      requiredPermission: KbPermission
    ): boolean => {
      const teams = ownershipMap[datasourceId] ?? [];
      const permRank: Record<KbPermission, number> = {
        read: 1,
        ingest: 2,
        admin: 3,
      };
      const required = permRank[requiredPermission];
      return teams.some(
        (t) => (permRank[t.permission] ?? 0) >= required
      );
    },
    [ownershipMap]
  );

  return { ownershipMap, loading, getTeamsForKb, hasTeamPermission, reload: load };
}
