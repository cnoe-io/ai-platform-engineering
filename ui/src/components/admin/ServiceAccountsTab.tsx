"use client";

// assisted-by Claude:claude-opus-4-8
//
// Service Accounts admin tab (spec 2026-06-05-service-accounts, US1).
//
// Self-service for ANY team member (gated on team membership, not isAdmin —
// see research.md R-7). Lets a member create a service account owned by one of
// their teams, scoped only to agents/tools they themselves hold, and reveals
// the credential EXACTLY ONCE (FR-005 — never re-fetchable).

import React, { useCallback, useEffect, useState } from "react";
import {
  Bot,
  KeyRound,
  Link2,
  Loader2,
  Plus,
  RefreshCw,
  Settings,
  ShieldCheck,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MultiSelect } from "@/components/ui/multi-select";
import { TeamPicker, type TeamPickerOption } from "@/components/ui/team-picker";
import { CopyButton } from "@/components/ui/copy-button";
import { cn } from "@/lib/utils";
import {
  PROVIDER_DISPLAY_LIST,
  getProviderDisplayName,
} from "@/lib/credentials/provider-display-names";

// ─────────────────────────────────────────────────────────────────────────────
// Types (mirror the BFF contract; never include secret material on list/detail)
// ─────────────────────────────────────────────────────────────────────────────

interface ServiceAccountListItem {
  id: string;
  name: string;
  description?: string;
  owning_team_id: string;
  created_by: string;
  created_at: string;
  status: "active" | "revoked";
  protected?: boolean;
  scope_counts: { agents: number; tools: number };
}

interface GrantableItem {
  ref: string;
  name: string;
}

interface GrantableData {
  agents: GrantableItem[];
  tools: GrantableItem[];
}

interface CreatedCredential {
  client_id: string;
  client_secret: string;
  token_url: string;
}

interface ScopeRef {
  type: "agent" | "tool";
  ref: string;
}

interface ServiceAccountDetail {
  id: string;
  name: string;
  description?: string;
  owning_team_id: string;
  created_by: string;
  created_at: string;
  status: "active" | "revoked";
  protected?: boolean;
  scopes: ScopeRef[];
}

interface MyTeam {
  _id: string; // Mongo ObjectId — NOT the OpenFGA subject; do not use for grants.
  slug: string; // the canonical `team:<slug>` OpenFGA subject — use this as owning_team_id (#48).
  name: string;
}

// ─── SA credential types (mirrors GET /api/admin/service-accounts/[id]/credentials) ───

interface ServiceAccountCredential {
  id: string;
  provider: string;
  status: string;
  connectedAt?: string;
  requestedScopes?: string[];
  connectorId?: string;
}

