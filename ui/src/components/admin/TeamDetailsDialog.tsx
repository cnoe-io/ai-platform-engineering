"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
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
  MessageSquare,
  ShieldCheck,
  ShieldAlert,
  ShieldQuestion,
  Clock3,
} from "lucide-react";
import type { Team, TeamMember } from "@/types/teams";
import type { TeamMembershipSource } from "@/types/identity-group-sync";
import { TeamKbAssignmentPanel } from "@/components/admin/TeamKbAssignmentPanel";
import { IngestCapabilityToggle } from "@/components/admin/IngestCapabilityToggle";
import { SearchCapabilityToggle } from "@/components/admin/SearchCapabilityToggle";
import { SaveButton } from "@/components/admin/SaveButton";

// Server response shape — mirrors TeamMembershipSyncReport in
// @/lib/rbac/team-openfga-sync-status.ts (kept local to avoid forcing
// the page bundle to import server-side modules).
type TeamMembershipSyncState = "synced" | "pending" | "drifted" | "unknown";

interface TeamMembershipSyncEntry {
  source_signature: string;
  user_email: string;
  user_subject?: string;
  relationship: "member" | "admin";
  source_type: TeamMembershipSource["source_type"];
  status: TeamMembershipSyncState;
  reason: string;
  expected_tuple: { user: string; relation: string; object: string } | null;
}

interface TeamMembershipSyncSummary {
  total: number;
  synced: number;
  pending: number;
  drifted: number;
  unknown: number;
  needs_attention: boolean;
  openfga_available: boolean;
}

interface TeamMembershipSyncReport {
  team_slug: string;
  entries: TeamMembershipSyncEntry[];
  summary: TeamMembershipSyncSummary;
}

export type DialogMode = "details" | "members" | "resources" | "kbs" | "channels" | "webex";

const TEAM_SLACK_DISCOVERY_PAGE_SIZE = 50;

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

// Spec 098 US9 — Slack channels tab.
interface TeamSlackChannel {
  slack_channel_id: string;
  channel_name: string;
  slack_workspace_id?: string;
}

