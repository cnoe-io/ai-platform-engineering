"use client";

// assisted-by claude code claude-opus-4-8

import React, { useState } from "react";
import { Search, Loader2, ShieldCheck, ShieldX, Bug } from "lucide-react";
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

interface ExplainResult {
  decision: "ALLOW" | "DENY";
  reason: string;
  retriable: boolean;
  debug: { engine: string; relation: string; checked: string[]; store: string };
}

export function PermissionDebuggerTab({ isAdmin }: { isAdmin: boolean }) {
  const [subjectType, setSubjectType] = useState("user");
  const [subjectId, setSubjectId] = useState("");
  const [resourceType, setResourceType] = useState("agent");
  const [resourceId, setResourceId] = useState("");
  const [action, setAction] = useState("use");

  const [result, setResult] = useState<ExplainResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/admin/authz/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: { type: subjectType, id: subjectId.trim() },
          resource: { type: resourceType, id: resourceId.trim() },
          action,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setResult(body as ExplainResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Explain failed");
    } finally {
      setLoading(false);
    }
  };

  if (!isAdmin) {
    return <p className="text-sm text-muted-foreground">Admin access required.</p>;
  }

  const canRun = subjectId.trim().length > 0 && resourceId.trim().length > 0 && !loading;
  const selectCls = "h-9 rounded-md border border-input bg-background px-3 text-sm w-full";

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold flex items-center gap-2"><Bug className="h-5 w-5" />Permission Debugger</h3>
        <p className="text-sm text-muted-foreground">Ask the Centralized Authorization Service &quot;why can / can&apos;t this subject do this action on this resource?&quot; — shows the exact relation evaluated.</p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-sm">Evaluate a decision</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Subject</label>
              <div className="flex gap-2">
                <select value={subjectType} onChange={(e) => setSubjectType(e.target.value)} className={selectCls + " max-w-[160px]"}>
                  {SUBJECT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <Input placeholder="subject id (sub / email)" value={subjectId} onChange={(e) => setSubjectId(e.target.value)} className="h-9" />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Resource</label>
              <div className="flex gap-2">
                <select value={resourceType} onChange={(e) => setResourceType(e.target.value)} className={selectCls + " max-w-[180px]"}>
                  {RESOURCE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <Input placeholder="resource id" value={resourceId} onChange={(e) => setResourceId(e.target.value)} className="h-9" />
              </div>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-end">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Action</label>
              <select value={action} onChange={(e) => setAction(e.target.value)} className={selectCls}>
                {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <Button onClick={() => void run()} disabled={!canRun} className="gap-1.5">
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
              Explain
            </Button>
          </div>
        </CardContent>
      </Card>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {result && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              {result.decision === "ALLOW" ? (
                <Badge variant="outline" className="text-green-600 border-green-300 bg-green-50 dark:bg-green-950 gap-1"><ShieldCheck className="h-3 w-3" />ALLOW</Badge>
              ) : (
                <Badge variant="outline" className="text-red-600 border-red-300 bg-red-50 dark:bg-red-950 gap-1"><ShieldX className="h-3 w-3" />DENY</Badge>
              )}
              <span className="font-mono text-xs text-muted-foreground">{result.reason}</span>
            </CardTitle>
            <CardDescription>OpenFGA evaluation detail</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex gap-2"><span className="text-muted-foreground w-20">Engine</span><span className="font-mono">{result.debug.engine}</span></div>
            <div className="flex gap-2"><span className="text-muted-foreground w-20">Relation</span><span className="font-mono">{result.debug.relation}</span></div>
            <div className="flex gap-2"><span className="text-muted-foreground w-20">Checked</span>
              <div className="font-mono space-y-1">{result.debug.checked.map((c) => <div key={c}>{c}</div>)}</div>
            </div>
            <div className="flex gap-2"><span className="text-muted-foreground w-20">Store</span><span className="font-mono">{result.debug.store}</span></div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
