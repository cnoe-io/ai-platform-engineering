"use client";

// assisted-by claude code claude-opus-4-8

import React, { useCallback, useEffect, useState } from "react";
import { Search, Loader2, ShieldCheck, ShieldX, Bug, RefreshCw } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

const SUBJECT_TYPES = ["user", "service_account"];
const RESOURCE_TYPES = [
  "agent", "skill", "mcp_tool", "knowledge_base", "data_source",
  "task", "slack_channel", "webex_space", "organization", "team", "conversation",
];
const ACTIONS = [
  "discover", "read", "read-metadata", "use", "write", "create",
  "manage", "share", "delete", "ingest", "call", "invoke", "audit",
];

interface Option { value: string; label: string }

interface ExplainRow {
  action: string;
  decision: "ALLOW" | "DENY";
  reason: string;
  retriable: boolean;
  via?: "tuple" | "org_admin" | null;
  debug: { engine: string; relation: string; checked: string[]; store: string };
}

const VIA_LABEL: Record<string, string> = {
  tuple: "tuple",
  org_admin: "admin bypass",
};

const SELECT_CLS = "h-9 rounded-md border border-input bg-background px-3 text-sm";

function pickArray(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (data && typeof data === "object") {
    for (const key of ["users", "resources", "items", "data", "results"]) {
      const v = (data as Record<string, unknown>)[key];
      if (Array.isArray(v)) return v as Record<string, unknown>[];
    }
  }
  return [];
}

function firstStr(item: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = item[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
  }
  return undefined;
}

async function fetchOptions(url: string, idKeys: string[], labelKeys: string[]): Promise<Option[]> {
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    return pickArray(await res.json())
      .map((item) => {
        const value = firstStr(item, idKeys);
        if (!value) return null;
        return { value, label: firstStr(item, labelKeys) ?? value };
      })
      .filter((o): o is Option => o !== null);
  } catch {
    return [];
  }
}