interface SlackChannelsPayload {
  team_id: string;
  channels: TeamSlackChannel[];
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

interface TeamWebexSpace {
  webex_space_id: string;
  space_name: string;
  webex_workspace_id?: string;
}

interface WebexSpacesPayload {
  team_id: string;
  spaces: TeamWebexSpace[];
}

interface DiscoveredWebexSpace {
  id: string;
  name: string;
  type: string;
  is_locked: boolean;
}

interface WebexDiscoveryPayload {
  spaces: DiscoveredWebexSpace[];
  total_matches: number;
  total_visible: number;
  next_cursor: string | null;
  has_more: boolean;
  cached: boolean;
  fetched_at: number;
  query: { q: string; limit: number };
}

interface TeamDetailsDialogProps {
  team: Team | null;
  mode: DialogMode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTeamUpdated: () => void;
  /**
   * Lightweight callback for in-modal mutations (add/remove member, edit
   * details). When provided, the parent receives the updated Team payload
   * and is expected to patch its local `teams[]` state in place — avoiding
   * a full admin-page reload (which otherwise blanks the dashboard).
   *
   * When omitted, the dialog falls back to `onTeamUpdated()` for backwards
   * compatibility.
   */
  onTeamMutated?: (team: Team) => void;
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

function getSourceLabel(source: TeamMembershipSource): string {
  if (source.source_type === "manual") return "Manual";
  if (source.source_type === "oidc_claim") return "OIDC claim";
  if (source.source_type === "active_directory") return "AD";
  if (source.source_type === "okta") return "Okta";
  return source.source_type.replace(/_/g, " ");
}

function getSourceBadgeVariant(source: TeamMembershipSource) {
  if (source.status === "active" && source.source_type === "manual") return "secondary" as const;
  if (source.status === "active") return "outline" as const;
  return "destructive" as const;
}

// Render-helpers for the OpenFGA sync diagnostic. Kept colocated so the
// badge and the banner agree on colour/icon/label.

function severityRank(status: TeamMembershipSyncState): number {
  switch (status) {
    case "drifted":
      return 3;
    case "unknown":
      return 2;
    case "pending":
      return 1;
    case "synced":
    default:
      return 0;
  }
}

function syncBadgeAppearance(status: TeamMembershipSyncState): {
  variant: "default" | "secondary" | "outline" | "destructive";
  icon: React.ReactNode;
  label: string;
} {
  switch (status) {
    case "synced":
      return {
        variant: "outline",
        icon: <ShieldCheck className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />,
        label: "OpenFGA: synced",
      };
    case "drifted":
      return {
        variant: "destructive",
        icon: <ShieldAlert className="h-3 w-3" />,
        label: "OpenFGA: drifted",
      };
    case "pending":
      return {
        variant: "secondary",
        icon: <Clock3 className="h-3 w-3" />,
        label: "OpenFGA: pending",
      };
    case "unknown":
    default:
      return {
        variant: "outline",
        icon: <ShieldQuestion className="h-3 w-3 text-muted-foreground" />,
        label: "OpenFGA: unknown",
      };
  }
}

function memberFromSource(source: TeamMembershipSource, fallbackDate: Date): TeamMember | null {
  if (source.status !== "active") return null;
  const userId = (source.user_email ?? source.user_subject ?? "").trim();
  if (!userId) return null;

  return {
    user_id: userId,
    role: source.relationship === "admin" ? "admin" : "member",
    added_at: new Date(source.first_seen_at ?? source.created_at ?? source.last_seen_at ?? fallbackDate),
    added_by: source.created_by ?? "identity-sync",
  };
}

function membersFromSources(sources: TeamMembershipSource[], fallbackDate: Date): TeamMember[] {
  const byUser = new Map<string, TeamMember>();
  for (const source of sources) {
    const member = memberFromSource(source, fallbackDate);
    if (!member) continue;

    const key = member.user_id.toLowerCase();
    const existing = byUser.get(key);
    if (!existing || existing.role === "member") {
      byUser.set(key, member);
    }
  }
  return Array.from(byUser.values());
}

export function TeamDetailsDialog({
  team,
  mode,
  open,
  onOpenChange,
  onTeamUpdated,
  onTeamMutated,
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

  // Spec 098 — Keycloak user typeahead for Add Member. We hit
  // /api/admin/users?search=<q> (server-side Keycloak search) once the
  // admin has typed at least 2 characters, debounced to 200ms so we
  // don't spam the realm. The dropdown is opt-in — pressing Enter or
  // clicking Add still POSTs the raw input verbatim (the backend
  // accepts an email and resolves the Keycloak subject itself), so
  // typing a full email of a not-yet-provisioned user still works.
  const [memberSearchResults, setMemberSearchResults] = useState<
    Array<{ id: string; email: string; firstName?: string; lastName?: string; username?: string }>
  >([]);
  const [memberSearchLoading, setMemberSearchLoading] = useState(false);
  const [memberSearchOpen, setMemberSearchOpen] = useState(false);
  const memberSearchAbortRef = useRef<AbortController | null>(null);

  // Removing member.
  //   `pendingRemoveMember` — user clicked the trash icon and is being shown
  //     the inline confirm row, but hasn't confirmed yet (no API call in
  //     flight). Replaces the previous window.confirm() blocking prompt,
  //     which broke the in-modal UX by hijacking the entire tab.
  //   `removingMember` — request is actually in flight; row shows a spinner
  //     and the trash button is disabled.
  const [pendingRemoveMember, setPendingRemoveMember] = useState<string | null>(
    null,
  );
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

  const [webexSpacesData, setWebexSpacesData] = useState<WebexSpacesPayload | null>(null);
  const [editedWebexSpaces, setEditedWebexSpaces] = useState<TeamWebexSpace[]>([]);
  const [webexSpacesLoading, setWebexSpacesLoading] = useState(false);
  const [webexSpacesSaving, setWebexSpacesSaving] = useState(false);
  const [webexSpacesNotice, setWebexSpacesNotice] = useState<string | null>(null);
  const [webexDiscovery, setWebexDiscovery] = useState<WebexDiscoveryPayload | null>(null);
  const [webexDiscoveryLoading, setWebexDiscoveryLoading] = useState(false);
  const [webexDiscoveryError, setWebexDiscoveryError] = useState<string | null>(null);
  const [webexDiscoverySearch, setWebexDiscoverySearch] = useState("");
  const [webexDiscoveryLoadingMore, setWebexDiscoveryLoadingMore] = useState(false);
  const [manualSpaceId, setManualSpaceId] = useState("");
  const [manualSpaceName, setManualSpaceName] = useState("");

  // Current team data (may be refreshed after mutations)
  const [currentTeam, setCurrentTeam] = useState<Team | null>(team);
  const [membershipSources, setMembershipSources] = useState<TeamMembershipSource[]>([]);
  // OpenFGA sync diagnostic — populated from the GET /api/admin/teams/[id]
  // response (top-level `openfga_sync` field). `canReconcile` controls
  // visibility of the Reconcile button; we only know that the request
  // succeeded, so we infer permission by attempting the POST and
  // surfacing 403 errors inline rather than hiding the button.
  const [openFgaSync, setOpenFgaSync] = useState<TeamMembershipSyncReport | null>(null);
  const [reconciling, setReconciling] = useState(false);
  const [reconcileError, setReconcileError] = useState<string | null>(null);
  const [reconcileNotice, setReconcileNotice] = useState<string | null>(null);
  const slackDiscoveryAutoLoadedTeamRef = useRef<string | null>(null);

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
      setMemberSearchResults([]);
      setMemberSearchLoading(false);
      setMemberSearchOpen(false);
      setPendingRemoveMember(null);
      setResourcesData(null);
      setResourcesNotice(null);
      setChannelsData(null);
      setEditedChannels([]);
      setChannelsNotice(null);
      setDiscovery(null);
      setDiscoveryError(null);
      setDiscoverySearch("");
      setDiscoveryMemberOnly(true);
      slackDiscoveryAutoLoadedTeamRef.current = null;
      setManualChannelId("");
      setManualChannelName("");
      setWebexSpacesData(null);
      setEditedWebexSpaces([]);
      setWebexSpacesNotice(null);
      setWebexDiscovery(null);
      setWebexDiscoveryError(null);
      setWebexDiscoverySearch("");
      setManualSpaceId("");
      setManualSpaceName("");
      setMembershipSources(team.membership_sources ?? []);
      setOpenFgaSync(null);
      setReconcileError(null);
      setReconcileNotice(null);
    }
  }, [open, team, mode]);

  // Fetch the OpenFGA sync status once per dialog open. The user picked
  // "on open" refresh (not "on every mutation") so we deliberately do
  // NOT re-fetch after add/remove member — the next dialog open will
  // pick up the new state.
  useEffect(() => {
    if (!open || !currentTeam?._id) return;
    let cancelled = false;
    fetch(`/api/admin/teams/${currentTeam._id}`)
      .then(async (res) => {
        const data = await res.json();
        if (!cancelled && data.success && data.data?.openfga_sync) {
          setOpenFgaSync(data.data.openfga_sync as TeamMembershipSyncReport);
        }
      })
      .catch((err: unknown) => {
        console.error("[TeamDetails] Failed to load openfga_sync:", err);
      });
    return () => {
      cancelled = true;
    };
  }, [open, currentTeam?._id]);

