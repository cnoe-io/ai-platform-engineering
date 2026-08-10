"use client";

// assisted-by Cursor Auto

import React, { useState } from "react";
import { Bug, Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

interface ExplainResponse {
  decision: "ALLOW" | "DENY";
  reason: string;
  retriable: boolean;
  debug?: {
    engine: string;
    relation: string;
    checked: string[];
    store: string;
  };
}

export function PermissionDebuggerTab({ isAdmin }: { isAdmin: boolean }) {
  const [subjectId, setSubjectId] = useState("");
  const [resourceId, setResourceId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ExplainResponse | null>(null);

  if (!isAdmin) {
    return <p className="text-sm text-muted-foreground">Admin access required.</p>;
  }

  const canExplain = subjectId.trim().length > 0 && resourceId.trim().length > 0;

  async function handleExplain() {
    if (!canExplain) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/authz/v1/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: { type: "user", id: subjectId.trim() },
          resource: { type: "agent", id: resourceId.trim() },
          action: "use",
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof body.error === "string" ? body.error : `HTTP ${res.status}`);
      }
      setResult(body as ExplainResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Explain request failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bug className="h-5 w-5" />
          Permission debugger
        </CardTitle>
        <CardDescription>
          Explain a single agent-use decision through the Centralized Authorization Service.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            placeholder="Subject id"
            value={subjectId}
            onChange={(e) => setSubjectId(e.target.value)}
          />
          <Input
            placeholder="Resource id"
            value={resourceId}
            onChange={(e) => setResourceId(e.target.value)}
          />
        </div>
        <Button type="button" disabled={!canExplain || loading} onClick={() => void handleExplain()}>
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Explain
        </Button>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {result && (
          <div className="space-y-3 rounded-md border p-4">
            <div className="flex items-center gap-2">
              <Badge variant={result.decision === "ALLOW" ? "default" : "destructive"}>{result.decision}</Badge>
              <span className="text-sm text-muted-foreground">{result.reason}</span>
            </div>
            {result.debug && (
              <div className="space-y-1 text-sm font-mono">
                <div>{result.debug.relation}</div>
                {result.debug.checked.map((line) => (
                  <div key={line}>{line}</div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