export function PermissionsToolTab({ isAdmin }: { isAdmin: boolean }) {
  const [subjectType, setSubjectType] = useState("user");
  const [subjectId, setSubjectId] = useState("");
  const [resourceType, setResourceType] = useState("agent");
  const [resourceId, setResourceId] = useState("");

  const [subjectOptions, setSubjectOptions] = useState<Option[]>([]);
  const [resourceOptions, setResourceOptions] = useState<Option[]>([]);
  const [refreshingSubject, setRefreshingSubject] = useState(false);
  const [refreshingResource, setRefreshingResource] = useState(false);

  const [results, setResults] = useState<ExplainRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const loadSubjectOptions = useCallback(async () => {
    // Users are pickable by email; service accounts have no list endpoint.
    if (subjectType !== "user") { setSubjectOptions([]); return; }
    setRefreshingSubject(true);
    setSubjectOptions(await fetchOptions("/api/admin/users", ["id", "sub"], ["email", "username"]));
    setRefreshingSubject(false);
  }, [subjectType]);

  const loadResourceOptions = useCallback(async () => {
    // One uniform source: resources that exist in the OpenFGA graph for this type
    // (covers built-in agents, etc.). The endpoint attaches canonical labels for
    // channel-like types (slack/webex); the value sent to CAS is always the id.
    setRefreshingResource(true);
    setResourceOptions(await fetchOptions(`/api/admin/authz/resources?type=${encodeURIComponent(resourceType)}`, ["id"], ["label", "id"]));
    setRefreshingResource(false);
  }, [resourceType]);

  useEffect(() => { if (isAdmin) void loadSubjectOptions(); }, [isAdmin, loadSubjectOptions]);
  useEffect(() => { if (isAdmin) void loadResourceOptions(); }, [isAdmin, loadResourceOptions]);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    setResults(null);
    try {
      const res = await fetch("/api/admin/authz/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: { type: subjectType, id: subjectId.trim() },
          resource: { type: resourceType, id: resourceId.trim() },
          actions: ACTIONS, // evaluate the whole matrix at once
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setResults((body.results ?? []) as ExplainRow[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Explain failed");
    } finally {
      setLoading(false);
    }
  }, [subjectType, subjectId, resourceType, resourceId]);

  const grantRevoke = useCallback(async (action: string, op: "grant" | "revoke") => {
    setBusyAction(action);
    setError(null);
    try {
      const res = await fetch("/api/admin/authz/grants", {
        method: op === "grant" ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resource: { type: resourceType, id: resourceId.trim() },
          grantee: { type: subjectType, id: subjectId.trim() },
          capability: action,
        }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || `HTTP ${res.status}`);
      }
      await run(); // re-evaluate the matrix so the new decision shows
    } catch (err) {
      setError(err instanceof Error ? err.message : "Grant/revoke failed");
    } finally {
      setBusyAction(null);
    }
  }, [resourceType, resourceId, subjectType, subjectId, run]);

  if (!isAdmin) return <p className="text-sm text-muted-foreground">Admin access required.</p>;

  const canRun = subjectId.trim().length > 0 && resourceId.trim().length > 0 && !loading;

  // A value field = [pick dropdown of all available] + [editable text] + [refresh].
  // Pick reflects the current id when it matches a known option; the text field
  // is always the submitted value and accepts custom ids.
  function valueField(
    kind: "Subject" | "Resource",
    options: Option[],
    value: string,
    setValue: (v: string) => void,
    refresh: () => void,
    refreshing: boolean,
    placeholder: string,
  ) {
    const pickValue = options.some((o) => o.value === value) ? value : "";
    return (
      <>
        {options.length > 0 && (
          <select
            aria-label={`${kind} options`}
            value={pickValue}
            onChange={(e) => { if (e.target.value) setValue(e.target.value); }}
            className={`${SELECT_CLS} flex-1 min-w-[150px]`}
          >
            <option value="">— pick —</option>
            {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        )}
        <Input aria-label={kind} placeholder={placeholder} value={value} onChange={(e) => setValue(e.target.value)} className="h-9 flex-1 min-w-[150px]" />
        <Button type="button" aria-label={`Refresh ${kind.toLowerCase()} choices`} variant="outline" size="sm" onClick={refresh} disabled={refreshing} className="shrink-0">
          {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        </Button>
      </>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold flex items-center gap-2"><Bug className="h-5 w-5" />Permissions Tool</h3>
        <p className="text-sm text-muted-foreground">Check what a subject can do on a resource via the Centralized Authorization Service, and grant or revoke access — all in one place.</p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-sm">Evaluate a decision</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Subject</label>
            <div className="flex gap-2 flex-wrap items-center">
              <select aria-label="Subject type" value={subjectType} onChange={(e) => { setSubjectType(e.target.value); setSubjectId(""); }} className={`${SELECT_CLS} w-40`}>
                {SUBJECT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              {valueField("Subject", subjectOptions, subjectId, setSubjectId, () => void loadSubjectOptions(), refreshingSubject, "subject id (sub / email)")}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Resource</label>
            <div className="flex gap-2 flex-wrap items-center">
              <select aria-label="Resource type" value={resourceType} onChange={(e) => { setResourceType(e.target.value); setResourceId(""); }} className={`${SELECT_CLS} w-44`}>
                {RESOURCE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              {valueField("Resource", resourceOptions, resourceId, setResourceId, () => void loadResourceOptions(), refreshingResource, "resource id")}
            </div>
          </div>

          <div className="flex justify-end">
            <Button onClick={() => void run()} disabled={!canRun} className="gap-1.5">
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
              Explain all actions
            </Button>
          </div>
        </CardContent>
      </Card>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {results && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Permission matrix</CardTitle>
            <CardDescription>
              <span className="font-mono">{subjectType}:{subjectId}</span> on <span className="font-mono">{resourceType}:{resourceId}</span> — every action evaluated via OpenFGA
            </CardDescription>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground border-b border-border">
                  <th className="py-2 pr-3 font-medium">Action</th>
                  <th className="py-2 pr-3 font-medium">Decision</th>
                  <th className="py-2 pr-3 font-medium">Granted via</th>
                  <th className="py-2 pr-3 font-medium">Relation</th>
                  <th className="py-2 pr-3 font-medium">Checked tuple</th>
                  <th className="py-2 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.action} className="border-b border-border/50">
                    <td className="py-1.5 pr-3 font-mono">{r.action}</td>
                    <td className="py-1.5 pr-3">
                      {r.decision === "ALLOW" ? (
                        <Badge variant="outline" className="text-green-600 border-green-300 bg-green-50 dark:bg-green-950 gap-1"><ShieldCheck className="h-3 w-3" />ALLOW</Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground gap-1"><ShieldX className="h-3 w-3" />DENY</Badge>
                      )}
                    </td>
                    <td className="py-1.5 pr-3 text-xs text-muted-foreground">
                      {r.decision === "ALLOW" ? (VIA_LABEL[r.via ?? "tuple"] ?? r.via ?? "tuple") : "—"}
                    </td>
                    <td className="py-1.5 pr-3 font-mono text-xs text-muted-foreground">{r.debug.relation}</td>
                    <td className="py-1.5 pr-3 font-mono text-xs text-muted-foreground break-all">{r.debug.checked[0]}</td>
                    <td className="py-1.5">
                      {r.decision === "DENY" ? (
                        <Button type="button" variant="outline" size="sm" disabled={busyAction !== null} onClick={() => void grantRevoke(r.action, "grant")}>
                          {busyAction === r.action ? <Loader2 className="h-3 w-3 animate-spin" /> : "Grant"}
                        </Button>
                      ) : r.via === "tuple" ? (
                        <Button type="button" variant="outline" size="sm" disabled={busyAction !== null} onClick={() => void grantRevoke(r.action, "revoke")}>
                          {busyAction === r.action ? <Loader2 className="h-3 w-3 animate-spin" /> : "Revoke"}
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
