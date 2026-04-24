"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Loader2,
  UserPlus,
  Trash2,
  Crown,
  Shield,
  User,
  Pencil,
  Check,
  X,
  Hash,
  Lock,
  RefreshCw,
  Plus,
  Search,
} from "lucide-react";
import type { Team, TeamMember } from "@/types/teams";
import { TeamKbAssignmentPanel } from "@/components/admin/TeamKbAssignmentPanel";
import { MultiSelect } from "@/components/ui/multi-select";

export type DialogMode = "details" | "members" | "resources" | "kbs" | "roles" | "channels";

interface ResourceOption {
  id: string;
  name: string;
  description?: string;
}

interface ResourcesPayload {
  resources: {
    agents: string[];
    agent_admins: string[];
    tools: string[];
    tool_wildcard: boolean;
  };
  available: { agents: ResourceOption[]; tools: ResourceOption[] };
}

interface RoleCatalogEntry {
  name: string;
  description?: string;
  category: string;
}

interface RolesPayload {
  roles: string[];
  available: RoleCatalogEntry[];
}

// Spec 098 US9 — Slack channels tab.
interface TeamSlackChannel {
  slack_channel_id: string;
  channel_name: string;
  slack_workspace_id?: string;
  bound_agent_id: string | null;
}

interface SlackChannelsPayload {
  team_id: string;
  channels: TeamSlackChannel[];
  available_agents: ResourceOption[];
}

interface DiscoveredSlackChannel {
  id: string;
  name: string;
  is_private: boolean;
  is_member: boolean;
  num_members: number;
}

interface DiscoveryPayload {
  channels: DiscoveredSlackChannel[];
  total_matches: number;
  total_visible: number;
  next_cursor: string | null;
  has_more: boolean;
  cached: boolean;
  fetched_at: number;
  query: { q: string; member_only: boolean; limit: number };
}

interface TeamDetailsDialogProps {
  team: Team | null;
  mode: DialogMode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTeamUpdated: () => void;
}

function getRoleIcon(role: string) {
  switch (role) {
    case "owner":
      return <Crown className="h-3.5 w-3.5 text-yellow-500" />;
    case "admin":
      return <Shield className="h-3.5 w-3.5 text-blue-500" />;
    default:
      return <User className="h-3.5 w-3.5 text-muted-foreground" />;
  }
}

function getRoleBadgeVariant(role: string) {
  switch (role) {
    case "owner":
      return "default" as const;
    case "admin":
      return "secondary" as const;
    default:
      return "outline" as const;
  }
}

