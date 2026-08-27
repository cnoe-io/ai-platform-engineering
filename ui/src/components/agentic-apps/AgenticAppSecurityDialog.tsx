"use client";

import { TeamMultiPicker, type TeamPickerOption } from "@/components/ui/team-picker";
import type { AgenticAppTeamAccessGrant, AgenticAppTeamRole, AgenticAppVisibility } from "@/types/agentic-app";
import { CheckCircle2, Globe, KeyRound, Lock, ShieldCheck, Users, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

interface AgenticAppSecurityDialogProps {
  appId: string;
  displayName: string;
  createdBy: string;
  requestedScopes: string[];
  initialVisibility: AgenticAppVisibility;
  initialSharedWithTeams: string[];
  canManage: boolean;
}

type EffectivePermissions = { view: boolean; edit: boolean; approve: boolean; admin: boolean };
type AccessReason = { label: string; relationship: string };
type SharingResponse = {
  data?: {
    visibility?: AgenticAppVisibility;
    teamAccess?: AgenticAppTeamAccessGrant[];
    createdBy?: string;
    canManage?: boolean;
    effectivePermissions?: EffectivePermissions;
    accessReasons?: AccessReason[];
    enforcement?: { casMode?: string; openFga?: string };
  };
};

const visibilityChoices = [
  { value: "private", label: "Private", description: "Only the owner can view and launch", Icon: Lock },
  { value: "team", label: "Team", description: "Access comes from the team matrix", Icon: Users },
  { value: "global", label: "Global", description: "Everyone can view; teams may receive higher roles", Icon: Globe },
] satisfies Array<{ value: AgenticAppVisibility; label: string; description: string; Icon: typeof Lock }>;

const roleChoices = [
  { role: "viewer", label: "Viewer", description: "View and launch", relation: "team#member → user" },
  { role: "editor", label: "Editor", description: "Propose changes and refresh", relation: "team#member → writer" },
  { role: "approver", label: "Approver", description: "Review and approve proposals", relation: "team#member → approver" },
  { role: "admin", label: "Admin", description: "Publish, rollback, and manage access", relation: "team#admin → manager" },
] satisfies Array<{ role: AgenticAppTeamRole; label: string; description: string; relation: string }>;

export function AgenticAppSecurityDialog(props: AgenticAppSecurityDialogProps) {
  const [open, setOpen] = useState(false);
  const [visibility, setVisibility] = useState(props.initialVisibility);
  const [teamAccess, setTeamAccess] = useState<AgenticAppTeamAccessGrant[]>(
    props.initialSharedWithTeams.map((teamSlug) => ({ teamSlug, role: "viewer" })),
  );
  const [createdBy, setCreatedBy] = useState(props.createdBy);
  const [canManage, setCanManage] = useState(props.canManage);
  const [effectivePermissions, setEffectivePermissions] = useState<EffectivePermissions>();
  const [accessReasons, setAccessReasons] = useState<AccessReason[]>([]);
  const [enforcement, setEnforcement] = useState({ casMode: "enforce", openFga: "enforced" });
  const [teams, setTeams] = useState<TeamPickerOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    Promise.all([
      fetch(`/api/agentic-apps/${encodeURIComponent(props.appId)}/sharing`).then((response) => {
        if (!response.ok) throw new Error("Unable to load app security settings");
        return response.json() as Promise<SharingResponse>;
      }),
      fetch("/api/dynamic-agents/teams").then((response) => (response.ok ? response.json() : null)),
    ])
      .then(([sharing, teamPayload]) => {
        if (cancelled) return;
        const data = sharing.data;
        if (data?.visibility) setVisibility(data.visibility);
        if (data?.teamAccess) setTeamAccess(data.teamAccess);
        if (data?.createdBy) setCreatedBy(data.createdBy);
        if (typeof data?.canManage === "boolean") setCanManage(data.canManage);
        if (data?.effectivePermissions) setEffectivePermissions(data.effectivePermissions);
        if (data?.accessReasons) setAccessReasons(data.accessReasons);
        if (data?.enforcement) setEnforcement({ casMode: data.enforcement.casMode ?? "enforce", openFga: data.enforcement.openFga ?? "enforced" });
        const rawTeams = Array.isArray(teamPayload) ? teamPayload : Array.isArray(teamPayload?.data) ? teamPayload.data : Array.isArray(teamPayload?.teams) ? teamPayload.teams : [];
        setTeams(rawTeams.filter(isRecord).map((team) => ({
          slug: String(team.slug ?? ""),
          name: typeof team.name === "string" ? team.name : undefined,
          _id: team._id ? String(team._id) : undefined,
        })).filter((team: TeamPickerOption) => Boolean(team.slug)));
      })
      .catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Unable to load security settings"); });
    return () => { cancelled = true; };
  }, [open, props.appId]);

  function setTeamsForRole(role: AgenticAppTeamRole, selected: string[]) {
    const selectedSet = new Set(selected);
    setTeamAccess((current) => [
      ...current.filter((grant) => grant.role !== role && !selectedSet.has(grant.teamSlug)),
      ...selected.map((teamSlug) => ({ teamSlug, role })),
    ]);
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/agentic-apps/${encodeURIComponent(props.appId)}/sharing`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ visibility, teamAccess }),
      });
      const payload = (await response.json()) as SharingResponse & { error?: string; message?: string };
      if (!response.ok) throw new Error(payload.message ?? payload.error ?? "Unable to save access");
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save access");
    } finally {
      setSaving(false);
    }
  }

  return <>
    <button type="button" onClick={() => { setError(""); setOpen(true); }} className="group/security relative inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-emerald-200 transition hover:border-emerald-200/40 hover:bg-emerald-300/10" aria-label={`Security and access for ${props.displayName}`} title="Security and access">
      <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
      <span className="pointer-events-none absolute right-0 top-full z-10 mt-2 hidden whitespace-nowrap rounded-full border border-white/10 bg-slate-950/95 px-3 py-1.5 text-xs font-semibold text-slate-100 shadow-xl group-hover/security:block">{visibilityLabel(visibility)} access</span>
    </button>
    {open && typeof document !== "undefined" ? createPortal(
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setOpen(false)}>
        <section role="dialog" aria-modal="true" aria-labelledby={`security-${props.appId}`} className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-white/15 bg-slate-950 p-5 text-slate-100 shadow-2xl">
          <div className="flex items-start justify-between gap-4">
            <div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-300">Security &amp; access</p><h2 id={`security-${props.appId}`} className="mt-2 text-xl font-semibold">{props.displayName}</h2></div>
            <button type="button" onClick={() => setOpen(false)} className="rounded-lg p-2 text-slate-400 hover:bg-white/10 hover:text-white" aria-label="Close security dialog"><X className="h-4 w-4" /></button>
          </div>

          <dl className="mt-5 grid gap-3 rounded-xl border border-white/10 bg-white/[0.04] p-4 text-sm sm:grid-cols-3">
            <div><dt className="text-slate-500">Created by</dt><dd className="mt-1 font-medium text-slate-200">{formatCreator(createdBy)}</dd></div>
            <div><dt className="text-slate-500">Visibility</dt><dd className="mt-1 font-medium text-slate-200">{visibilityLabel(visibility)}</dd></div>
            <div><dt className="text-slate-500">Enforcement</dt><dd className="mt-1 flex items-center gap-1.5 font-medium text-emerald-200"><CheckCircle2 className="h-3.5 w-3.5" />CAS {enforcement.casMode} · OpenFGA {enforcement.openFga}</dd></div>
          </dl>

          <div className="mt-5 grid gap-2 sm:grid-cols-3">
            {visibilityChoices.map(({ value, label, description, Icon }) => <button key={value} type="button" disabled={!canManage} onClick={() => setVisibility(value)} className={`rounded-xl border p-3 text-left transition ${visibility === value ? "border-cyan-300/60 bg-cyan-300/10" : "border-white/10 bg-white/[0.03]"} disabled:cursor-default`}><span className="flex items-center gap-2 text-sm font-semibold"><Icon className="h-4 w-4" />{label}</span><span className="mt-2 block text-xs leading-4 text-slate-400">{description}</span></button>)}
          </div>

          <div className={`mt-5 ${visibility === "private" ? "opacity-50" : ""}`}>
            <h3 className="text-sm font-semibold">Team access matrix</h3><p className="mt-1 text-xs text-slate-500">One role per team. Higher roles inherit lower capabilities.</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {roleChoices.map((choice) => <div key={choice.role} className="rounded-xl border border-white/10 bg-white/[0.03] p-3"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold text-slate-100">{choice.label}</p><p className="mt-1 text-xs text-slate-400">{choice.description}</p></div><code className="text-[10px] text-emerald-300/80">{choice.relation}</code></div><div className="mt-3"><TeamMultiPicker options={teams} selected={teamAccess.filter((grant) => grant.role === choice.role).map((grant) => grant.teamSlug)} onChange={(selected) => setTeamsForRole(choice.role, selected)} disabled={!canManage || visibility === "private"} portalled={false} ariaLabel={`${choice.label} teams`} /></div></div>)}
            </div>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <section className="rounded-xl border border-white/10 bg-white/[0.03] p-4"><h3 className="flex items-center gap-2 text-sm font-semibold"><KeyRound className="h-4 w-4 text-cyan-300" />Your effective permissions</h3><div className="mt-3 flex flex-wrap gap-2">{effectivePermissions ? Object.entries(effectivePermissions).map(([permission, allowed]) => <span key={permission} className={`rounded-full border px-2.5 py-1 text-xs ${allowed ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-200" : "border-white/10 text-slate-500"}`}>{permission}</span>) : <span className="text-xs text-slate-500">Loading…</span>}</div></section>
            <section className="rounded-xl border border-white/10 bg-white/[0.03] p-4"><h3 className="text-sm font-semibold">Why do I have access?</h3><div className="mt-3 space-y-2">{accessReasons.length ? accessReasons.map((reason) => <div key={reason.relationship}><p className="text-xs text-slate-200">{reason.label}</p><code className="mt-0.5 block break-all text-[10px] text-cyan-300/80">{reason.relationship}</code></div>) : <p className="text-xs text-slate-500">No matching relationship was returned.</p>}</div></section>
          </div>

          <details className="mt-5 rounded-xl border border-white/10 bg-white/[0.03] p-4"><summary className="cursor-pointer text-sm font-semibold">Contract capabilities</summary><p className="mt-2 text-xs text-slate-500">CAS mints only the scopes for an authorized route action.</p><div className="mt-3 flex flex-wrap gap-2">{props.requestedScopes.map((scope) => <span key={scope} className="rounded-full border border-white/10 px-2.5 py-1 text-xs text-slate-300">{scope}</span>)}</div></details>

          {!canManage ? <p className="mt-4 text-xs text-slate-500">Only an app admin, owner, or organization administrator can change access.</p> : null}
          {error ? <p role="alert" className="mt-4 rounded-lg border border-red-300/20 bg-red-400/10 px-3 py-2 text-sm text-red-200">{error}</p> : null}
          <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-white/10 px-4 py-2 text-sm hover:bg-white/10">Close</button>{canManage ? <button type="button" disabled={saving || (visibility === "team" && teamAccess.length === 0)} onClick={save} className="rounded-lg bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-50">{saving ? "Saving…" : "Save access"}</button> : null}</div>
        </section>
      </div>, document.body) : null}
  </>;
}

function visibilityLabel(value: AgenticAppVisibility): string { return value === "private" ? "Private" : value === "team" ? "Team" : "Global"; }
function formatCreator(value: string): string { return value === "seed-config" || value === "system" ? "Deployment config" : value; }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
