"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Plus,
  Trash2,
  Loader2,
  Shield,
  Link,
  Users,
  AlertCircle,
  Check,
  X,
} from "lucide-react";
import { CreateRoleDialog } from "./CreateRoleDialog";
import { GroupRoleMappingDialog } from "./GroupRoleMappingDialog";

const BUILT_IN_ROLES = new Set([
  "admin",
  "chat_user",
  "team_member",
  "kb_admin",
  "offline_access",
  "uma_authorization",
  "default-roles-caipe",
]);

interface KeycloakRole {
  id: string;
  name: string;
  description?: string;
  composite: boolean;
  clientRole: boolean;
}

interface IdpMapper {
  id?: string;
  name?: string;
  identityProviderAlias?: string;
  identityProviderMapper?: string;
  idpAlias?: string;
  config?: Record<string, string>;
}

interface IdpAlias {
  alias: string;
  displayName?: string;
  providerId: string;
}

interface TeamWithRoles {
  _id: string;
  name: string;
  description?: string;
  keycloak_roles?: string[];
  members?: Array<{ user_id: string; role: string }>;
}

interface RolesAccessTabProps {
  isAdmin: boolean;
}

export function RolesAccessTab({ isAdmin }: RolesAccessTabProps) {
  const [roles, setRoles] = useState<KeycloakRole[]>([]);
  const [mappers, setMappers] = useState<IdpMapper[]>([]);
  const [idpAliases, setIdpAliases] = useState<IdpAlias[]>([]);
  const [teams, setTeams] = useState<TeamWithRoles[]>([]);

  const [rolesLoading, setRolesLoading] = useState(true);
  const [mappersLoading, setMappersLoading] = useState(true);
  const [teamsLoading, setTeamsLoading] = useState(true);

  const [rolesError, setRolesError] = useState<string | null>(null);
  const [mappersError, setMappersError] = useState<string | null>(null);
  const [teamsError, setTeamsError] = useState<string | null>(null);

  const [deletingRole, setDeletingRole] = useState<string | null>(null);
  const [deletingMapper, setDeletingMapper] = useState<string | null>(null);

  const [createRoleOpen, setCreateRoleOpen] = useState(false);
  const [createMappingOpen, setCreateMappingOpen] = useState(false);

  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);
  const [editingRoles, setEditingRoles] = useState<string[]>([]);
  const [savingTeamRoles, setSavingTeamRoles] = useState(false);

  const fetchRoles = useCallback(async () => {
    setRolesLoading(true);
    setRolesError(null);
    try {
      const res = await fetch("/api/admin/roles");
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Failed to fetch roles");
      setRoles(json.data?.roles || []);
    } catch (err: unknown) {
      setRolesError(err instanceof Error ? err.message : "Failed to fetch roles");
    } finally {
      setRolesLoading(false);
    }
  }, []);

  const fetchTeams = useCallback(async () => {
    setTeamsLoading(true);
    setTeamsError(null);
    try {
      const res = await fetch("/api/admin/teams");
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Failed to fetch teams");
      setTeams(json.data?.teams || []);
    } catch (err: unknown) {
      setTeamsError(err instanceof Error ? err.message : "Failed to fetch teams");
    } finally {
      setTeamsLoading(false);
    }
  }, []);

  const fetchMappersAndAliases = useCallback(async () => {
    setMappersLoading(true);
    setMappersError(null);
    try {
      const res = await fetch("/api/admin/role-mappings");
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Failed to fetch mappings");
      const payload = json.data || {};
      const mappersData: IdpMapper[] = payload.mappers || [];
      setMappers(mappersData);

      const serverAliases: IdpAlias[] = (payload.idpAliases || []).map(
        (a: { alias: string; displayName?: string; providerId?: string }) => ({
          alias: a.alias,
          displayName: a.displayName,
          providerId: a.providerId || "oidc",
        })
      );
      if (serverAliases.length > 0) {
        setIdpAliases(serverAliases);
      } else {
        const aliasSet = new Set<string>();
        const aliases: IdpAlias[] = [];
        for (const m of mappersData) {
          const alias = m.idpAlias;
          if (alias && !aliasSet.has(alias)) {
            aliasSet.add(alias);
            aliases.push({
              alias,
              providerId: m.identityProviderMapper || "oidc",
            });
          }
        }
        if (aliases.length > 0) {
          setIdpAliases(aliases);
        }
      }
    } catch (err: unknown) {
      setMappersError(err instanceof Error ? err.message : "Failed to fetch mappings");
    } finally {
      setMappersLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRoles();
    fetchMappersAndAliases();
    fetchTeams();
  }, [fetchRoles, fetchMappersAndAliases, fetchTeams]);

  const handleDeleteRole = async (roleName: string) => {
    if (!confirm(`Delete role "${roleName}"? This cannot be undone.`)) return;
    setDeletingRole(roleName);
    try {
      const res = await fetch(`/api/admin/roles/${encodeURIComponent(roleName)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Failed to delete role");
      await fetchRoles();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to delete role");
    } finally {
      setDeletingRole(null);
    }
  };

  const handleDeleteMapper = async (mapperId: string, alias: string) => {
    if (!confirm("Delete this group-to-role mapping?")) return;
    setDeletingMapper(mapperId);
    try {
      const res = await fetch(
        `/api/admin/role-mappings/${encodeURIComponent(mapperId)}?alias=${encodeURIComponent(alias)}`,
        { method: "DELETE" }
      );
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Failed to delete mapping");
      await fetchMappersAndAliases();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to delete mapping");
    } finally {
      setDeletingMapper(null);
    }
  };

  const startEditTeamRoles = (team: TeamWithRoles) => {
    setEditingTeamId(team._id);
    setEditingRoles(team.keycloak_roles || []);
  };

  const toggleTeamRole = (roleName: string) => {
    setEditingRoles((prev) =>
      prev.includes(roleName)
        ? prev.filter((r) => r !== roleName)
        : [...prev, roleName]
    );
  };

  const saveTeamRoles = async () => {
    if (!editingTeamId) return;
    setSavingTeamRoles(true);
    try {
      const res = await fetch(`/api/admin/teams/${editingTeamId}/roles`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roles: editingRoles }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Failed to save team roles");
      setEditingTeamId(null);
      await fetchTeams();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to save team roles");
    } finally {
      setSavingTeamRoles(false);
    }
  };

  const cancelEditTeamRoles = () => {
    setEditingTeamId(null);
    setEditingRoles([]);
  };

  function extractMappingInfo(mapper: IdpMapper): {
    group: string;
    role: string;
  } | null {
    const config = mapper.config;
    if (!config) return null;
    const role = config.role || "";
    let group = "";
    try {
      const claims = JSON.parse(config.claims || "[]");
      if (Array.isArray(claims) && claims.length > 0) {
        group = claims[0]?.value || "";
      }
    } catch {
      group = config.claims || "";
    }
    return { group, role };
  }

  const roleMappers = mappers.filter(
    (m) => m.identityProviderMapper === "oidc-advanced-role-idp-mapper"
  );

  return (
    <div className="space-y-6">
      {/* Section A: Realm Roles */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Realm Roles
            </CardTitle>
            <CardDescription>
              Keycloak realm roles that can be assigned to users via IdP group
              mappings
            </CardDescription>
          </div>
          {isAdmin && (
            <Button
              size="sm"
              onClick={() => setCreateRoleOpen(true)}
              className="gap-1"
            >
              <Plus className="h-4 w-4" />
              Create Role
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {rolesLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : rolesError ? (
            <div className="flex items-center gap-2 text-destructive py-4">
              <AlertCircle className="h-4 w-4" />
              <span className="text-sm">{rolesError}</span>
            </div>
          ) : (
            <div className="space-y-1">
              <div className="grid grid-cols-12 gap-4 pb-2 border-b text-xs font-medium text-muted-foreground">
                <div className="col-span-3">Name</div>
                <div className="col-span-5">Description</div>
                <div className="col-span-2">Type</div>
                {isAdmin && (
                  <div className="col-span-2 text-right">Actions</div>
                )}
              </div>
              {roles
                .filter((r) => !r.clientRole)
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((role) => {
                  const isBuiltIn = BUILT_IN_ROLES.has(role.name);
                  return (
                    <div
                      key={role.id}
                      className="grid grid-cols-12 gap-4 py-2 text-sm hover:bg-muted/50 rounded px-2 items-center"
                    >
                      <div className="col-span-3 font-mono text-xs">
                        {role.name}
                      </div>
                      <div className="col-span-5 text-muted-foreground truncate">
                        {role.description || "—"}
                      </div>
                      <div className="col-span-2">
                        {isBuiltIn ? (
                          <Badge variant="secondary" className="text-xs">
                            Built-in
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="text-xs border-blue-500/50 text-blue-600 dark:text-blue-400"
                          >
                            Custom
                          </Badge>
                        )}
                      </div>
                      {isAdmin && (
                        <div className="col-span-2 text-right">
                          {!isBuiltIn && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs text-destructive hover:text-destructive"
                              onClick={() => handleDeleteRole(role.name)}
                              disabled={deletingRole === role.name}
                            >
                              {deletingRole === role.name ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Trash2 className="h-3 w-3" />
                              )}
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Section B: Group-to-Role Mappings */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Link className="h-5 w-5" />
              Group-to-Role Mappings
            </CardTitle>
            <CardDescription>
              IdP group membership is automatically mapped to Keycloak realm
              roles on login
            </CardDescription>
          </div>
          {isAdmin && (
            <Button
              size="sm"
              onClick={() => setCreateMappingOpen(true)}
              className="gap-1"
            >
              <Plus className="h-4 w-4" />
              Add Mapping
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {mappersLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : mappersError ? (
            <div className="flex items-center gap-2 text-destructive py-4">
              <AlertCircle className="h-4 w-4" />
              <span className="text-sm">{mappersError}</span>
            </div>
          ) : roleMappers.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">
              No group-to-role mappings configured. Click &quot;Add
              Mapping&quot; to create one.
            </p>
          ) : (
            <div className="space-y-1">
              <div className="grid grid-cols-12 gap-4 pb-2 border-b text-xs font-medium text-muted-foreground">
                <div className="col-span-3">IdP</div>
                <div className="col-span-3">Group</div>
                <div className="col-span-3">Role</div>
                <div className="col-span-1">Sync</div>
                {isAdmin && (
                  <div className="col-span-2 text-right">Actions</div>
                )}
              </div>
              {roleMappers.map((mapper) => {
                const info = extractMappingInfo(mapper);
                const alias = mapper.idpAlias || mapper.identityProviderAlias || "";
                return (
                  <div
                    key={mapper.id || mapper.name}
                    className="grid grid-cols-12 gap-4 py-2 text-sm hover:bg-muted/50 rounded px-2 items-center"
                  >
                    <div className="col-span-3 font-mono text-xs truncate">
                      {alias}
                    </div>
                    <div className="col-span-3 font-mono text-xs">
                      {info?.group || "—"}
                    </div>
                    <div className="col-span-3">
                      <Badge variant="outline" className="text-xs">
                        {info?.role || "—"}
                      </Badge>
                    </div>
                    <div className="col-span-1 text-xs text-muted-foreground">
                      {mapper.config?.syncMode || "—"}
                    </div>
                    {isAdmin && (
                      <div className="col-span-2 text-right">
                        {mapper.id && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs text-destructive hover:text-destructive"
                            onClick={() =>
                              handleDeleteMapper(mapper.id!, alias)
                            }
                            disabled={deletingMapper === mapper.id}
                          >
                            {deletingMapper === mapper.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Trash2 className="h-3 w-3" />
                            )}
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Section C: Team Role Assignments */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Team Role Assignments
          </CardTitle>
          <CardDescription>
            Assign Keycloak roles to teams for team-scoped authorization
          </CardDescription>
        </CardHeader>
        <CardContent>
          {teamsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : teamsError ? (
            <div className="flex items-center gap-2 text-destructive py-4">
              <AlertCircle className="h-4 w-4" />
              <span className="text-sm">{teamsError}</span>
            </div>
          ) : teams.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">
              No teams found. Create a team from the Teams tab first.
            </p>
          ) : (
            <div className="space-y-1">
              <div className="grid grid-cols-12 gap-4 pb-2 border-b text-xs font-medium text-muted-foreground">
                <div className="col-span-3">Team</div>
                <div className="col-span-2">Members</div>
                <div className="col-span-5">Assigned Roles</div>
                {isAdmin && (
                  <div className="col-span-2 text-right">Actions</div>
                )}
              </div>
              {teams.map((team) => {
                const isEditing = editingTeamId === team._id;
                const currentRoles = team.keycloak_roles || [];
                const availableRoles = roles
                  .filter((r) => !r.clientRole)
                  .sort((a, b) => a.name.localeCompare(b.name));
                return (
                  <div
                    key={team._id}
                    className={`grid grid-cols-12 gap-4 py-2 text-sm rounded px-2 items-start ${
                      isEditing
                        ? "bg-muted/70 border border-border"
                        : "hover:bg-muted/50"
                    }`}
                  >
                    <div className="col-span-3">
                      <div className="font-medium">{team.name}</div>
                      {team.description && (
                        <div className="text-xs text-muted-foreground truncate">
                          {team.description}
                        </div>
                      )}
                    </div>
                    <div className="col-span-2 text-xs text-muted-foreground">
                      {team.members?.length || 0} members
                    </div>
                    <div className="col-span-5">
                      {isEditing ? (
                        <div className="flex flex-wrap gap-1">
                          {availableRoles.map((role) => {
                            const selected = editingRoles.includes(role.name);
                            return (
                              <button
                                key={role.name}
                                type="button"
                                onClick={() => toggleTeamRole(role.name)}
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs border transition-colors ${
                                  selected
                                    ? "bg-primary/10 border-primary text-primary"
                                    : "bg-muted border-transparent text-muted-foreground hover:border-border"
                                }`}
                              >
                                {selected && (
                                  <Check className="h-3 w-3" />
                                )}
                                {role.name}
                              </button>
                            );
                          })}
                        </div>
                      ) : currentRoles.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {currentRoles.map((r) => (
                            <Badge
                              key={r}
                              variant="outline"
                              className="text-xs"
                            >
                              {r}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          No roles assigned
                        </span>
                      )}
                    </div>
                    {isAdmin && (
                      <div className="col-span-2 flex justify-end gap-1">
                        {isEditing ? (
                          <>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs"
                              onClick={cancelEditTeamRoles}
                              disabled={savingTeamRoles}
                            >
                              <X className="h-3 w-3" />
                            </Button>
                            <Button
                              size="sm"
                              className="h-7 text-xs"
                              onClick={saveTeamRoles}
                              disabled={savingTeamRoles}
                            >
                              {savingTeamRoles ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Check className="h-3 w-3" />
                              )}
                            </Button>
                          </>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            onClick={() => startEditTeamRoles(team)}
                          >
                            Edit
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dialogs */}
      <CreateRoleDialog
        open={createRoleOpen}
        onOpenChange={setCreateRoleOpen}
        onSuccess={fetchRoles}
      />
      <GroupRoleMappingDialog
        open={createMappingOpen}
        onOpenChange={setCreateMappingOpen}
        onSuccess={fetchMappersAndAliases}
        idpAliases={idpAliases}
        roles={roles.filter((r) => !r.clientRole)}
      />
    </div>
  );
}