export function TeamDetailsDialog({
  team,
  mode,
  open,
  onOpenChange,
  onTeamUpdated,
}: TeamDetailsDialogProps) {
  const [activeMode, setActiveMode] = useState<DialogMode>(mode);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Edit team fields
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");

  // Add member fields
  const [newMemberEmail, setNewMemberEmail] = useState("");
  const [newMemberRole, setNewMemberRole] = useState<"member" | "admin">("member");
  const [addingMember, setAddingMember] = useState(false);

  // Removing member
  const [removingMember, setRemovingMember] = useState<string | null>(null);

  // Spec 104 — Resources tab state
  const [resourcesData, setResourcesData] = useState<ResourcesPayload | null>(null);
  const [selectedAgents, setSelectedAgents] = useState<Set<string>>(new Set());
  const [selectedAgentAdmins, setSelectedAgentAdmins] = useState<Set<string>>(new Set());
  const [selectedTools, setSelectedTools] = useState<Set<string>>(new Set());
  const [toolWildcard, setToolWildcard] = useState(false);
  const [resourcesLoading, setResourcesLoading] = useState(false);
  const [resourcesSaving, setResourcesSaving] = useState(false);
  const [resourcesNotice, setResourcesNotice] = useState<string | null>(null);

  // Spec 104 — Roles tab state (global / catch-all realm-role assignment)
  const [rolesData, setRolesData] = useState<RolesPayload | null>(null);
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [rolesLoading, setRolesLoading] = useState(false);
  const [rolesSaving, setRolesSaving] = useState(false);
  const [rolesNotice, setRolesNotice] = useState<string | null>(null);

  // Spec 098 US9 — Slack channels tab state
  const [channelsData, setChannelsData] = useState<SlackChannelsPayload | null>(null);
  const [editedChannels, setEditedChannels] = useState<TeamSlackChannel[]>([]);
  const [channelsLoading, setChannelsLoading] = useState(false);
  const [channelsSaving, setChannelsSaving] = useState(false);
  const [channelsNotice, setChannelsNotice] = useState<string | null>(null);
  const [discovery, setDiscovery] = useState<DiscoveryPayload | null>(null);
  const [discoveryLoading, setDiscoveryLoading] = useState(false);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  // Server-side search/paging controls. Default to bot-member-only because
  // workspaces routinely have thousands of channels but the bot is in a
  // handful — those are the actionable ones for routing.
  const [discoverySearch, setDiscoverySearch] = useState("");
  const [discoveryMemberOnly, setDiscoveryMemberOnly] = useState(true);
  const [discoveryLoadingMore, setDiscoveryLoadingMore] = useState(false);
  const [manualChannelId, setManualChannelId] = useState("");
  const [manualChannelName, setManualChannelName] = useState("");

  // Current team data (may be refreshed after mutations)
  const [currentTeam, setCurrentTeam] = useState<Team | null>(team);

  useEffect(() => {
    if (open && team) {
      setCurrentTeam(team);
      setActiveMode(mode);
      setIsEditing(false);
      setEditName(team.name);
      setEditDescription(team.description || "");
      setError(null);
      setNewMemberEmail("");
      setNewMemberRole("member");
      setResourcesData(null);
      setResourcesNotice(null);
      setRolesData(null);
      setRolesNotice(null);
      setChannelsData(null);
      setEditedChannels([]);
      setChannelsNotice(null);
      setDiscovery(null);
      setDiscoveryError(null);
      setDiscoverySearch("");
      setDiscoveryMemberOnly(true);
      setManualChannelId("");
      setManualChannelName("");
    }
  }, [open, team, mode]);

  // Spec 104 — load the resources catalog the first time the user opens
  // the tab for a given team. We refetch on every open of the tab so the
  // picker reflects newly-created agents/MCP servers without requiring a
  // dialog close.
  useEffect(() => {
    if (!open || activeMode !== "resources" || !currentTeam) return;
    let cancelled = false;
    setResourcesLoading(true);
    setError(null);
    setResourcesNotice(null);
    fetch(`/api/admin/teams/${currentTeam._id}/resources`)
      .then(async (res) => {
        const data = await res.json();
        if (!data.success) {
          throw new Error(data.error || "Failed to load resources");
        }
        if (!cancelled) {
          const payload = data.data as ResourcesPayload;
          setResourcesData(payload);
          setSelectedAgents(new Set(payload.resources.agents ?? []));
          setSelectedAgentAdmins(new Set(payload.resources.agent_admins ?? []));
          setSelectedTools(new Set(payload.resources.tools ?? []));
          setToolWildcard(Boolean(payload.resources.tool_wildcard));
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load resources");
        }
      })
      .finally(() => {
        if (!cancelled) setResourcesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, activeMode, currentTeam]);

  // Spec 104 — load realm-role catalog when the Roles tab opens. Same
  // pattern as Resources: refetch on every tab open so newly created roles
  // (e.g. an admin just added a new KB-scoped role) show up without a
  // dialog close/reopen cycle.
  useEffect(() => {
    if (!open || activeMode !== "roles" || !currentTeam) return;
    let cancelled = false;
    setRolesLoading(true);
    setError(null);
    setRolesNotice(null);
    fetch(`/api/admin/teams/${currentTeam._id}/roles`)
      .then(async (res) => {
        const data = await res.json();
        if (!data.success) {
          throw new Error(data.error || "Failed to load roles");
        }
        if (!cancelled) {
          const payload = data.data as RolesPayload;
          setRolesData(payload);
          setSelectedRoles(payload.roles ?? []);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load roles");
        }
      })
      .finally(() => {
        if (!cancelled) setRolesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, activeMode, currentTeam]);

  // Spec 098 US9 — load this team's channel assignments + bindable agents
  // when the Slack Channels tab opens. Mirrors the resources/roles tabs:
  // refetch on every open so newly-added agents show up in the bind dropdown
  // without a dialog close cycle.
  useEffect(() => {
    if (!open || activeMode !== "channels" || !currentTeam) return;
    let cancelled = false;
    setChannelsLoading(true);
    setError(null);
    setChannelsNotice(null);
    fetch(`/api/admin/teams/${currentTeam._id}/slack-channels`)
      .then(async (res) => {
        const data = await res.json();
        if (!data.success) {
          throw new Error(data.error || "Failed to load channels");
        }
        if (!cancelled) {
          const payload = data.data as SlackChannelsPayload;
          setChannelsData(payload);
          // Clone for edit so we don't mutate the canonical payload until
          // the admin clicks Save.
          setEditedChannels(payload.channels.map((c) => ({ ...c })));
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load channels");
        }
      })
      .finally(() => {
        if (!cancelled) setChannelsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, activeMode, currentTeam]);

  // Discovery: first page is fetched whenever search/member-only changes
  // (debounced below). The first call against a fresh cache walks the entire
  // workspace channel list once on the server; subsequent filters/pages are
  // served from the in-process cache, so search-as-you-type stays snappy.
  const fetchDiscoveryPage = useCallback(
    async (opts: {
      q: string;
      memberOnly: boolean;
      cursor?: string | null;
      forceRefresh?: boolean;
      append: boolean;
    }) => {
      const { q, memberOnly, cursor, forceRefresh, append } = opts;
      if (append) setDiscoveryLoadingMore(true);
      else setDiscoveryLoading(true);
      setDiscoveryError(null);
      try {
        const params = new URLSearchParams();
        if (q) params.set("q", q);
        params.set("member_only", memberOnly ? "1" : "0");
        params.set("limit", "500");
        if (cursor) params.set("cursor", cursor);
        if (forceRefresh) params.set("refresh", "1");
        const res = await fetch(
          `/api/admin/slack/available-channels?${params.toString()}`
        );
        const data = await res.json();
        if (!data.success) {
          throw new Error(data.error || `Failed (${res.status})`);
        }
        const payload = data.data as DiscoveryPayload;
        setDiscovery((prev) =>
          append && prev
            ? {
                ...payload,
                channels: [...prev.channels, ...payload.channels],
              }
            : payload
        );
      } catch (err: unknown) {
        setDiscoveryError(
          err instanceof Error ? err.message : "Discovery failed"
        );
      } finally {
        if (append) setDiscoveryLoadingMore(false);
        else setDiscoveryLoading(false);
      }
    },
    []
  );

  const loadDiscovery = useCallback(
    (forceRefresh = false) =>
      fetchDiscoveryPage({
        q: discoverySearch.trim(),
        memberOnly: discoveryMemberOnly,
        forceRefresh,
        append: false,
      }),
    [fetchDiscoveryPage, discoverySearch, discoveryMemberOnly]
  );

  const loadMoreDiscovery = useCallback(() => {
    if (!discovery?.next_cursor) return;
    void fetchDiscoveryPage({
      q: discovery.query.q,
      memberOnly: discovery.query.member_only,
      cursor: discovery.next_cursor,
      append: true,
    });
  }, [discovery, fetchDiscoveryPage]);

  // Debounced re-fetch when the admin is actively in the Slack tab and
  // tweaks the search box or the member-only toggle. We only auto-fetch
  // after the user has clicked "Discover" once (i.e. `discovery` is
  // populated) so we don't make Slack API calls on every keystroke for
  // panels the admin never engages with.
  useEffect(() => {
    if (activeMode !== "channels") return;
    if (!discovery) return; // wait for explicit Discover click
    const handle = setTimeout(() => {
      void fetchDiscoveryPage({
        q: discoverySearch.trim(),
        memberOnly: discoveryMemberOnly,
        append: false,
      });
    }, 250);
    return () => clearTimeout(handle);
    // We intentionally do NOT depend on `discovery` here — that would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discoverySearch, discoveryMemberOnly, activeMode, fetchDiscoveryPage]);

  const handleAddChannelFromDiscovery = (c: DiscoveredSlackChannel) => {
    setEditedChannels((prev) => {
      if (prev.some((p) => p.slack_channel_id === c.id)) return prev;
      return [
        ...prev,
        {
          slack_channel_id: c.id,
          channel_name: c.name,
          slack_workspace_id: "unknown",
          bound_agent_id: null,
        },
      ];
    });
  };

  const handleAddChannelManual = () => {
    const id = manualChannelId.trim();
    const name = manualChannelName.trim() || id;
    if (!id) return;
    setEditedChannels((prev) => {
      if (prev.some((p) => p.slack_channel_id === id)) return prev;
      return [
        ...prev,
        {
          slack_channel_id: id,
          channel_name: name,
          slack_workspace_id: "unknown",
          bound_agent_id: null,
        },
      ];
    });
    setManualChannelId("");
    setManualChannelName("");
  };

  const handleRemoveChannel = (id: string) => {
    setEditedChannels((prev) => prev.filter((c) => c.slack_channel_id !== id));
  };

  const handleBindAgentChange = (channelId: string, agentId: string | null) => {
    setEditedChannels((prev) =>
      prev.map((c) =>
        c.slack_channel_id === channelId ? { ...c, bound_agent_id: agentId } : c
      )
    );
  };

  const handleSaveChannels = async () => {
    if (!currentTeam) return;
    setChannelsSaving(true);
    setError(null);
    setChannelsNotice(null);
    try {
      const res = await fetch(`/api/admin/teams/${currentTeam._id}/slack-channels`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channels: editedChannels }),
      });
      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || "Failed to save channels");
      }
      const removed: string[] = data.data?.removed_channel_ids ?? [];
      setChannelsNotice(
        removed.length > 0
          ? `Saved. ${editedChannels.length} channel(s) active; ${removed.length} removed.`
          : `Saved. ${editedChannels.length} channel(s) assigned.`
      );
      // Refresh canonical state so the next edit starts from the saved snapshot.
      setChannelsData((prev) =>
        prev ? { ...prev, channels: editedChannels.map((c) => ({ ...c })) } : prev
      );
      onTeamUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save channels");
    } finally {
      setChannelsSaving(false);
    }
  };

  function toggleSet(setter: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const toggleAgent = (id: string) => toggleSet(setSelectedAgents, id);
  const toggleAgentAdmin = (id: string) => toggleSet(setSelectedAgentAdmins, id);
  const toggleTool = (id: string) => toggleSet(setSelectedTools, id);

  const handleSaveResources = async () => {
    if (!currentTeam) return;
    setResourcesSaving(true);
    setError(null);
    setResourcesNotice(null);
    try {
      const res = await fetch(`/api/admin/teams/${currentTeam._id}/resources`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agents: Array.from(selectedAgents),
          agent_admins: Array.from(selectedAgentAdmins),
          tools: Array.from(selectedTools),
          tool_wildcard: toolWildcard,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || "Failed to save resources");
      }
      const skipped: string[] = data.data?.members_skipped ?? [];
      const updated: string[] = data.data?.members_updated ?? [];
      setResourcesNotice(
        skipped.length > 0
          ? `Saved. ${updated.length} member(s) updated; ${skipped.length} skipped (no Keycloak account yet): ${skipped.join(", ")}`
          : `Saved. ${updated.length} member(s) updated.`
      );
      onTeamUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save resources");
    } finally {
      setResourcesSaving(false);
    }
  };

  const handleSaveRoles = async () => {
    if (!currentTeam) return;
    setRolesSaving(true);
    setError(null);
    setRolesNotice(null);
    try {
      const res = await fetch(`/api/admin/teams/${currentTeam._id}/roles`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roles: selectedRoles }),
      });
      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || "Failed to save roles");
      }
      const skipped: string[] = data.data?.members_skipped ?? [];
      const updated: string[] = data.data?.members_updated ?? [];
      setRolesNotice(
        skipped.length > 0
          ? `Saved. ${updated.length} member(s) updated; ${skipped.length} skipped (no Keycloak account yet): ${skipped.join(", ")}`
          : `Saved. ${updated.length} member(s) updated.`
      );
      onTeamUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save roles");
    } finally {
      setRolesSaving(false);
    }
  };

  const refreshTeam = async () => {
    if (!currentTeam) return;
    try {
      const res = await fetch(`/api/admin/teams/${currentTeam._id}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setCurrentTeam(data.data.team);
        }
      }
    } catch (err) {
      console.error("[TeamDetails] Failed to refresh team:", err);
    }
  };

  const handleSaveEdit = async () => {
    if (!currentTeam) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/admin/teams/${currentTeam._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName.trim(),
          description: editDescription.trim(),
        }),
      });

      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || "Failed to update team");
      }

      setCurrentTeam(data.data.team);
      setIsEditing(false);
      onTeamUpdated();
    } catch (err: any) {
      setError(err.message || "Failed to update team");
    } finally {
      setLoading(false);
    }
  };

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentTeam || !newMemberEmail.trim()) return;

    setAddingMember(true);
    setError(null);

    try {
      const res = await fetch(`/api/admin/teams/${currentTeam._id}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: newMemberEmail.trim(),
          role: newMemberRole,
        }),
      });

      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || "Failed to add member");
      }

      setCurrentTeam(data.data.team);
      setNewMemberEmail("");
      setNewMemberRole("member");
      onTeamUpdated();
    } catch (err: any) {
      setError(err.message || "Failed to add member");
    } finally {
      setAddingMember(false);
    }
  };

  const handleRemoveMember = async (email: string) => {
    if (!currentTeam) return;

    if (!confirm(`Remove ${email} from ${currentTeam.name}?`)) return;

    setRemovingMember(email);
    setError(null);

    try {
      const res = await fetch(
        `/api/admin/teams/${currentTeam._id}/members?user_id=${encodeURIComponent(email)}`,
        { method: "DELETE" }
      );

      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || "Failed to remove member");
      }

      setCurrentTeam(data.data.team);
      onTeamUpdated();
    } catch (err: any) {
      setError(err.message || "Failed to remove member");
    } finally {
      setRemovingMember(null);
    }
  };

  if (!currentTeam) return null;

  const members = currentTeam.members || [];
  const sortedMembers = [...members].sort((a, b) => {
    const roleOrder = { owner: 0, admin: 1, member: 2 };
    return (roleOrder[a.role as keyof typeof roleOrder] ?? 2) -
           (roleOrder[b.role as keyof typeof roleOrder] ?? 2);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[680px] max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isEditing ? "Edit Team" : currentTeam.name}
          </DialogTitle>
          <DialogDescription>
            {isEditing
              ? "Update the team name and description"
              : currentTeam.description || "No description"}
          </DialogDescription>
        </DialogHeader>

        {/* Mode Tabs */}
        <div className="flex gap-1 border-b pb-2">
          <Button
            variant={activeMode === "details" ? "default" : "ghost"}
            size="sm"
            onClick={() => setActiveMode("details")}
            className="text-xs"
          >
            Details
          </Button>
          <Button
            variant={activeMode === "members" ? "default" : "ghost"}
            size="sm"
            onClick={() => setActiveMode("members")}
            className="text-xs"
          >
            Members ({members.length})
          </Button>
          <Button
            variant={activeMode === "resources" ? "default" : "ghost"}
            size="sm"
            onClick={() => setActiveMode("resources")}
            className="text-xs"
          >
            Resources
          </Button>
          <Button
            variant={activeMode === "kbs" ? "default" : "ghost"}
            size="sm"
            onClick={() => setActiveMode("kbs")}
            className="text-xs"
          >
            Knowledge Bases
          </Button>
          <Button
            variant={activeMode === "channels" ? "default" : "ghost"}
            size="sm"
            onClick={() => setActiveMode("channels")}
            className="text-xs"
          >
            Slack Channels
          </Button>
          <Button
            variant={activeMode === "roles" ? "default" : "ghost"}
            size="sm"
            onClick={() => setActiveMode("roles")}
            className="text-xs"
          >
            Roles
          </Button>
        </div>

        {/* Error Banner */}
        {error && (
          <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-3">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        {/* Details Mode */}
        {activeMode === "details" && (
          <div className="space-y-4 py-2">
            {isEditing ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="editName">Team Name</Label>
                  <Input
                    id="editName"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    disabled={loading}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="editDesc">Description</Label>
                  <Textarea
                    id="editDesc"
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    disabled={loading}
                    rows={3}
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={handleSaveEdit}
                    disabled={loading || !editName.trim()}
                  >
                    {loading ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-1" />
                    ) : (
                      <Check className="h-4 w-4 mr-1" />
                    )}
                    Save
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setIsEditing(false);
                      setEditName(currentTeam.name);
                      setEditDescription(currentTeam.description || "");
                      setError(null);
                    }}
                    disabled={loading}
                  >
                    <X className="h-4 w-4 mr-1" />
                    Cancel
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Name</span>
                    <span className="text-sm font-medium">{currentTeam.name}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Description</span>
                    <span className="text-sm">{currentTeam.description || "—"}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Owner</span>
                    <span className="text-sm">{currentTeam.owner_id}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Members</span>
                    <span className="text-sm">{members.length}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Created</span>
                    <span className="text-sm">
                      {new Date(currentTeam.created_at).toLocaleDateString()}
                    </span>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setIsEditing(true)}
                  className="gap-1"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Edit
                </Button>
              </>
            )}
          </div>
        )}

        {/* Members Mode */}
        {activeMode === "members" && (
          <div className="space-y-4 py-2 flex-1 min-h-0 flex flex-col">
            {/* Add Member Form */}
            <form onSubmit={handleAddMember} className="flex gap-2">
              <Input
                placeholder="user@example.com"
                value={newMemberEmail}
                onChange={(e) => setNewMemberEmail(e.target.value)}
                disabled={addingMember}
                className="flex-1"
                type="email"
              />
              <select
                value={newMemberRole}
                onChange={(e) => setNewMemberRole(e.target.value as "member" | "admin")}
                disabled={addingMember}
                className="h-9 rounded-md border bg-background px-3 text-sm"
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
              <Button
                type="submit"
                size="sm"
                disabled={addingMember || !newMemberEmail.trim()}
                className="gap-1 h-9"
              >
                {addingMember ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <UserPlus className="h-4 w-4" />
                )}
                Add
              </Button>
            </form>

            {/* Members List */}
            <ScrollArea className="flex-1 -mx-1 px-1" style={{ maxHeight: "320px" }}>
              <div className="space-y-1">
                {sortedMembers.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    No members yet. Add members above.
                  </p>
                ) : (
                  sortedMembers.map((member) => (
                    <div
                      key={member.user_id}
                      className="flex items-center justify-between py-2 px-3 rounded-md hover:bg-muted/50 group"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-medium text-sm shrink-0">
                          {member.user_id.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm truncate">{member.user_id}</p>
                          <p className="text-xs text-muted-foreground">
                            Added {new Date(member.added_at).toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge variant={getRoleBadgeVariant(member.role)} className="gap-1 text-xs">
                          {getRoleIcon(member.role)}
                          {member.role}
                        </Badge>
                        {member.role !== "owner" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                            onClick={() => handleRemoveMember(member.user_id)}
                            disabled={removingMember === member.user_id}
                          >
                            {removingMember === member.user_id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          </div>
        )}

        {/* Resources Mode (Spec 104 — team-scoped RBAC) */}
        {activeMode === "resources" && (
          <div className="space-y-4 py-2 flex-1 min-h-0 flex flex-col">
            <p className="text-xs text-muted-foreground">
              Grant this team access to agents and tools. Saving creates the
              matching realm roles in Keycloak (<code className="font-mono">agent_user:&lt;id&gt;</code>,{" "}
              <code className="font-mono">agent_admin:&lt;id&gt;</code>,{" "}
              <code className="font-mono">tool_user:&lt;prefix&gt;</code>,{" "}
              <code className="font-mono">tool_user:*</code>) and assigns them
              to every team member. For other realm roles see the{" "}
              <button
                type="button"
                className="underline"
                onClick={() => setActiveMode("roles")}
              >
                Roles tab
              </button>.
            </p>

            {resourcesNotice && (
              <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 p-3">
                <p className="text-sm text-emerald-700 dark:text-emerald-400">
                  {resourcesNotice}
                </p>
              </div>
            )}

            {resourcesLoading || !resourcesData ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 flex-1 min-h-0">
                <AgentList
                  options={resourcesData.available.agents}
                  selectedUsers={selectedAgents}
                  selectedAdmins={selectedAgentAdmins}
                  onToggleUser={toggleAgent}
                  onToggleAdmin={toggleAgentAdmin}
                />
                <ToolList
                  options={resourcesData.available.tools}
                  selected={selectedTools}
                  onToggle={toggleTool}
                  wildcard={toolWildcard}
                  onWildcardChange={setToolWildcard}
                />
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button
                size="sm"
                onClick={handleSaveResources}
                disabled={resourcesSaving || resourcesLoading || !resourcesData}
              >
                {resourcesSaving ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                ) : (
                  <Check className="h-4 w-4 mr-1" />
                )}
                Save Resources
              </Button>
            </div>
          </div>
        )}

        {/* Roles Mode (Spec 104 — global / catch-all realm-role assignment) */}
        {activeMode === "roles" && (
          <div className="space-y-4 py-2 flex-1 min-h-0 flex flex-col">
            <p className="text-xs text-muted-foreground">
              Assign realm roles to every member of this team. Use this for
              global flags (<code className="font-mono">admin_user</code>,{" "}
              <code className="font-mono">chat_user</code>,{" "}
              <code className="font-mono">kb_admin</code>), KB-scoped roles
              (<code className="font-mono">kb_reader:&lt;kb&gt;</code>), or any
              custom realm role. Agent/tool grants live in the{" "}
              <button
                type="button"
                className="underline"
                onClick={() => setActiveMode("resources")}
              >
                Resources tab
              </button>.
            </p>

            {rolesNotice && (
              <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 p-3">
                <p className="text-sm text-emerald-700 dark:text-emerald-400">
                  {rolesNotice}
                </p>
              </div>
            )}

            {rolesLoading || !rolesData ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <RoleAssignmentPanel
                catalog={rolesData.available}
                selected={selectedRoles}
                onChange={setSelectedRoles}
              />
            )}

            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button
                size="sm"
                onClick={handleSaveRoles}
                disabled={rolesSaving || rolesLoading || !rolesData}
              >
                {rolesSaving ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                ) : (
                  <Check className="h-4 w-4 mr-1" />
                )}
                Save Roles
              </Button>
            </div>
          </div>
        )}

        {/* Slack Channels Mode (Spec 098 US9 — channel ↔ team binding) */}
        {activeMode === "channels" && (
          <div className="space-y-4 py-2 flex-1 min-h-0 flex flex-col">
            <p className="text-xs text-muted-foreground">
              Bind Slack channels to this team. The Slack bot uses{" "}
              <code className="font-mono">channel_team_mappings</code> to
              decide which team&apos;s RBAC applies to in-channel requests, and
              optionally <code className="font-mono">channel_agent_mappings</code>{" "}
              to pick the default agent. Bound agents must already be assigned
              to the team via the{" "}
              <button
                type="button"
                className="underline"
                onClick={() => setActiveMode("resources")}
              >
                Resources tab
              </button>.
            </p>

            {channelsNotice && (
              <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 p-3">
                <p className="text-sm text-emerald-700 dark:text-emerald-400">
                  {channelsNotice}
                </p>
              </div>
            )}

            {channelsLoading || !channelsData ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <SlackChannelsPanel
                assigned={editedChannels}
                bindableAgents={channelsData.available_agents}
                discovery={discovery}
                discoveryLoading={discoveryLoading}
                discoveryLoadingMore={discoveryLoadingMore}
                discoveryError={discoveryError}
                discoverySearch={discoverySearch}
                discoveryMemberOnly={discoveryMemberOnly}
                onSearchChange={setDiscoverySearch}
                onMemberOnlyChange={setDiscoveryMemberOnly}
                onLoadDiscovery={loadDiscovery}
                onLoadMoreDiscovery={loadMoreDiscovery}
                onAddFromDiscovery={handleAddChannelFromDiscovery}
                onAddManual={handleAddChannelManual}
                onRemove={handleRemoveChannel}
                onBindAgent={handleBindAgentChange}
                manualChannelId={manualChannelId}
                manualChannelName={manualChannelName}
                onManualIdChange={setManualChannelId}
                onManualNameChange={setManualChannelName}
              />
            )}

            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button
                size="sm"
                onClick={handleSaveChannels}
                disabled={channelsSaving || channelsLoading || !channelsData}
              >
                {channelsSaving ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                ) : (
                  <Check className="h-4 w-4 mr-1" />
                )}
                Save Channels
              </Button>
            </div>
          </div>
        )}

        {/* Knowledge Bases Mode (Spec 102/103 — RAG team-scoped access) */}
        {activeMode === "kbs" && (
          <div className="py-2 flex-1 min-h-0 overflow-y-auto">
            <TeamKbAssignmentPanel
              teamId={currentTeam._id}
              teamName={currentTeam.name}
              isAdmin={true}
            />
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Spec 104 — Agents picker. Each row has two independent checkboxes:
 * "Use" (`agent_user:<id>`) and "Manage" (`agent_admin:<id>`). Manage
 * implies Use in our authz model, so ticking Manage auto-ticks Use; the
 * UI mirrors this so admins don't end up with the visually-confusing
 * state of "manage but cannot use".
 */
function AgentList({
  options,
  selectedUsers,
  selectedAdmins,
  onToggleUser,
  onToggleAdmin,
}: {
  options: ResourceOption[];
  selectedUsers: Set<string>;
  selectedAdmins: Set<string>;
  onToggleUser: (id: string) => void;
  onToggleAdmin: (id: string) => void;
}) {
  const handleAdminClick = (id: string, currentlyAdmin: boolean) => {
    onToggleAdmin(id);
    // When promoting to admin, auto-grant Use as well (admin implies use).
    // When demoting, leave Use alone — the admin may want the user to keep
    // chat access without manage rights.
    if (!currentlyAdmin && !selectedUsers.has(id)) {
      onToggleUser(id);
    }
  };

  return (
    <div className="rounded-md border flex flex-col min-h-0">
      <div className="px-3 py-2 border-b bg-muted/30 flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Agents ({selectedUsers.size} / {options.length})
        </p>
        <div className="flex items-center gap-3 text-[10px] uppercase tracking-wide text-muted-foreground">
          <span>Use</span>
          <span>Manage</span>
        </div>
      </div>
      <ScrollArea className="flex-1 p-2" style={{ maxHeight: "260px" }}>
        {options.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            No agents available
          </p>
        ) : (
          <ul className="space-y-1">
            {options.map((opt) => {
              const isUser = selectedUsers.has(opt.id);
              const isAdmin = selectedAdmins.has(opt.id);
              return (
                <li
                  key={opt.id}
                  className="flex items-start gap-2 px-2 py-1.5 rounded hover:bg-muted/50"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-mono truncate">{opt.name}</span>
                    {opt.description ? (
                      <span className="block text-xs text-muted-foreground truncate">
                        {opt.description}
                      </span>
                    ) : null}
                  </span>
                  <div className="flex items-center gap-3 mt-0.5">
                    <label
                      className="flex items-center cursor-pointer"
                      title="agent_user:<id> — chat with this agent"
                    >
                      <input
                        type="checkbox"
                        checked={isUser}
                        onChange={() => onToggleUser(opt.id)}
                        // Disabling Use when Manage is on prevents the
                        // user from accidentally creating an "admin but no
                        // use" state that authz actually allows but is
                        // confusing. They can untick Manage first.
                        disabled={isAdmin}
                      />
                    </label>
                    <label
                      className="flex items-center cursor-pointer"
                      title="agent_admin:<id> — edit/configure this agent"
                    >
                      <input
                        type="checkbox"
                        checked={isAdmin}
                        onChange={() => handleAdminClick(opt.id, isAdmin)}
                      />
                    </label>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </ScrollArea>
    </div>
  );
}

/**
 * Spec 104 — Tools picker. A single column of MCP-server prefixes plus a
 * single "All tools" wildcard checkbox at the top that, when ticked,
 * grants `tool_user:*` to members. Wildcard does not visually un-tick the
 * per-server boxes — they stay as a record of intent — but on the backend
 * the wildcard role alone is sufficient for authz.
 */
function ToolList({
  options,
  selected,
  onToggle,
  wildcard,
  onWildcardChange,
}: {
  options: ResourceOption[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  wildcard: boolean;
  onWildcardChange: (v: boolean) => void;
}) {
  return (
    <div className="rounded-md border flex flex-col min-h-0">
      <div className="px-3 py-2 border-b bg-muted/30">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Tools ({selected.size} / {options.length})
          {wildcard && (
            <Badge variant="secondary" className="ml-2 text-[10px]">
              wildcard
            </Badge>
          )}
        </p>
      </div>
      <div className="px-3 py-2 border-b bg-amber-500/5">
        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={wildcard}
            onChange={(e) => onWildcardChange(e.target.checked)}
          />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">All tools (wildcard)</span>
            <span className="block text-xs text-muted-foreground">
              Grant <code className="font-mono">tool_user:*</code> — invoke any
              MCP tool. Use sparingly.
            </span>
          </span>
        </label>
      </div>
      <ScrollArea className="flex-1 p-2" style={{ maxHeight: "200px" }}>
        {options.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            No MCP servers available
          </p>
        ) : (
          <ul className="space-y-1">
            {options.map((opt) => {
              const checked = selected.has(opt.id);
              return (
                <li key={opt.id}>
                  <label
                    className={`flex items-start gap-2 px-2 py-1.5 rounded hover:bg-muted/50 cursor-pointer ${
                      wildcard ? "opacity-60" : ""
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={checked}
                      onChange={() => onToggle(opt.id)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-mono truncate">{opt.name}</span>
                      {opt.description ? (
                        <span className="block text-xs text-muted-foreground truncate">
                          {opt.description}
                        </span>
                      ) : null}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </ScrollArea>
    </div>
  );
}

/**
 * Spec 104 — Roles picker. Renders the realm-role catalog grouped by
 * category prefix (`agent_user`, `tool_user`, `kb_reader`, …) with a
 * MultiSelect that supports search + free-form add (so admins can paste
 * a role name like `kb_reader:kb-new` even if the catalog hasn't been
 * refreshed yet). Currently-assigned roles that aren't in the catalog
 * (e.g. role was deleted, or a custom one) are still surfaced as chips
 * so admins can remove them.
 */
/**
 * Spec 098 US9 — Slack channels picker.
 *
 * Two-column layout:
 *   Left  — channels currently assigned to the team (editable: change bound
 *           agent, remove)
 *   Right — channel discovery (live Slack `conversations.list`) + manual
 *           channel-ID entry as fallback when SLACK_BOT_TOKEN is unset or
 *           the channel isn't visible to the bot yet
 *
 * The bound-agent dropdown is intentionally limited to the team's
 * `resources.agents` so admins can't accidentally bind a channel to an
 * agent the team doesn't otherwise have access to (the backend enforces
 * this too).
 */
function SlackChannelsPanel({
  assigned,
  bindableAgents,
  discovery,
  discoveryLoading,
  discoveryLoadingMore,
  discoveryError,
  discoverySearch,
  discoveryMemberOnly,
  onSearchChange,
  onMemberOnlyChange,
  onLoadDiscovery,
  onLoadMoreDiscovery,
  onAddFromDiscovery,
  onAddManual,
  onRemove,
  onBindAgent,
  manualChannelId,
  manualChannelName,
  onManualIdChange,
  onManualNameChange,
}: {
  assigned: TeamSlackChannel[];
  bindableAgents: ResourceOption[];
  discovery: DiscoveryPayload | null;
  discoveryLoading: boolean;
  discoveryLoadingMore: boolean;
  discoveryError: string | null;
  discoverySearch: string;
  discoveryMemberOnly: boolean;
  onSearchChange: (v: string) => void;
  onMemberOnlyChange: (v: boolean) => void;
  onLoadDiscovery: (forceRefresh?: boolean) => void;
  onLoadMoreDiscovery: () => void;
  onAddFromDiscovery: (c: DiscoveredSlackChannel) => void;
  onAddManual: () => void;
  onRemove: (id: string) => void;
  onBindAgent: (channelId: string, agentId: string | null) => void;
  manualChannelId: string;
  manualChannelName: string;
  onManualIdChange: (v: string) => void;
  onManualNameChange: (v: string) => void;
}) {
  const assignedIds = new Set(assigned.map((c) => c.slack_channel_id));
  // We keep already-assigned channels visible in the discovery list (with an
  // "Assigned" pill and disabled +) instead of hiding them, so that
  // server-side page counts stay coherent and the admin understands why a
  // channel they searched for doesn't have a + button.
  const discoveryChannels = discovery?.channels ?? [];
  const trimmedSearch = discoverySearch.trim();

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 flex-1 min-h-0">
      {/* LEFT — assigned channels */}
      <div className="rounded-md border flex flex-col min-h-0">
        <div className="px-3 py-2 border-b bg-muted/30">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Assigned channels ({assigned.length})
          </p>
        </div>
        <ScrollArea className="flex-1 p-2" style={{ maxHeight: "320px" }}>
          {assigned.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              No channels assigned. Pick from the right →
            </p>
          ) : (
            <ul className="space-y-2">
              {assigned.map((c) => (
                <li
                  key={c.slack_channel_id}
                  className="rounded border p-2 space-y-2 bg-background"
                >
                  <div className="flex items-start gap-2">
                    <Hash className="h-3.5 w-3.5 mt-1 text-muted-foreground shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">
                        {c.channel_name}
                      </div>
                      <div className="text-[11px] font-mono text-muted-foreground truncate">
                        {c.slack_channel_id}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive shrink-0"
                      onClick={() => onRemove(c.slack_channel_id)}
                      title="Remove from team"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <div className="flex items-center gap-2">
                    <Label className="text-[10px] uppercase tracking-wide text-muted-foreground shrink-0">
                      Bound agent
                    </Label>
                    <select
                      value={c.bound_agent_id ?? ""}
                      onChange={(e) =>
                        onBindAgent(c.slack_channel_id, e.target.value || null)
                      }
                      className="h-7 rounded border bg-background px-2 text-xs flex-1 min-w-0"
                    >
                      <option value="">— None (fall through) —</option>
                      {bindableAgents.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
      </div>

      {/* RIGHT — discovery + manual entry */}
      <div className="rounded-md border flex flex-col min-h-0">
        <div className="px-3 py-2 border-b bg-muted/30 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Available channels
              {discovery && (
                <span className="ml-1 normal-case font-normal">
                  ({discovery.channels.length}
                  {discovery.has_more
                    ? ` of ${discovery.total_matches}`
                    : ""}
                  )
                </span>
              )}
            </p>
            <Button
              size="sm"
              variant="outline"
              className="h-6 text-[11px] gap-1"
              onClick={() => onLoadDiscovery(Boolean(discovery))}
              disabled={discoveryLoading}
              title={
                discovery
                  ? "Re-fetch channel list from Slack (invalidates cache)"
                  : "Discover channels from Slack"
              }
            >
              {discoveryLoading ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
              {discovery ? "Refresh cache" : "Discover"}
            </Button>
          </div>

          {/* Search + member-only toggle. Hidden until first Discover so the
              tab stays simple when admins haven't engaged with discovery
              yet. */}
          {discovery && (
            <>
              <div className="relative">
                <Search className="h-3 w-3 text-muted-foreground absolute left-2 top-1/2 -translate-y-1/2" />
                <Input
                  value={discoverySearch}
                  onChange={(e) => onSearchChange(e.target.value)}
                  placeholder="Search by name…"
                  className="h-7 text-xs pl-6"
                />
              </div>
              <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={discoveryMemberOnly}
                  onChange={(e) => onMemberOnlyChange(e.target.checked)}
                  className="h-3 w-3"
                />
                <span>Only channels the bot is a member of</span>
                {discovery && !discoveryMemberOnly && (
                  <span className="text-amber-600 dark:text-amber-400">
                    · including {discovery.total_visible} workspace channels
                  </span>
                )}
              </label>
            </>
          )}
        </div>

        {discoveryError && (
          <div className="px-3 py-2 border-b bg-amber-500/5">
            <p className="text-[11px] text-amber-700 dark:text-amber-400">
              Discovery failed: {discoveryError}. You can still add channels
              manually below.
            </p>
          </div>
        )}

        <ScrollArea className="flex-1 p-2" style={{ maxHeight: "260px" }}>
          {!discovery && !discoveryLoading ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              Click <strong>Discover</strong> to list channels the bot can see.
            </p>
          ) : discovery && discoveryChannels.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              {trimmedSearch
                ? `No channels match "${trimmedSearch}".`
                : discoveryMemberOnly
                  ? "The bot isn't a member of any channels. Untick the filter to see all workspace channels, or invite the bot in Slack and refresh."
                  : "No channels available."}
            </p>
          ) : (
            <ul className="space-y-1">
              {discoveryChannels.map((c) => {
                const alreadyAssigned = assignedIds.has(c.id);
                return (
                  <li
                    key={c.id}
                    className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/50"
                  >
                    {c.is_private ? (
                      <Lock className="h-3 w-3 text-muted-foreground shrink-0" />
                    ) : (
                      <Hash className="h-3 w-3 text-muted-foreground shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="text-sm truncate">{c.name}</div>
                      <div className="text-[11px] text-muted-foreground">
                        <span className="font-mono">{c.id}</span>
                        {c.num_members > 0 && (
                          <span> · {c.num_members} members</span>
                        )}
                        {!c.is_member && (
                          <span className="text-amber-600 dark:text-amber-400">
                            {" "}
                            · bot not a member
                          </span>
                        )}
                      </div>
                    </div>
                    {alreadyAssigned ? (
                      <Badge
                        variant="secondary"
                        className="text-[10px] h-5 px-1.5 shrink-0"
                      >
                        Assigned
                      </Badge>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 w-6 p-0 shrink-0"
                        onClick={() => onAddFromDiscovery(c)}
                        title="Assign to team"
                      >
                        <Plus className="h-3 w-3" />
                      </Button>
                    )}
                  </li>
                );
              })}
              {discovery?.has_more && (
                <li className="pt-2 flex justify-center">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-[11px] gap-1"
                    onClick={onLoadMoreDiscovery}
                    disabled={discoveryLoadingMore}
                  >
                    {discoveryLoadingMore ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : null}
                    Load more (
                    {discovery.total_matches - discoveryChannels.length}{" "}
                    remaining)
                  </Button>
                </li>
              )}
            </ul>
          )}
        </ScrollArea>

        <div className="px-3 py-2 border-t bg-muted/20 space-y-1">
          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Or add by ID
          </Label>
          <div className="flex gap-1">
            <Input
              value={manualChannelId}
              onChange={(e) => onManualIdChange(e.target.value)}
              placeholder="C0ASAQMEZ4M"
              className="h-7 text-xs font-mono flex-1 min-w-0"
            />
            <Input
              value={manualChannelName}
              onChange={(e) => onManualNameChange(e.target.value)}
              placeholder="#display-name"
              className="h-7 text-xs flex-1 min-w-0"
            />
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 shrink-0"
              onClick={onAddManual}
              disabled={!manualChannelId.trim()}
            >
              <Plus className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function RoleAssignmentPanel({
  catalog,
  selected,
  onChange,
}: {
  catalog: RoleCatalogEntry[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const catalogNames = catalog.map((r) => r.name);
  // Surface assigned-but-not-in-catalog roles so they can be removed.
  const orphan = selected.filter((r) => !catalogNames.includes(r));
  const allOptions = Array.from(new Set([...catalogNames, ...selected])).sort();

  const grouped = catalog.reduce<Record<string, RoleCatalogEntry[]>>((acc, r) => {
    (acc[r.category] = acc[r.category] || []).push(r);
    return acc;
  }, {});
  const categoryOrder = Object.keys(grouped).sort();

  return (
    <div className="space-y-3 flex-1 min-h-0 flex flex-col">
      <div>
        <Label className="text-xs uppercase tracking-wide text-muted-foreground">
          Assigned roles ({selected.length})
        </Label>
        <div className="mt-1">
          <MultiSelect
            options={allOptions}
            selected={selected}
            onChange={onChange}
            placeholder="Pick or type a realm role…"
            searchPlaceholder="Search roles (e.g. kb_reader)"
            emptyLabel="No matching roles"
            badgeLabel="role"
          />
        </div>
        {orphan.length > 0 && (
          <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
            {orphan.length} role(s) not in catalog (orphan or custom): {orphan.join(", ")}
          </p>
        )}
      </div>

      <div className="rounded-md border flex-1 min-h-0 flex flex-col">
        <div className="px-3 py-2 border-b bg-muted/30">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Catalog ({catalog.length})
          </p>
        </div>
        <ScrollArea className="flex-1 p-2" style={{ maxHeight: "240px" }}>
          {categoryOrder.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              No realm roles found. Check that the Keycloak Admin API is reachable.
            </p>
          ) : (
            categoryOrder.map((cat) => (
              <div key={cat} className="mb-3 last:mb-0">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground px-2 mb-1">
                  {cat}
                </p>
                <ul className="space-y-0.5">
                  {grouped[cat].map((r) => {
                    const checked = selected.includes(r.name);
                    return (
                      <li key={r.name}>
                        <label className="flex items-start gap-2 px-2 py-1 rounded hover:bg-muted/50 cursor-pointer">
                          <input
                            type="checkbox"
                            className="mt-0.5"
                            checked={checked}
                            onChange={() =>
                              onChange(
                                checked
                                  ? selected.filter((s) => s !== r.name)
                                  : [...selected, r.name]
                              )
                            }
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-mono truncate">{r.name}</span>
                            {r.description ? (
                              <span className="block text-xs text-muted-foreground truncate">
                                {r.description}
                              </span>
                            ) : null}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
          )}
        </ScrollArea>
      </div>
    </div>
  );
}