  // Debounced typeahead against the Keycloak realm. We require ≥2
  // characters to avoid sending broad regex scans on every keystroke.
  // Cancellation is best-effort via AbortController — Keycloak rarely
  // takes long enough for this to matter, but it keeps stale results
  // from clobbering newer ones when the admin types quickly.
  useEffect(() => {
    if (!open || activeMode !== "members") return;
    const query = newMemberEmail.trim();
    if (query.length < 2) {
      setMemberSearchResults([]);
      setMemberSearchLoading(false);
      return;
    }
    const handle = setTimeout(() => {
      memberSearchAbortRef.current?.abort();
      const ctrl = new AbortController();
      memberSearchAbortRef.current = ctrl;
      setMemberSearchLoading(true);
      const params = new URLSearchParams({ search: query, pageSize: "8" });
      fetch(`/api/admin/users?${params.toString()}`, { signal: ctrl.signal })
        .then(async (res) => {
          if (!res.ok) throw new Error(`User search failed: ${res.status}`);
          return res.json();
        })
        .then((payload) => {
          if (ctrl.signal.aborted) return;
          const users = Array.isArray(payload?.users) ? payload.users : [];
          setMemberSearchResults(
            users
              .filter((u: { email?: string }) => Boolean(u?.email))
              .map((u: { id: string; email: string; firstName?: string; lastName?: string; username?: string }) => ({
                id: String(u.id),
                email: String(u.email),
                firstName: u.firstName,
                lastName: u.lastName,
                username: u.username,
              }))
          );
        })
        .catch((err: unknown) => {
          if ((err as { name?: string })?.name === "AbortError") return;
          // Keep the previous results so the dropdown doesn't flicker;
          // search failures are logged but not surfaced inline so they
          // don't crowd the small Add-Member panel.
          console.warn("[TeamDetails] Member search failed:", err);
        })
        .finally(() => {
          if (!ctrl.signal.aborted) setMemberSearchLoading(false);
        });
    }, 200);
    return () => {
      clearTimeout(handle);
    };
  }, [open, activeMode, newMemberEmail]);