// Use the shared provider-display-names module (ui/src/lib/credentials/provider-display-names.ts)
// as the single source of truth for the 5 built-in providers and their display names.
// That module is plain-data with no browser or next/server imports, so it is safe
// for "use client" components.
const BUILT_IN_PROVIDERS = PROVIDER_DISPLAY_LIST;

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function ServiceAccountsTab() {
  const [items, setItems] = useState<ServiceAccountListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [credential, setCredential] = useState<CreatedCredential | null>(null);
  const [createdName, setCreatedName] = useState<string>("");
  const [manageId, setManageId] = useState<string | null>(null);

  const loadList = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const res = await fetch("/api/admin/service-accounts");
      const body = await res.json();
      if (!res.ok || !body.success) {
        throw new Error(body.error || "Failed to load service accounts");
      }
      setItems(body.data.items ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load service accounts");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const handleCreated = useCallback(
    (cred: CreatedCredential, name: string) => {
      setCreateOpen(false);
      setCredential(cred);
      setCreatedName(name);
      void loadList(true);
    },
    [loadList],
  );

  // Rotate (from the manage dialog) reuses the same see-once reveal.
  const handleRotated = useCallback(
    (cred: CreatedCredential, name: string) => {
      setCredential(cred);
      setCreatedName(name);
    },
    [],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Service Accounts</h2>
          <p className="text-sm text-muted-foreground">
            Machine identities owned by your teams. Each can only use the agents and tools
            its creator holds. The credential is shown once at creation.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            className="gap-2"
            onClick={() => loadList(true)}
            disabled={refreshing}
          >
            {refreshing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Refresh
          </Button>
          <Button className="gap-2" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            Create Service Account
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading service accounts...
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-dashed py-12 text-center">
          <Bot className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
          <h3 className="mb-1 text-lg font-semibold">No service accounts yet</h3>
          <p className="mb-4 text-muted-foreground">
            Create one to give an external integration scoped, auditable access.
          </p>
          <Button className="gap-2" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            Create your first service account
          </Button>
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-left text-xs font-medium text-muted-foreground">
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Team</th>
                  <th className="px-4 py-3 w-24">Agents</th>
                  <th className="px-4 py-3 w-24">Tools</th>
                  <th className="px-4 py-3 w-24">Status</th>
                  <th className="px-4 py-3 w-28 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((sa, idx) => (
                  <ServiceAccountRow
                    key={sa.id}
                    sa={sa}
                    zebra={idx % 2 === 1}
                    onManage={() => setManageId(sa.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <CreateServiceAccountDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={handleCreated}
      />

      <ManageServiceAccountDialog
        key={manageId ?? "no-manage"}
        saId={manageId}
        onClose={() => setManageId(null)}
        onMutated={() => loadList(true)}
        onRotated={handleRotated}
      />

      <CredentialRevealDialog
        // Remount per credential so the acknowledgement checkbox resets without
        // a setState-in-effect.
        key={credential?.client_id ?? "no-credential"}
        credential={credential}
        name={createdName}
        onClose={() => setCredential(null)}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// List row (matches the admin table pattern, e.g. UserManagementTab)
// ─────────────────────────────────────────────────────────────────────────────

function ServiceAccountRow({
  sa,
  zebra,
  onManage,
}: {
  sa: ServiceAccountListItem;
  zebra: boolean;
  onManage: () => void;
}) {
  return (
    <tr className={cn("border-b border-border/60", zebra && "bg-muted/20")}>
      <td className="px-4 py-2.5 align-top">
        <div className="flex items-center gap-1.5 font-medium">
          {sa.protected && (
            <ShieldCheck
              className="h-4 w-4 shrink-0 text-muted-foreground"
              aria-label="Protected service account"
            >
              <title>Protected: this service account can&apos;t be revoked or moved to another team.</title>
            </ShieldCheck>
          )}
          {sa.name}
        </div>
        {sa.description && (
          <div className="text-xs text-muted-foreground">{sa.description}</div>
        )}
      </td>
      <td className="px-4 py-2.5 align-top text-muted-foreground">{sa.owning_team_id}</td>
      <td className="px-4 py-2.5 align-top">
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <Bot className="h-3.5 w-3.5" /> {sa.scope_counts.agents}
        </span>
      </td>
      <td className="px-4 py-2.5 align-top">
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <Wrench className="h-3.5 w-3.5" /> {sa.scope_counts.tools}
        </span>
      </td>
      <td className="px-4 py-2.5 align-top">
        <StatusBadge status={sa.status} />
      </td>
      <td className="px-4 py-2.5 align-top text-right">
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          onClick={onManage}
          disabled={sa.status === "revoked"}
        >
          <Settings className="h-3.5 w-3.5" />
          {sa.status === "revoked" ? "Revoked" : "Manage"}
        </Button>
      </td>
    </tr>
  );
}

function StatusBadge({ status }: { status: "active" | "revoked" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        status === "active"
          ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
          : "bg-muted text-muted-foreground",
      )}
    >
      {status}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Create dialog
// ─────────────────────────────────────────────────────────────────────────────

function CreateServiceAccountDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (cred: CreatedCredential, name: string) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [owningTeam, setOwningTeam] = useState("");
  const [teams, setTeams] = useState<MyTeam[]>([]);
  const [grantable, setGrantable] = useState<GrantableData>({ agents: [], tools: [] });
  const [grantableError, setGrantableError] = useState(false);
  const [selectedAgents, setSelectedAgents] = useState<string[]>([]);
  const [selectedTools, setSelectedTools] = useState<string[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Reset + load pickers each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setName("");
    setDescription("");
    setOwningTeam("");
    setSelectedAgents([]);
    setSelectedTools([]);
    setFormError(null);
    setGrantableError(false);
    setGrantable({ agents: [], tools: [] });
    setLoadingOptions(true);

    let cancelled = false;
    (async () => {
      try {
        const [teamsRes, grantableRes] = await Promise.all([
          fetch("/api/auth/my-roles").then((r) => r.json()).catch(() => ({})),
          fetch("/api/admin/service-accounts/grantable")
            .then((r) => r.json())
            .catch(() => ({ success: false })),
        ]);
        if (cancelled) return;
        const myTeams = (teamsRes.teams ?? []) as MyTeam[];
        setTeams(myTeams);
        if (myTeams.length === 1) setOwningTeam(myTeams[0].slug);
        if (grantableRes.success) {
          setGrantable(grantableRes.data as GrantableData);
        } else {
          // Distinguish a load FAILURE from a genuine zero-grant user (#40):
          // both leave the pickers empty, but only the failure should tell the
          // user to retry rather than implying they hold nothing.
          setGrantableError(true);
        }
      } finally {
        if (!cancelled) setLoadingOptions(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Build label↔ref maps so the MultiSelect can show friendly names while we
  // submit refs.
  const agentLabelToRef = new Map(grantable.agents.map((a) => [a.name, a.ref]));
  const agentRefToLabel = new Map(grantable.agents.map((a) => [a.ref, a.name]));
  const toolLabelToRef = new Map(grantable.tools.map((t) => [t.name, t.ref]));
  const toolRefToLabel = new Map(grantable.tools.map((t) => [t.ref, t.name]));

  const submit = useCallback(async () => {
    setFormError(null);
    if (!name.trim()) {
      setFormError("Name is required.");
      return;
    }
    if (!owningTeam) {
      setFormError("Select an owning team.");
      return;
    }
    setSubmitting(true);
    try {
      const scopes = [
        ...selectedAgents.map((ref) => ({ type: "agent" as const, ref })),
        ...selectedTools.map((ref) => ({ type: "tool" as const, ref })),
      ];
      const res = await fetch("/api/admin/service-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          owning_team_id: owningTeam,
          scopes,
        }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) {
        if (res.status === 403 && body.data?.rejected_scopes?.length) {
          const refs = body.data.rejected_scopes
            .map((s: { ref: string }) => s.ref)
            .join(", ");
          setFormError(`You cannot grant scopes you do not hold: ${refs}`);
        } else {
          setFormError(body.error || "Failed to create service account.");
        }
        return;
      }
      onCreated(body.data.credential as CreatedCredential, body.data.name as string);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to create service account.");
    } finally {
      setSubmitting(false);
    }
  }, [name, description, owningTeam, selectedAgents, selectedTools, onCreated]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Service Account</DialogTitle>
          <DialogDescription>
            Owned by one of your teams. You can only grant agents and tools you currently
            hold — the credential is shown once.
          </DialogDescription>
        </DialogHeader>

        {loadingOptions ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading your teams and grants...
          </div>
        ) : teams.length === 0 ? (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-3 text-sm">
            You must belong to at least one team to create a service account.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1">
              <label htmlFor="sa-name" className="text-sm font-medium">
                Name
              </label>
              <input
                id="sa-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="incident-bot"
                maxLength={64}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="sa-desc" className="text-sm font-medium">
                Description <span className="text-muted-foreground">(optional)</span>
              </label>
              <input
                id="sa-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="PagerDuty integration"
                maxLength={256}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">Owning team</label>
              <TeamPicker
                ariaLabel="Owning team"
                value={owningTeam}
                onChange={setOwningTeam}
                options={teams.map<TeamPickerOption>((t) => ({ slug: t.slug, name: t.name }))}
                placeholder="Select one of your teams..."
                portalled={false}
              />
            </div>

            {grantableError && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                Couldn&apos;t load your grantable resources — the agent/tool lists below may be
                incomplete. Close and reopen this dialog to try again.
              </div>
            )}

            <div className="space-y-1">
              <label className="text-sm font-medium">Agents</label>
              <MultiSelect
                options={grantable.agents.map((a) => a.name)}
                selected={selectedAgents
                  .map((ref) => agentRefToLabel.get(ref))
                  .filter((v): v is string => Boolean(v))}
                onChange={(labels) =>
                  setSelectedAgents(
                    labels
                      .map((l) => agentLabelToRef.get(l))
                      .filter((v): v is string => Boolean(v)),
                  )
                }
                placeholder="Grant agents you hold..."
                emptyLabel="You hold no agents to grant"
                badgeLabel="agents"
              />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">Tools</label>
              <MultiSelect
                options={grantable.tools.map((t) => t.name)}
                selected={selectedTools
                  .map((ref) => toolRefToLabel.get(ref))
                  .filter((v): v is string => Boolean(v))}
                onChange={(labels) =>
                  setSelectedTools(
                    labels
                      .map((l) => toolLabelToRef.get(l))
                      .filter((v): v is string => Boolean(v)),
                  )
                }
                placeholder="Grant tools you hold..."
                emptyLabel="You hold no tools to grant"
                badgeLabel="tools"
              />
            </div>

            {formError && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {formError}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={submitting || loadingOptions || teams.length === 0}
            className="gap-2"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Manage dialog: scopes (add/remove) + rotate + revoke (US3 T028 / US4 T032)
// ─────────────────────────────────────────────────────────────────────────────

function ManageServiceAccountDialog({
  saId,
  onClose,
  onMutated,
  onRotated,
}: {
  saId: string | null;
  onClose: () => void;
  onMutated: () => void;
  onRotated: (cred: CreatedCredential, name: string) => void;
}) {
  const [detail, setDetail] = useState<ServiceAccountDetail | null>(null);
  const [grantable, setGrantable] = useState<GrantableData>({ agents: [], tools: [] });
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<ScopeRef | null>(null);
  // Add-scope selection — ref arrays, mirroring the create dialog's grantable
  // pickers (#54: styled MultiSelect, not native <select>).
  const [addAgents, setAddAgents] = useState<string[]>([]);
  const [addTools, setAddTools] = useState<string[]>([]);

  // ── Credentials section state ──────────────────────────────────────────────
  const [credentials, setCredentials] = useState<ServiceAccountCredential[]>([]);
  const [credLoading, setCredLoading] = useState(false);
  const [credBusy, setCredBusy] = useState(false);
  const [credError, setCredError] = useState<string | null>(null);
  const [pendingRemoveCred, setPendingRemoveCred] = useState<string | null>(null);
  const [addCredProvider, setAddCredProvider] = useState<string>(BUILT_IN_PROVIDERS[0].provider);
  const [addCredToken, setAddCredToken] = useState("");

  const refreshCredentials = useCallback(async () => {
    if (!saId) return;
    setCredLoading(true);
    // M-2: clear any stale error banner on a successful (re)load — mirrors how
    // addCredential/removeCredential already call setCredError(null) before their
    // fetch, so a successful refresh wipes the error too.
    setCredError(null);
    try {
      const res = await fetch(
        `/api/admin/service-accounts/${encodeURIComponent(saId)}/credentials`,
      ).then((r) => r.json()).catch(() => ({ success: false }));
      if (res.success) setCredentials(res.data as ServiceAccountCredential[]);
      else setCredError(res.error || "Failed to load credentials");
    } finally {
      setCredLoading(false);
    }
  }, [saId]);

  const refresh = useCallback(async () => {
    if (!saId) return;
    setLoading(true);
    // Clear any prior error so a fail-then-Retry-succeeds path doesn't leak the
    // stale "Failed to load..." string into the content view's inline error div.
    setError(null);
    try {
      const [detailRes, grantableRes] = await Promise.all([
        fetch(`/api/admin/service-accounts/${encodeURIComponent(saId)}`)
          .then((r) => r.json())
          .catch(() => ({ success: false })),
        fetch("/api/admin/service-accounts/grantable")
          .then((r) => r.json())
          .catch(() => ({ success: false })),
      ]);
      if (detailRes.success) setDetail(detailRes.data as ServiceAccountDetail);
      else setError(detailRes.error || "Failed to load service account");
      if (grantableRes.success) setGrantable(grantableRes.data as GrantableData);
    } finally {
      setLoading(false);
    }
  }, [saId]);

  useEffect(() => {
    if (saId) {
      void refresh();
      void refreshCredentials();
    }
  }, [saId, refresh, refreshCredentials]);

  // Held refs available to ADD (exclude ones the SA already has), per type.
  const existingRefs = new Set((detail?.scopes ?? []).map((s) => `${s.type}:${s.ref}`));
  const addableAgents = grantable.agents.filter(
    (item) => !existingRefs.has(`agent:${item.ref}`),
  );
  const addableTools = grantable.tools.filter(
    (item) => !existingRefs.has(`tool:${item.ref}`),
  );
  // label↔ref maps so the MultiSelect shows friendly names while we submit refs
  // (same pattern as the create dialog).
  const agentLabelToRef = new Map(addableAgents.map((a) => [a.name, a.ref]));
  const agentRefToLabel = new Map(addableAgents.map((a) => [a.ref, a.name]));
  const toolLabelToRef = new Map(addableTools.map((t) => [t.name, t.ref]));
  const toolRefToLabel = new Map(addableTools.map((t) => [t.ref, t.name]));

  const addScope = useCallback(async () => {
    if (!saId) return;
    const selected: ScopeRef[] = [
      ...addAgents.map((ref) => ({ type: "agent" as const, ref })),
      ...addTools.map((ref) => ({ type: "tool" as const, ref })),
    ];
    if (selected.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      for (const scope of selected) {
        const res = await fetch(
          `/api/admin/service-accounts/${encodeURIComponent(saId)}/scopes`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(scope),
          },
        );
        const body = await res.json();
        if (!res.ok || !body.success) {
          setError(body.error || `Failed to add ${scope.type} ${scope.ref}`);
          // Refresh so any scopes that DID get added show, then stop.
          await refresh();
          onMutated();
          return;
        }
      }
      setAddAgents([]);
      setAddTools([]);
      await refresh();
      onMutated();
    } finally {
      setBusy(false);
    }
  }, [saId, addAgents, addTools, refresh, onMutated]);

  const removeScope = useCallback(
    async (scope: ScopeRef) => {
      if (!saId) return;
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/admin/service-accounts/${encodeURIComponent(saId)}/scopes`,
          {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(scope),
          },
        );
        const body = await res.json();
        if (!res.ok || !body.success) {
          setError(body.error || "Failed to remove scope");
          return;
        }
        setPendingRemove(null);
        await refresh();
        onMutated();
      } finally {
        setBusy(false);
      }
    },
    [saId, refresh, onMutated],
  );

  const rotate = useCallback(async () => {
    if (!saId || !detail) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/service-accounts/${encodeURIComponent(saId)}/rotate`,
        { method: "POST" },
      );
      const body = await res.json();
      if (!res.ok || !body.success) {
        setError(body.error || "Failed to rotate credential");
        return;
      }
      onClose();
      onRotated(body.data.credential as CreatedCredential, detail.name);
    } finally {
      setBusy(false);
    }
  }, [saId, detail, onClose, onRotated]);

  const revoke = useCallback(async () => {
    if (!saId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/service-accounts/${encodeURIComponent(saId)}`, {
        method: "DELETE",
      });
      const body = await res.json();
      if (!res.ok || !body.success) {
        setError(body.error || "Failed to revoke service account");
        return;
      }
      onClose();
      onMutated();
    } finally {
      setBusy(false);
    }
  }, [saId, onClose, onMutated]);

  // ── Credentials section callbacks ──────────────────────────────────────────

  const addCredential = useCallback(async () => {
    if (!saId || !addCredToken.trim()) return;
    setCredBusy(true);
    setCredError(null);
    // M-1: snapshot the token BEFORE any await so the request body is stable
    // regardless of when React flushes state. The token is cleared from state
    // ONLY on success (after refreshCredentials) — clearing on entry would wipe
    // the pasted value if the request fails and force a re-paste. Matches the
    // pattern in SecretsManager.tsx (handleCreate).
    const tokenSnapshot = addCredToken;
    try {
      let res: Response;
      try {
        res = await fetch(
          `/api/admin/service-accounts/${encodeURIComponent(saId)}/credentials`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ provider: addCredProvider, token: tokenSnapshot }),
          },
        );
      } catch (networkErr) {
        // Network-level failure (no response) — surface as a credError instead
        // of an unhandled rejection.
        setCredError(
          networkErr instanceof Error ? networkErr.message : "Network error — please retry",
        );
        return;
      }
      const body = (await res.json()) as { success: boolean; error?: string };
      if (!res.ok || !body.success) {
        setCredError(body.error || "Failed to add credential");
        return;
      }
      // Success — safe to clear the token from state now.
      setAddCredToken("");
      await refreshCredentials();
    } finally {
      setCredBusy(false);
    }
  }, [saId, addCredProvider, addCredToken, refreshCredentials]);

  const removeCredential = useCallback(
    async (connectionId: string) => {
      if (!saId) return;
      setCredBusy(true);
      setCredError(null);
      try {
        const res = await fetch(
          `/api/admin/service-accounts/${encodeURIComponent(saId)}/credentials`,
          {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ connection_id: connectionId }),
          },
        );
        const body = await res.json();
        if (!res.ok || !body.success) {
          setCredError(body.error || "Failed to remove credential");
          return;
        }
        setPendingRemoveCred(null);
        await refreshCredentials();
      } finally {
        setCredBusy(false);
      }
    },
    [saId, refreshCredentials],
  );

  return (
    <Dialog open={Boolean(saId)} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{detail?.name ?? "Service account"}</DialogTitle>
          <DialogDescription>
            Manage scopes, rotate the credential, or revoke this service account. You can only
            add scopes you currently hold; removing a scope needs no such hold.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading...
          </div>
        ) : !detail ? (
          // Detail failed to load (e.g. transient 503): show the error + a way
          // out instead of an infinite spinner (the content branch below is
          // unreachable when detail is null). #39.
          <div className="space-y-3 py-6">
            <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error ?? "Failed to load service account."}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => refresh()}>
                Retry
              </Button>
              <Button variant="ghost" onClick={onClose}>
                Close
              </Button>
            </div>
          </div>
        ) : (
          // Dialog scroll: cap height and let content scroll vertically so the
          // dialog doesn't overflow the viewport when credentials + scopes stack up.
          <div className="max-h-[65vh] overflow-y-auto space-y-4 pr-1">
            {/* Current scopes */}
            <div className="space-y-2">
              <span className="text-sm font-medium">Current scopes</span>
              {detail.scopes.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No scopes — this account cannot use any agent or tool yet.
                </p>
              ) : (
                <ul className="space-y-1">
                  {detail.scopes.map((scope) => {
                    const isPending =
                      pendingRemove?.type === scope.type && pendingRemove?.ref === scope.ref;
                    return (
                      <li
                        key={`${scope.type}:${scope.ref}`}
                        className="flex items-center justify-between gap-2 rounded-md border border-input px-2.5 py-1.5"
                      >
                        <span className="inline-flex items-center gap-1.5 text-sm">
                          {scope.type === "agent" ? (
                            <Bot className="h-3.5 w-3.5 text-muted-foreground" />
                          ) : (
                            <Wrench className="h-3.5 w-3.5 text-muted-foreground" />
                          )}
                          <code className="text-xs">{scope.ref}</code>
                        </span>
                        {isPending ? (
                          // Delete-confirm (T028): removal can be unrecoverable via the
                          // UI if the editor no longer holds the scope, so confirm first.
                          <span className="inline-flex items-center gap-1.5">
                            <span className="text-xs text-muted-foreground">Remove?</span>
                            <Button
                              size="sm"
                              variant="destructive"
                              className="h-7 gap-1.5"
                              disabled={busy}
                              onClick={() => removeScope(scope)}
                            >
                              {busy && <Loader2 className="h-3 w-3 animate-spin" />}
                              Confirm
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7"
                              disabled={busy}
                              onClick={() => setPendingRemove(null)}
                            >
                              Cancel
                            </Button>
                          </span>
                        ) : (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-destructive hover:text-destructive"
                            aria-label={`Remove ${scope.type} ${scope.ref}`}
                            disabled={busy}
                            onClick={() => setPendingRemove(scope)}
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* Add scope (bounded by what the editor holds). Uses the app's
                styled MultiSelect — same picker as the create dialog (#54), not
                native browser <select>. */}
            <div className="space-y-3 rounded-md border border-dashed border-input p-3">
              <span className="text-sm font-medium">Add scopes</span>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Agents</label>
                <MultiSelect
                  options={addableAgents.map((a) => a.name)}
                  selected={addAgents
                    .map((ref) => agentRefToLabel.get(ref))
                    .filter((v): v is string => Boolean(v))}
                  onChange={(labels) =>
                    setAddAgents(
                      labels
                        .map((l) => agentLabelToRef.get(l))
                        .filter((v): v is string => Boolean(v)),
                    )
                  }
                  placeholder="Add agents you hold..."
                  emptyLabel="No more agents you can grant"
                  badgeLabel="agents"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Tools</label>
                <MultiSelect
                  options={addableTools.map((t) => t.name)}
                  selected={addTools
                    .map((ref) => toolRefToLabel.get(ref))
                    .filter((v): v is string => Boolean(v))}
                  onChange={(labels) =>
                    setAddTools(
                      labels
                        .map((l) => toolLabelToRef.get(l))
                        .filter((v): v is string => Boolean(v)),
                    )
                  }
                  placeholder="Add tools you hold..."
                  emptyLabel="No more tools you can grant"
                  badgeLabel="tools"
                />
              </div>
              <div className="flex justify-end">
                <Button
                  onClick={addScope}
                  disabled={busy || (addAgents.length === 0 && addTools.length === 0)}
                  className="gap-1.5"
                >
                  <Plus className="h-4 w-4" />
                  Add
                </Button>
              </div>
            </div>

            {error && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}

            {/* ── Provider credentials ─────────────────────────────────────── */}
            <div className="space-y-2 border-t pt-3">
              <div className="flex items-center gap-1.5">
                <Link2 className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Provider credentials</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Paste a provider access token to let this service account use its own
                credential for that provider. If no credential is set, the shared org
                token is used as a fallback — the same behaviour as for user accounts.
              </p>

              {/* Current credentials list */}
              {credLoading ? (
                <div className="flex items-center gap-2 py-1 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading credentials…
                </div>
              ) : credentials.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No provider credentials — org fallback will be used for all providers.
                </p>
              ) : (
                <ul className="space-y-1">
                  {credentials.map((cred) => {
                    const providerLabel = getProviderDisplayName(cred.provider);
                    const isPendingRemove = pendingRemoveCred === cred.id;
                    return (
                      <li
                        key={cred.id}
                        className="flex items-center justify-between gap-2 rounded-md border border-input px-2.5 py-1.5"
                      >
                        <span className="inline-flex items-center gap-1.5 text-sm">
                          <KeyRound className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="font-medium">{providerLabel}</span>
                          <span
                            className={cn(
                              "rounded-full px-1.5 py-0.5 text-xs font-medium",
                              cred.status === "connected"
                                ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                                : "bg-muted text-muted-foreground",
                            )}
                          >
                            {cred.status}
                          </span>
                          {cred.connectedAt && (
                            <span className="text-xs text-muted-foreground">
                              {new Date(cred.connectedAt).toLocaleDateString()}
                            </span>
                          )}
                        </span>
                        {isPendingRemove ? (
                          <span className="inline-flex items-center gap-1.5">
                            <span className="text-xs text-muted-foreground">Remove?</span>
                            <Button
                              size="sm"
                              variant="destructive"
                              className="h-7 gap-1.5"
                              disabled={credBusy}
                              onClick={() => removeCredential(cred.id)}
                            >
                              {credBusy && <Loader2 className="h-3 w-3 animate-spin" />}
                              Confirm
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7"
                              disabled={credBusy}
                              onClick={() => setPendingRemoveCred(null)}
                            >
                              Cancel
                            </Button>
                          </span>
                        ) : (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-destructive hover:text-destructive"
                            aria-label={`Remove ${providerLabel} credential`}
                            disabled={credBusy}
                            onClick={() => setPendingRemoveCred(cred.id)}
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}

              {/* Add credential form */}
              <div className="space-y-2 rounded-md border border-dashed border-input p-3">
                <span className="text-sm font-medium">Add a credential</span>
                <p className="text-xs text-muted-foreground">
                  The token is stored encrypted and is <span className="font-semibold">never shown again</span> after
                  submission.
                </p>
                <div className="flex gap-2">
                  <select
                    aria-label="Provider"
                    value={addCredProvider}
                    onChange={(e) => setAddCredProvider(e.target.value)}
                    className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                  >
                    {BUILT_IN_PROVIDERS.map((p) => (
                      <option key={p.provider} value={p.provider}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  {/* autoComplete="new-password" is intentional: suppresses
                      password-manager autofill for this pasted external token
                      field — we do not want saved login credentials injected. */}
                  <input
                    type="password"
                    aria-label="Access token"
                    value={addCredToken}
                    onChange={(e) => setAddCredToken(e.target.value)}
                    placeholder="Paste access token…"
                    autoComplete="new-password"
                    className="h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm"
                  />
                  <Button
                    onClick={addCredential}
                    disabled={credBusy || !addCredToken.trim()}
                    className="gap-1.5"
                  >
                    {credBusy ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Plus className="h-4 w-4" />
                    )}
                    Add
                  </Button>
                </div>
              </div>

              {credError && (
                <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                  {credError}
                </div>
              )}
            </div>

            {/* Credential lifecycle (rotate / revoke). Both are destructive and
                spec'd "with confirm" (T032) / "delete-confirm" (T028), so each
                requires an explicit inline confirmation before firing. */}
            <div className="space-y-2 border-t pt-3">
              {/* Rotate — confirm because it invalidates the live secret immediately. */}
              {confirmRotate ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-muted-foreground">
                    Rotate credential? The current secret stops working immediately.
                  </span>
                  <Button
                    variant="default"
                    size="sm"
                    className="gap-1.5"
                    disabled={busy}
                    onClick={rotate}
                  >
                    {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    Confirm rotate
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => setConfirmRotate(false)}
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button
                  variant="outline"
                  className="gap-1.5"
                  disabled={busy}
                  onClick={() => {
                    setConfirmRevoke(false);
                    setConfirmRotate(true);
                  }}
                >
                  <KeyRound className="h-4 w-4" />
                  Rotate credential
                </Button>
              )}

              {/* Delete (terminal). Labeled "Delete service account" for clarity
                  (#53 — Erik found "Revoke" unclear); the underlying route +
                  audit event (service_account.revoke) are unchanged.
                  Protected SAs (e.g. the platform unlinked SA) can't be
                  deleted — the control is greyed out (backend also enforces). */}
              {detail.protected ? (
                <div className="flex items-center gap-1.5">
                  <Button
                    variant="ghost"
                    className="gap-1.5 text-muted-foreground"
                    disabled
                    title="This service account is protected and can't be deleted."
                  >
                    <ShieldCheck className="h-4 w-4" />
                    Delete service account
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    Protected — can&apos;t be deleted or moved to another team.
                  </span>
                </div>
              ) : confirmRevoke ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-muted-foreground">
                    Delete service account{detail.name ? ` ${detail.name}` : ""}? This is permanent.
                  </span>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="gap-1.5"
                    disabled={busy}
                    onClick={revoke}
                  >
                    {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    Confirm delete
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => setConfirmRevoke(false)}
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button
                  variant="ghost"
                  className="gap-1.5 text-destructive hover:text-destructive"
                  disabled={busy}
                  onClick={() => {
                    setConfirmRotate(false);
                    setConfirmRevoke(true);
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                  Delete service account
                </Button>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// One-time credential reveal (FR-005 — never re-fetchable)
// ─────────────────────────────────────────────────────────────────────────────

function CredentialRevealDialog({
  credential,
  name,
  onClose,
}: {
  credential: CreatedCredential | null;
  name: string;
  onClose: () => void;
}) {
  // This component is remounted per credential (via `key` on the parent), so
  // the acknowledgement state starts fresh for every new credential.
  const [acknowledged, setAcknowledged] = useState(false);

  if (!credential) return null;

  return (
    <Dialog open={Boolean(credential)} onOpenChange={(o) => { if (!o && acknowledged) onClose(); }}>
      <DialogContent className="max-w-lg" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-emerald-600" />
            Service account created
          </DialogTitle>
          <DialogDescription>
            Copy these credentials now for <span className="font-medium">{name}</span>. The
            client secret is shown <span className="font-semibold">only once</span> and cannot be
            retrieved again. If you lose it, rotate the credential.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <CredentialField label="Client ID" value={credential.client_id} />
          <CredentialField label="Client secret" value={credential.client_secret} secret />
          <CredentialField label="Token URL" value={credential.token_url} />
        </div>

        <EnvBlock credential={credential} />

        <label className="flex items-center gap-2 pt-2 text-sm">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
          />
          I have copied the client secret and understand it won&apos;t be shown again.
        </label>

        <DialogFooter>
          <Button onClick={onClose} disabled={!acknowledged} className="gap-2">
            <X className="h-4 w-4" />
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CredentialField({
  label,
  value,
  secret,
}: {
  label: string;
  value: string;
  secret?: boolean;
}) {
  return (
    <div className="space-y-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div className="flex items-start gap-2 rounded-md border border-input bg-muted/30 px-3 py-2">
        {/* break-all (not truncate) so long secrets/URLs WRAP inside the box
            instead of overflowing the dialog to the right (#51). min-w-0 lets
            the flex child shrink so the copy button stays in view. */}
        <code className={cn("min-w-0 flex-1 break-all text-xs", secret && "tracking-wider")}>
          {value}
        </code>
        <CopyButton value={value} label={`Copy ${label.toLowerCase()}`} />
      </div>
    </div>
  );
}

/**
 * The CAIPE base URL to auto-fill into the .env block (#52). The SA tab calls
 * the API via RELATIVE paths, so the page origin IS the authoritative base —
 * EXCEPT for the scheme on loopback hosts: local dev serves plain HTTP on
 * :3000, but the browser origin can report `https` (e.g. reached via a
 * TLS-terminating dev proxy / HSTS). Emitting `https://localhost:3000` makes a
 * host-shell curl attempt TLS against a non-TLS port → connection refused →
 * HTTP 000 (#58). So for loopback we force `http`; for real hosts we trust the
 * origin scheme (don't downgrade legit prod https). Overridable + SSR-guarded.
 */
function deriveApiBase(): string {
  if (typeof window === "undefined" || !window.location?.origin) {
    return "http://localhost:3000";
  }
  const { protocol, hostname, host } = window.location;
  const isLoopback =
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
  if (isLoopback && protocol === "https:") {
    // Loopback dev is HTTP — downgrade the scheme so paste-and-go curl works.
    return `http://${host}`;
  }
  return window.location.origin;
}

/**
 * Copyable .env block for the one-time reveal (#52). One CopyButton for the
 * whole block; var names are the canonical `CAIPE_SA_*` set confirmed with
 * testing-manager (they map 1:1 to the create-response credential fields and
 * match the credential-usage curl/token doc).
 *
 * `CAIPE_API_URL` is auto-filled via deriveApiBase() (origin, with a loopback
 * http fix — see #58). Overridable for a split UI/API-host or non-loopback
 * scheme. See-once is preserved: rendered only inside the never-refetchable reveal.
 */
function EnvBlock({ credential }: { credential: CreatedCredential }) {
  const apiBase = deriveApiBase();
  const envText = [
    `CAIPE_SA_CLIENT_ID=${credential.client_id}`,
    `CAIPE_SA_CLIENT_SECRET=${credential.client_secret}`,
    `CAIPE_SA_TOKEN_URL=${credential.token_url}`,
    "# CAIPE base URL for /api/v1/chat/* (auto-filled from this page; edit if your API host/scheme differs):",
    `CAIPE_API_URL=${apiBase}`,
  ].join("\n");

  return (
    <div className="space-y-1 pt-1">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">.env</span>
        <CopyButton value={envText} label="Copy .env block" copiedLabel="Copied .env">
          Copy block
        </CopyButton>
      </div>
      <pre className="overflow-x-auto rounded-md border border-input bg-muted/30 px-3 py-2 text-xs">
        <code className="whitespace-pre-wrap break-all">{envText}</code>
      </pre>
    </div>
  );
}
