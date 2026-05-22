"use client";

import { useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface BaselineDiagnosticRow {
  id: string;
  label: string;
  tuple: { user: string; relation: string; object: string };
  expected_member: boolean;
  expected_admin: boolean;
  actual: boolean;
  matches_member: boolean;
  matches_admin: boolean;
}

interface BaselineDiagnosticResponse {
  user_id: string;
  summary: {
    total: number;
    matches_member: number;
    matches_admin: number;
    member_drift: number;
    admin_drift: number;
  };
  checks: BaselineDiagnosticRow[];
}

export function UserBaselineDiagnosticsPanel() {
  const [userId, setUserId] = useState("");
  const [result, setResult] = useState<BaselineDiagnosticResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function runDiagnostics() {
    const subject = userId.trim();
    if (!subject) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/openfga/baseline-diagnostics?userId=${encodeURIComponent(subject)}`);
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error || `Diagnostics failed (${response.status})`);
      }
      setResult(body.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Diagnostics failed");
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          value={userId}
          onChange={(event) => setUserId(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") runDiagnostics();
          }}
          placeholder="Keycloak subject, for example bob-sub"
          aria-label="User subject"
        />
        <Button onClick={runDiagnostics} disabled={!userId.trim() || loading} className="gap-2">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          Diagnose
        </Button>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" />
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-md border p-3">
              <p className="text-xs text-muted-foreground">User</p>
              <p className="font-mono text-sm">{result.user_id}</p>
            </div>
            <div className="rounded-md border p-3">
              <p className="text-xs text-muted-foreground">Member baseline drift</p>
              <p className="text-lg font-semibold">{result.summary.member_drift}</p>
            </div>
            <div className="rounded-md border p-3">
              <p className="text-xs text-muted-foreground">Admin baseline drift</p>
              <p className="text-lg font-semibold">{result.summary.admin_drift}</p>
            </div>
          </div>

          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Check</th>
                  <th className="px-3 py-2 text-left">Tuple</th>
                  <th className="px-3 py-2 text-left">Actual</th>
                  <th className="px-3 py-2 text-left">Member</th>
                  <th className="px-3 py-2 text-left">Admin</th>
                </tr>
              </thead>
              <tbody>
                {result.checks.map((check) => (
                  <tr key={check.id} className="border-t">
                    <td className="px-3 py-2">{check.label}</td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {check.tuple.user} {check.tuple.relation} {check.tuple.object}
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant={check.actual ? "default" : "outline"}>
                        {check.actual ? "Allow" : "Deny"}
                      </Badge>
                    </td>
                    <td className="px-3 py-2">
                      <BaselineBadge matches={check.matches_member} expected={check.expected_member} />
                    </td>
                    <td className="px-3 py-2">
                      <BaselineBadge matches={check.matches_admin} expected={check.expected_admin} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function BaselineBadge({ matches, expected }: { matches: boolean; expected: boolean }) {
  return (
    <Badge variant={matches ? "outline" : "destructive"} className="gap-1">
      {matches && <CheckCircle2 className="h-3 w-3" />}
      {matches ? "Matches" : `Expected ${expected ? "allow" : "deny"}`}
    </Badge>
  );
}