  useEffect(() => {
    if (!open || activeMode !== "members" || !currentTeam?._id) return;
    let cancelled = false;
    fetch(`/api/admin/identity-group-sync/teams/${currentTeam._id}/membership-sources`)
      .then(async (res) => {
        const data = await res.json();
        if (!data.success) {
          throw new Error(data.error || "Failed to load membership sources");
        }
        if (!cancelled) {
          setMembershipSources((data.data?.sources ?? []) as TeamMembershipSource[]);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load membership sources");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, activeMode, currentTeam?._id]);

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

  // Spec 098 US9 — load this team's channel assignments + bindable agents
  // when the Slack Channels tab opens. Mirrors the resources tab:
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

  useEffect(() => {
    if (!open || activeMode !== "webex" || !currentTeam) return;
    let cancelled = false;
    setWebexSpacesLoading(true);
    setError(null);
    setWebexSpacesNotice(null);
    fetch(`/api/admin/teams/${currentTeam._id}/webex-spaces`)
      .then(async (res) => {
        const data = await res.json();
        if (!data.success) {
          throw new Error(data.error || "Failed to load Webex spaces");
        }
        if (!cancelled) {
          const payload = data.data as WebexSpacesPayload;
          setWebexSpacesData(payload);
          setEditedWebexSpaces(payload.spaces.map((s) => ({ ...s })));
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load Webex spaces");
        }
      })
      .finally(() => {
        if (!cancelled) setWebexSpacesLoading(false);
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
        params.set("limit", String(TEAM_SLACK_DISCOVERY_PAGE_SIZE));
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

  useEffect(() => {
    if (!open || activeMode !== "channels" || !currentTeam?._id || discovery || discoveryLoading) {
      return;
    }
    if (slackDiscoveryAutoLoadedTeamRef.current === currentTeam._id) return;
    slackDiscoveryAutoLoadedTeamRef.current = currentTeam._id;
    loadDiscovery(false);
  }, [open, activeMode, currentTeam?._id, discovery, discoveryLoading, loadDiscovery]);

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
        },
      ];
    });
    setManualChannelId("");
    setManualChannelName("");
  };

  const handleRemoveChannel = (id: string) => {
    setEditedChannels((prev) => prev.filter((c) => c.slack_channel_id !== id));
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

  const fetchWebexDiscoveryPage = useCallback(
    async (opts: {
      q: string;
      cursor?: string | null;
      forceRefresh?: boolean;
      append: boolean;
    }) => {
      const { q, cursor, forceRefresh, append } = opts;
      if (append) setWebexDiscoveryLoadingMore(true);
      else setWebexDiscoveryLoading(true);
      setWebexDiscoveryError(null);
      try {
        const params = new URLSearchParams();
        if (q) params.set("q", q);
        params.set("limit", "200");
        if (cursor) params.set("cursor", cursor);
        if (forceRefresh) params.set("refresh", "1");
        const res = await fetch(`/api/admin/webex/available-spaces?${params.toString()}`);
        const data = await res.json();
        if (!data.success) {
          throw new Error(data.error || `Failed (${res.status})`);
        }
        const payload = data.data as WebexDiscoveryPayload;
        setWebexDiscovery((prev) =>
          append && prev
            ? {
                ...payload,
                spaces: [...prev.spaces, ...payload.spaces],
              }
            : payload
        );
      } catch (err: unknown) {
        setWebexDiscoveryError(
          err instanceof Error ? err.message : "Webex space discovery failed"
        );
      } finally {
        if (append) setWebexDiscoveryLoadingMore(false);
        else setWebexDiscoveryLoading(false);
      }
    },
    []
  );

  const loadWebexDiscovery = useCallback(
    (forceRefresh = false) =>
      fetchWebexDiscoveryPage({
        q: webexDiscoverySearch.trim(),
        forceRefresh,
        append: false,
      }),
    [fetchWebexDiscoveryPage, webexDiscoverySearch]
  );

  const loadMoreWebexDiscovery = useCallback(() => {
    if (!webexDiscovery?.next_cursor) return;
    void fetchWebexDiscoveryPage({
      q: webexDiscovery.query.q,
      cursor: webexDiscovery.next_cursor,
      append: true,
    });
  }, [webexDiscovery, fetchWebexDiscoveryPage]);

  useEffect(() => {
    if (activeMode !== "webex") return;
    if (!webexDiscovery) return;
    const handle = setTimeout(() => {
      void fetchWebexDiscoveryPage({
        q: webexDiscoverySearch.trim(),
        append: false,
      });
    }, 250);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [webexDiscoverySearch, activeMode, fetchWebexDiscoveryPage]);

  const handleAddSpaceFromDiscovery = (space: DiscoveredWebexSpace) => {
    setEditedWebexSpaces((prev) => {
      if (prev.some((p) => p.webex_space_id === space.id)) return prev;
      return [
        ...prev,
        {
          webex_space_id: space.id,
          space_name: space.name,
        },
      ];
    });
  };

  const handleAddSpaceManual = () => {
    const id = manualSpaceId.trim();
    const name = manualSpaceName.trim() || id;
    if (!id) return;
    setEditedWebexSpaces((prev) => {
      if (prev.some((p) => p.webex_space_id === id)) return prev;
      return [
        ...prev,
        {
          webex_space_id: id,
          space_name: name,
        },
      ];
    });
    setManualSpaceId("");
    setManualSpaceName("");
  };

  const handleRemoveWebexSpace = (id: string) => {
    setEditedWebexSpaces((prev) => prev.filter((s) => s.webex_space_id !== id));
  };

  const handleSaveWebexSpaces = async () => {
    if (!currentTeam) return;
    setWebexSpacesSaving(true);
    setError(null);
    setWebexSpacesNotice(null);
    try {
      const res = await fetch(`/api/admin/teams/${currentTeam._id}/webex-spaces`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spaces: editedWebexSpaces }),
      });
      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || "Failed to save Webex spaces");
      }
      const removed: string[] = data.data?.removed_space_ids ?? [];
      setWebexSpacesNotice(
        removed.length > 0
          ? `Saved. ${editedWebexSpaces.length} space(s) active; ${removed.length} removed.`
          : `Saved. ${editedWebexSpaces.length} space(s) assigned.`
      );
      setWebexSpacesData((prev) =>
        prev ? { ...prev, spaces: editedWebexSpaces.map((s) => ({ ...s })) } : prev
      );
      onTeamUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save Webex spaces");
    } finally {
      setWebexSpacesSaving(false);
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

  // Re-fetch the canonical team document plus its membership sources and
  // OpenFGA sync diagnostic. We do this after Add/Remove member (otherwise
  // the badges that read from `membership_sources` and `openfga_sync`
  // would stay stale until the dialog is reopened) and from the explicit
  // "Refresh" button in the dialog header.
  const [refreshingTeam, setRefreshingTeam] = useState(false);
  const refreshTeam = useCallback(async () => {
    if (!currentTeam) return;
    setRefreshingTeam(true);
    try {
      const res = await fetch(`/api/admin/teams/${currentTeam._id}`);
      if (!res.ok) {
        throw new Error(`Failed to refresh team (HTTP ${res.status})`);
      }
      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || "Failed to refresh team");
      }
      const payload = data.data ?? {};
      if (payload.team) {
        setCurrentTeam(payload.team);
      }
      setMembershipSources(
        Array.isArray(payload.membership_sources)
          ? (payload.membership_sources as TeamMembershipSource[])
          : []
      );
      setOpenFgaSync(
        payload.openfga_sync
          ? (payload.openfga_sync as TeamMembershipSyncReport)
          : null
      );
    } catch (err) {
      console.error("[TeamDetails] Failed to refresh team:", err);
      setError(err instanceof Error ? err.message : "Failed to refresh team");
    } finally {
      setRefreshingTeam(false);
    }
  }, [currentTeam]);

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

      const updatedTeam = data.data.team as Team;
      setCurrentTeam(updatedTeam);
      setIsEditing(false);
      if (onTeamMutated) {
        onTeamMutated(updatedTeam);
      } else {
        onTeamUpdated();
      }
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

      const updatedTeam = data.data.team as Team;
      setCurrentTeam(updatedTeam);
      setNewMemberEmail("");
      setNewMemberRole("member");
      setMemberSearchResults([]);
      setMemberSearchOpen(false);
      // Re-fetch in the background so badges (membership sources,
      // OpenFGA sync status) reflect the post-write reality. The
      // primary list update above already shows the new member; this
      // is a follow-up that hydrates secondary metadata.
      void refreshTeam();
      // Prefer the lightweight callback so the parent admin page can
      // patch its `teams[]` state in place — no full dashboard reload,
      // no setLoading(true), no flicker. Fall back to onTeamUpdated()
      // only if the parent hasn't opted in.
      if (onTeamMutated) {
        onTeamMutated(updatedTeam);
      } else {
        onTeamUpdated();
      }
    } catch (err: any) {
      setError(err.message || "Failed to add member");
    } finally {
      setAddingMember(false);
    }
  };

  const handlePickMemberFromSearch = (user: {
    email: string;
    firstName?: string;
    lastName?: string;
  }) => {
    setNewMemberEmail(user.email);
    setMemberSearchResults([]);
    setMemberSearchOpen(false);
  };

  const handleRemoveMember = async (email: string) => {
    if (!currentTeam) return;

    setRemovingMember(email);
    setPendingRemoveMember(null);
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

      const updatedTeam = data.data.team as Team;
      setCurrentTeam(updatedTeam);
      void refreshTeam();
      if (onTeamMutated) {
        onTeamMutated(updatedTeam);
      } else {
        onTeamUpdated();
      }
    } catch (err: any) {
      setError(err.message || "Failed to remove member");
    } finally {
      setRemovingMember(null);
    }
  };

  const handleReconcileOpenFga = async () => {
    if (!currentTeam) return;
    setReconciling(true);
    setReconcileError(null);
    setReconcileNotice(null);
    try {
      const res = await fetch(
        `/api/admin/teams/${currentTeam._id}/openfga/reconcile`,
        { method: "POST" }
      );
      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || "Failed to reconcile OpenFGA");
      }
      // Server returns the freshly-computed report so we don't have to
      // make a second round-trip.
      if (data.data?.openfga_sync) {
        setOpenFgaSync(data.data.openfga_sync as TeamMembershipSyncReport);
      }
      const summary = data.data?.summary as
        | { tuple_writes?: number; resolved_subjects?: number; unresolved_emails?: string[] }
        | undefined;
      if (summary) {
        const parts: string[] = [];
        if (summary.resolved_subjects && summary.resolved_subjects > 0) {
          parts.push(`resolved ${summary.resolved_subjects} new Keycloak subject(s)`);
        }
        if (summary.tuple_writes && summary.tuple_writes > 0) {
          parts.push(`wrote ${summary.tuple_writes} OpenFGA tuple(s)`);
        }
        if (summary.unresolved_emails && summary.unresolved_emails.length > 0) {
          parts.push(
            `${summary.unresolved_emails.length} email(s) still missing in Keycloak`
          );
        }
        setReconcileNotice(
          parts.length === 0
            ? "Already in sync — no changes needed."
            : `Reconcile complete: ${parts.join(", ")}.`
        );
      }
    } catch (err: unknown) {
      setReconcileError(
        err instanceof Error ? err.message : "Failed to reconcile OpenFGA"
      );
    } finally {
      setReconciling(false);
    }
  };

  if (!currentTeam) return null;

  const canonicalMembers = membersFromSources(
    membershipSources,
    new Date(currentTeam.created_at),
  );
  const members = canonicalMembers.length > 0 ? canonicalMembers : currentTeam.members || [];
  const sourcesByMember = membershipSources.reduce<Record<string, TeamMembershipSource[]>>(
    (acc, source) => {
      const key = (source.user_email ?? source.user_subject ?? "").toLowerCase();
      if (!key) return acc;
      acc[key] = acc[key] ?? [];
      acc[key].push(source);
      return acc;
    },
    {}
  );
  // Pick the "worst" sync entry per member email so the Members tab can
  // show a single badge instead of one per identity source. Ordering of
  // severity: drifted > unknown > pending > synced. If no entry exists
  // for the user (no source row yet), we render no badge — silence is
  // accurate because there's literally nothing to sync.
  const syncByMember = (openFgaSync?.entries ?? []).reduce<
    Record<string, TeamMembershipSyncEntry>
  >((acc, entry) => {
    const key = (entry.user_email ?? "").toLowerCase();
    if (!key) return acc;
    const existing = acc[key];
    if (!existing || severityRank(entry.status) > severityRank(existing.status)) {
      acc[key] = entry;
    }
    return acc;
  }, {});
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
        <div className="flex items-center gap-1 border-b pb-2">
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
            variant={activeMode === "webex" ? "default" : "ghost"}
            size="sm"
            onClick={() => setActiveMode("webex")}
            className="text-xs"
          >
            Webex Spaces
          </Button>
          {/* Refresh re-fetches the team document, membership sources,
              and OpenFGA sync diagnostic for this dialog. Useful when an
              admin suspects external state (e.g. an OIDC sync run) has
              changed the team since they opened the modal. */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void refreshTeam()}
            disabled={refreshingTeam}
            className="ml-auto h-7 w-7 p-0"
            title="Refresh this team"
            aria-label="Refresh this team"
          >
            {refreshingTeam ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
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
                  <SaveButton
                    onSave={handleSaveEdit}
                    saving={loading}
                    dirty={
                      editName.trim() !== currentTeam.name ||
                      editDescription !== (currentTeam.description || "")
                    }
                    disabled={!editName.trim()}
                    ariaLabel="Save team details"
                  />
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

                {/* OpenFGA sync status banner. Surfaces whether the tuple
                    state on `team:<slug>` matches what Mongo expects. The
                    four-state model (synced / drifted / pending / unknown)
                    is defined in lib/rbac/team-openfga-sync-status.ts. */}
                {openFgaSync && (
                  <div
                    className={
                      "rounded-lg border p-3 space-y-2 " +
                      (openFgaSync.summary.drifted > 0
                        ? "border-destructive/40 bg-destructive/5"
                        : openFgaSync.summary.unknown > 0
                          ? "border-amber-500/40 bg-amber-500/5"
                          : "border-emerald-500/30 bg-emerald-500/5")
                    }
                  >
                    <div className="flex items-start gap-2">
                      {openFgaSync.summary.drifted > 0 ? (
                        <ShieldAlert className="h-4 w-4 mt-0.5 text-destructive" />
                      ) : openFgaSync.summary.unknown > 0 ? (
                        <ShieldQuestion className="h-4 w-4 mt-0.5 text-amber-600 dark:text-amber-400" />
                      ) : (
                        <ShieldCheck className="h-4 w-4 mt-0.5 text-emerald-600 dark:text-emerald-400" />
                      )}
                      <div className="flex-1 text-sm">
                        <p className="font-medium">
                          OpenFGA authorization sync
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {openFgaSync.summary.total === 0 ? (
                            "No active membership sources tracked for this team."
                          ) : (
                            <>
                              {openFgaSync.summary.synced}/
                              {openFgaSync.summary.total} member(s) synced
                              {openFgaSync.summary.drifted > 0
                                ? `, ${openFgaSync.summary.drifted} drifted`
                                : ""}
                              {openFgaSync.summary.pending > 0
                                ? `, ${openFgaSync.summary.pending} pending Keycloak link`
                                : ""}
                              {openFgaSync.summary.unknown > 0
                                ? `, ${openFgaSync.summary.unknown} unknown`
                                : ""}
                              .
                            </>
                          )}
                        </p>
                        {!openFgaSync.summary.openfga_available && (
                          <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
                            OpenFGA was unreachable. Tuple state cannot be
                            verified right now.
                          </p>
                        )}
                      </div>
                      {/* Reconcile button. We show it whenever the report
                          is loaded — the server gates the action on
                          team-admin or platform-admin and will return 403
                          if the caller is not permitted. We surface that
                          inline rather than hiding the button (cheaper than
                          a separate "can-i-reconcile" probe). */}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleReconcileOpenFga}
                        disabled={reconciling}
                        className="gap-1 shrink-0"
                      >
                        {reconciling ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="h-3.5 w-3.5" />
                        )}
                        Reconcile
                      </Button>
                    </div>
                    {reconcileError && (
                      <p className="text-xs text-destructive">
                        {reconcileError}
                      </p>
                    )}
                    {reconcileNotice && (
                      <p className="text-xs text-emerald-700 dark:text-emerald-400">
                        {reconcileNotice}
                      </p>
                    )}
                  </div>
                )}
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
            {/* Add Member Form — Keycloak typeahead. The dropdown is purely
                a discovery aid: pressing Enter or clicking Add still POSTs
                the literal text in the input as `user_id`, so admins can
                provision a not-yet-Keycloak user by typing their full
                email. */}
            <form
              onSubmit={handleAddMember}
              className="flex gap-2 relative"
              autoComplete="off"
            >
              <div className="flex-1 relative">
                <Search className="h-3.5 w-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <Input
                  placeholder="Search by name or email..."
                  value={newMemberEmail}
                  onChange={(e) => {
                    setNewMemberEmail(e.target.value);
                    setMemberSearchOpen(true);
                  }}
                  onFocus={() => setMemberSearchOpen(true)}
                  onBlur={() => {
                    // Delay so onMouseDown on a result still fires.
                    setTimeout(() => setMemberSearchOpen(false), 120);
                  }}
                  disabled={addingMember}
                  className="pl-8"
                  // We intentionally do NOT use type="email" — admins can
                  // search by name/username and pick the row, which then
                  // fills in the email.
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  data-1p-ignore="true"
                  data-lpignore="true"
                  data-form-type="other"
                />
                {memberSearchOpen && newMemberEmail.trim().length >= 2 && (
                  <div
                    className="absolute left-0 right-0 top-full mt-1 z-50 rounded-md border bg-popover shadow-md max-h-64 overflow-auto"
                    role="listbox"
                    aria-label="Matching users"
                  >
                    {memberSearchLoading && memberSearchResults.length === 0 ? (
                      <div className="px-3 py-2 text-xs text-muted-foreground flex items-center gap-2">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Searching users…
                      </div>
                    ) : memberSearchResults.length === 0 ? (
                      <div className="px-3 py-2 text-xs text-muted-foreground">
                        No matching users in Keycloak. Press Enter to add
                        <span className="font-mono"> {newMemberEmail.trim()}</span> directly.
                      </div>
                    ) : (
                      memberSearchResults.map((u) => {
                        const fullName = [u.firstName, u.lastName]
                          .filter(Boolean)
                          .join(" ")
                          .trim();
                        const alreadyMember = members.some(
                          (m) => m.user_id.toLowerCase() === u.email.toLowerCase()
                        );
                        return (
                          <button
                            key={u.id}
                            type="button"
                            role="option"
                            aria-selected={false}
                            disabled={alreadyMember}
                            // onMouseDown rather than onClick so the
                            // selection fires before the input's onBlur
                            // closes the popup.
                            onMouseDown={(e) => {
                              e.preventDefault();
                              if (alreadyMember) return;
                              handlePickMemberFromSearch(u);
                            }}
                            className="w-full text-left px-3 py-2 hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 border-b last:border-b-0"
                          >
                            <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-medium shrink-0">
                              {(fullName || u.email).charAt(0).toUpperCase()}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="text-sm truncate">
                                {fullName || u.username || u.email}
                              </div>
                              <div className="text-xs text-muted-foreground truncate">
                                {u.email}
                              </div>
                            </div>
                            {alreadyMember && (
                              <Badge
                                variant="secondary"
                                className="text-[10px] shrink-0"
                              >
                                Already a member
                              </Badge>
                            )}
                          </button>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
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
                  sortedMembers.map((member) => {
                    // Only surface currently-active provenance to operators. Non-active
                    // rows (status="removed") are an audit-trail artefact: when a user is
                    // removed and later re-added they otherwise show up next to the active
                    // badge as a confusing "Manual: Removed" pill alongside "Manual".
                    // See team-membership-source-store.markTeamMembershipSourceRemoved.
                    const memberSources = (sourcesByMember[member.user_id.toLowerCase()] ?? [])
                      .filter((source) => source.status === "active");
                    const syncEntry = syncByMember[member.user_id.toLowerCase()];
                    const syncBadge = syncEntry
                      ? syncBadgeAppearance(syncEntry.status)
                      : null;
                    const isPendingRemove =
                      pendingRemoveMember === member.user_id;
                    return (
                      <div
                        key={member.user_id}
                        className={`flex items-center justify-between py-2 px-3 rounded-md group ${
                          isPendingRemove
                            ? "bg-destructive/5 ring-1 ring-destructive/20"
                            : "hover:bg-muted/50"
                        }`}
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
                            {(memberSources.length > 0 || syncBadge) && (
                              <div className="mt-1 flex flex-wrap gap-1">
                                {memberSources.map((source) => (
                                  <Badge
                                    key={`${source.source_type}-${source.provider_id ?? "local"}-${source.external_group_id ?? "manual"}-${source.relationship}-${source.status}`}
                                    variant={getSourceBadgeVariant(source)}
                                    className="text-[10px] capitalize"
                                  >
                                    {getSourceLabel(source)}
                                    {source.status !== "active" ? `: ${source.status}` : ""}
                                  </Badge>
                                ))}
                                {syncBadge && (
                                  <Badge
                                    variant={syncBadge.variant}
                                    className="text-[10px] gap-1"
                                    title={syncEntry?.reason ?? ""}
                                  >
                                    {syncBadge.icon}
                                    {syncBadge.label}
                                  </Badge>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Badge variant={getRoleBadgeVariant(member.role)} className="gap-1 text-xs">
                            {getRoleIcon(member.role)}
                            {member.role}
                          </Badge>
                          {member.role !== "owner" && (
                            pendingRemoveMember === member.user_id &&
                            removingMember !== member.user_id ? (
                              // Inline confirm row — replaces the previous
                              // window.confirm() blocking prompt. Stays on
                              // the same row so focus, scroll position, and
                              // the parent modal are all preserved.
                              <div
                                className="flex items-center gap-1"
                                role="group"
                                aria-label={`Confirm removal of ${member.user_id}`}
                                onKeyDown={(e) => {
                                  if (e.key === "Escape") {
                                    e.stopPropagation();
                                    setPendingRemoveMember(null);
                                  }
                                }}
                              >
                                <span
                                  className="text-xs text-muted-foreground mr-1"
                                  aria-live="polite"
                                >
                                  Remove?
                                </span>
                                <Button
                                  variant="destructive"
                                  size="sm"
                                  className="h-7 px-2 text-xs"
                                  onClick={() =>
                                    handleRemoveMember(member.user_id)
                                  }
                                  autoFocus
                                  aria-label={`Confirm remove ${member.user_id}`}
                                >
                                  <Check className="h-3.5 w-3.5 mr-1" />
                                  Remove
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 w-7 p-0 text-muted-foreground"
                                  onClick={() => setPendingRemoveMember(null)}
                                  aria-label="Cancel removal"
                                >
                                  <X className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            ) : (
                              <Button
                                variant="ghost"
                                size="sm"
                                className={`h-7 w-7 p-0 text-muted-foreground hover:text-destructive ${
                                  removingMember === member.user_id
                                    ? "opacity-100"
                                    : "opacity-0 group-hover:opacity-100"
                                }`}
                                onClick={() =>
                                  setPendingRemoveMember(member.user_id)
                                }
                                disabled={removingMember === member.user_id}
                                aria-label={`Remove ${member.user_id}`}
                              >
                                {removingMember === member.user_id ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <Trash2 className="h-3.5 w-3.5" />
                                )}
                              </Button>
                            )
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </ScrollArea>
          </div>
        )}

        {/* Resources Mode (Spec 104 — team-scoped RBAC) */}
        {activeMode === "resources" && (
          <div className="space-y-4 py-2 flex-1 min-h-0 flex flex-col">
            <p className="text-xs text-muted-foreground">
              Grant this team access to agents and tools. Saving writes OpenFGA
              relationships for this team; Keycloak no longer mirrors
              per-resource realm roles.
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
              <SaveButton
                onSave={handleSaveResources}
                saving={resourcesSaving}
                dirty
                hideDirtyBadge
                disabled={resourcesLoading || !resourcesData}
                ariaLabel="Save resources"
              />
            </div>
          </div>
        )}

        {/* Slack Channels Mode (Spec 098 US9 — channel ↔ team binding) */}
        {activeMode === "channels" && (
          <div className="space-y-4 py-2 flex-1 min-h-0 flex flex-col">
            <p className="text-xs text-muted-foreground">
              Bind Slack channels to this team. The Slack bot uses{" "}
              <code className="font-mono">channel_team_mappings</code> to
              decide which team&apos;s RBAC applies to in-channel requests.
              Agent route access is granted from Integrations → Slack.
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
                manualChannelId={manualChannelId}
                manualChannelName={manualChannelName}
                onManualIdChange={setManualChannelId}
                onManualNameChange={setManualChannelName}
              />
            )}

            <div className="flex justify-end gap-2 pt-2 border-t">
              <SaveButton
                onSave={handleSaveChannels}
                saving={channelsSaving}
                dirty
                hideDirtyBadge
                disabled={channelsLoading || !channelsData}
                ariaLabel="Save channels"
              />
            </div>
          </div>
        )}

        {activeMode === "webex" && (
          <div className="space-y-4 py-2 flex-1 min-h-0 flex flex-col">
            <p className="text-xs text-muted-foreground">
              Bind Webex spaces to this team. The Webex bot uses{" "}
              <code className="font-mono">webex_space_team_mappings</code> to decide which
              team&apos;s RBAC applies to in-space requests. Agent and resource access is
              granted from Security &amp; Policy → OpenFGA ReBAC → Webex Spaces.
            </p>

            {webexSpacesNotice && (
              <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 p-3">
                <p className="text-sm text-emerald-700 dark:text-emerald-400">
                  {webexSpacesNotice}
                </p>
              </div>
            )}

            {webexSpacesLoading || !webexSpacesData ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <WebexSpacesPanel
                assigned={editedWebexSpaces}
                discovery={webexDiscovery}
                discoveryLoading={webexDiscoveryLoading}
                discoveryLoadingMore={webexDiscoveryLoadingMore}
                discoveryError={webexDiscoveryError}
                discoverySearch={webexDiscoverySearch}
                onSearchChange={setWebexDiscoverySearch}
                onLoadDiscovery={loadWebexDiscovery}
                onLoadMoreDiscovery={loadMoreWebexDiscovery}
                onAddFromDiscovery={handleAddSpaceFromDiscovery}
                onAddManual={handleAddSpaceManual}
                onRemove={handleRemoveWebexSpace}
                manualSpaceId={manualSpaceId}
                manualSpaceName={manualSpaceName}
                onManualIdChange={setManualSpaceId}
                onManualNameChange={setManualSpaceName}
              />
            )}

            <div className="flex justify-end gap-2 pt-2 border-t">
              <SaveButton
                onSave={handleSaveWebexSpaces}
                saving={webexSpacesSaving}
                dirty
                hideDirtyBadge
                disabled={webexSpacesLoading || !webexSpacesData}
                ariaLabel="Save spaces"
              />
            </div>
          </div>
        )}

        {/* Knowledge Bases Mode (Spec 102/103 — RAG team-scoped access) */}
        {activeMode === "kbs" && (
          <div className="py-2 flex-1 min-h-0 overflow-y-auto space-y-4">
            {/* Explicit "data source author" capability (spec 2026-06-03) —
                gates whether members may create brand-new data sources, kept
                separate from the per-KB assignment below. */}
            <IngestCapabilityToggle
              teamId={currentTeam._id}
              teamName={currentTeam.name}
            />

            {/* Explicit "search" capability (spec
                2026-06-03-explicit-search-capability) — gates whether members
                may use Search (query + invoke search tools), separate from
                per-tool sharing and per-KB read grants below. */}
            <SearchCapabilityToggle
              teamId={currentTeam._id}
              teamName={currentTeam.name}
            />
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
 * "Use" (base `user agent:<id>`) and "Manage" (base `manager agent:<id>`).
 * Manage implies Use in our authz model, so ticking Manage auto-ticks Use; the
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
                      title="OpenFGA user agent:<id> — chat with this agent"
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
                      title="OpenFGA manager agent:<id> — edit/configure this agent"
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
 * single "All tools" wildcard checkbox at the top. Wildcard does not visually
 * un-tick the per-server boxes — they stay as a record of intent — but the
 * backend writes a single OpenFGA wildcard relationship.
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
              Grant this team permission to invoke any MCP tool. Use sparingly.
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
 * Spec 098 US9 — Slack channels picker.
 *
 * Two-column layout:
 *   Left  — channels currently assigned to the team (editable: change bound
 *           agent, remove)
 *   Right — bot-member channel discovery (live Slack `users.conversations`) +
 *           manual channel-ID entry as fallback when SLACK_BOT_TOKEN is unset
 *           or the channel isn't visible to the bot yet
 *
 * The bound-agent dropdown is intentionally limited to the team's
 * `resources.agents` so admins can't accidentally bind a channel to an
 * agent the team doesn't otherwise have access to (the backend enforces
 * this too).
 */
function SlackChannelsPanel({
  assigned,
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
  manualChannelId,
  manualChannelName,
  onManualIdChange,
  onManualNameChange,
}: {
  assigned: TeamSlackChannel[];
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
  const totalBotVisibleChannels = discovery?.total_matches ?? 0;
  const shownBotVisibleChannels = discoveryChannels.length;

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
              Refresh bot channels
            </Button>
          </div>

          <div className="relative">
            <Search className="h-3 w-3 text-muted-foreground absolute left-2 top-1/2 -translate-y-1/2" />
            <Input
              value={discoverySearch}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search bot-member channels..."
              className="h-7 text-xs pl-6"
            />
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            {discovery ? (
              <span>
                {totalBotVisibleChannels} bot-member channels found. Showing {shownBotVisibleChannels}.
              </span>
            ) : (
              <span>Loading bot-member channels...</span>
            )}
            <label className="flex items-center gap-1.5 cursor-pointer select-none">
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
          </div>
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
              Loading channels the bot can see...
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

function WebexSpacesPanel({
  assigned,
  discovery,
  discoveryLoading,
  discoveryLoadingMore,
  discoveryError,
  discoverySearch,
  onSearchChange,
  onLoadDiscovery,
  onLoadMoreDiscovery,
  onAddFromDiscovery,
  onAddManual,
  onRemove,
  manualSpaceId,
  manualSpaceName,
  onManualIdChange,
  onManualNameChange,
}: {
  assigned: TeamWebexSpace[];
  discovery: WebexDiscoveryPayload | null;
  discoveryLoading: boolean;
  discoveryLoadingMore: boolean;
  discoveryError: string | null;
  discoverySearch: string;
  onSearchChange: (v: string) => void;
  onLoadDiscovery: (forceRefresh?: boolean) => void;
  onLoadMoreDiscovery: () => void;
  onAddFromDiscovery: (space: DiscoveredWebexSpace) => void;
  onAddManual: () => void;
  onRemove: (id: string) => void;
  manualSpaceId: string;
  manualSpaceName: string;
  onManualIdChange: (v: string) => void;
  onManualNameChange: (v: string) => void;
}) {
  const assignedIds = new Set(assigned.map((s) => s.webex_space_id));
  const discoverySpaces = discovery?.spaces ?? [];
  const trimmedSearch = discoverySearch.trim();

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 flex-1 min-h-0">
      <div className="rounded-md border flex flex-col min-h-0">
        <div className="px-3 py-2 border-b bg-muted/30">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Assigned spaces ({assigned.length})
          </p>
        </div>
        <ScrollArea className="flex-1 p-2" style={{ maxHeight: "320px" }}>
          {assigned.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              No spaces assigned. Pick from the right →
            </p>
          ) : (
            <ul className="space-y-2">
              {assigned.map((space) => (
                <li
                  key={space.webex_space_id}
                  className="rounded border p-2 space-y-2 bg-background"
                >
                  <div className="flex items-start gap-2">
                    <MessageSquare className="h-3.5 w-3.5 mt-1 text-muted-foreground shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">{space.space_name}</div>
                      <div className="text-[11px] font-mono text-muted-foreground truncate">
                        {space.webex_space_id}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive shrink-0"
                      onClick={() => onRemove(space.webex_space_id)}
                      title="Remove from team"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
      </div>

      <div className="rounded-md border flex flex-col min-h-0">
        <div className="px-3 py-2 border-b bg-muted/30 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Available spaces
              {discovery && (
                <span className="ml-1 normal-case font-normal">
                  ({discovery.spaces.length}
                  {discovery.has_more ? ` of ${discovery.total_matches}` : ""})
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
                  ? "Re-fetch space list from Webex (invalidates cache)"
                  : "Discover spaces from Webex"
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
          {discovery && (
            <div className="relative">
              <Search className="h-3 w-3 text-muted-foreground absolute left-2 top-1/2 -translate-y-1/2" />
              <Input
                value={discoverySearch}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder="Search by title…"
                className="h-7 text-xs pl-6"
              />
            </div>
          )}
        </div>

        {discoveryError && (
          <div className="px-3 py-2 border-b bg-amber-500/5">
            <p className="text-[11px] text-amber-700 dark:text-amber-400">
              Discovery failed: {discoveryError}. You can still add spaces manually below.
            </p>
          </div>
        )}

        <ScrollArea className="flex-1 p-2" style={{ maxHeight: "260px" }}>
          {!discovery && !discoveryLoading ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              Click <strong>Discover</strong> to list Webex spaces the bot can see.
            </p>
          ) : discovery && discoverySpaces.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              {trimmedSearch
                ? `No spaces match "${trimmedSearch}".`
                : "No Webex spaces available."}
            </p>
          ) : (
            <ul className="space-y-1">
              {discoverySpaces.map((space) => {
                const alreadyAssigned = assignedIds.has(space.id);
                return (
                  <li
                    key={space.id}
                    className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/50"
                  >
                    {space.is_locked ? (
                      <Lock className="h-3 w-3 text-muted-foreground shrink-0" />
                    ) : (
                      <MessageSquare className="h-3 w-3 text-muted-foreground shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="text-sm truncate">{space.name}</div>
                      <div className="text-[11px] text-muted-foreground font-mono truncate">
                        {space.id}
                      </div>
                    </div>
                    {alreadyAssigned ? (
                      <Badge variant="secondary" className="text-[10px] h-5 px-1.5 shrink-0">
                        Assigned
                      </Badge>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 w-6 p-0 shrink-0"
                        onClick={() => onAddFromDiscovery(space)}
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
                    {discoveryLoadingMore ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                    Load more ({discovery.total_matches - discoverySpaces.length} remaining)
                  </Button>
                </li>
              )}
            </ul>
          )}
        </ScrollArea>

        <div className="px-3 py-2 border-t bg-muted/20 space-y-1">
          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Or add by space ID
          </Label>
          <div className="flex gap-1">
            <Input
              value={manualSpaceId}
              onChange={(e) => onManualIdChange(e.target.value)}
              placeholder="Y2lzY29zcGFyazov..."
              className="h-7 text-xs font-mono flex-1 min-w-0"
            />
            <Input
              value={manualSpaceName}
              onChange={(e) => onManualNameChange(e.target.value)}
              placeholder="Space title"
              className="h-7 text-xs flex-1 min-w-0"
            />
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 shrink-0"
              onClick={onAddManual}
              disabled={!manualSpaceId.trim()}
            >
              <Plus className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
