"use client";

import { useCallback, useEffect, useState } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

import { ExpressionPolicyEditor, type PolicyEditorValue, type PolicyToolOption } from "./expression-policy-editor";
import { PolicyEffectiveness } from "./policy-effectiveness";

interface StoredPolicy {
  policy_id: string;
  resource_id: string;
  version: number;
  status: string;
  subject: { type: string; id: string };
  expression: { field: string; values: string[] };
  input_schema_sha256: string;
}

function data<T>(value: unknown): T {
  return (value as { data: T }).data;
}

export function ExpressionPolicyAdmin({ isAdmin }: { isAdmin: boolean }) {
  const [tools, setTools] = useState<PolicyToolOption[]>([]);
  const [policies, setPolicies] = useState<StoredPolicy[]>([]);
  const [effectiveness, setEffectiveness] = useState<{ exclusive: boolean; warnings: string[] } | null>(null);
  const [message, setMessage] = useState("");

  const reload = useCallback(async () => {
    const [schemaResponse, policyResponse] = await Promise.all([
      fetch("/api/admin/openfga/policies/schema"),
      fetch("/api/admin/openfga/policies"),
    ]);
    if (!schemaResponse.ok || !policyResponse.ok) throw new Error("Unable to load expression policies");
    const schemas = data<{ tools: PolicyToolOption[] }>(await schemaResponse.json());
    const listed = data<{ policies: StoredPolicy[] }>(await policyResponse.json());
    setTools(schemas.tools);
    setPolicies(listed.policies);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void reload().catch((error) => setMessage(error instanceof Error ? error.message : String(error)));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [reload]);

  const save = async (value: PolicyEditorValue): Promise<void> => {
    setMessage("");
    try {
      const schema = await fetch("/api/admin/openfga/policies/schema", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ref: value.resource_id }),
      });
      if (!schema.ok) throw new Error("The current tool schema could not be registered");
      const validate = await fetch("/api/admin/openfga/policies/validate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(value),
      });
      if (!validate.ok) throw new Error("Policy validation failed");
      const response = await fetch("/api/admin/openfga/policies", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(value),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Policy save failed");
      const stored = data<{ policy: StoredPolicy; effectiveness: { exclusive: boolean; warnings: string[] } }>(payload);
      setEffectiveness(stored.effectiveness);
      setMessage(`Policy ${stored.policy.policy_id} is ${stored.policy.status.toLowerCase()}.`);
      await reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Expression policies</CardTitle>
        <CardDescription>Build reviewed OpenFGA CEL conditions from typed tool schemas. Raw CEL, Cedar, and Rego are not accepted.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {isAdmin && <ExpressionPolicyEditor tools={tools} onSave={save} />}
        {effectiveness && <PolicyEffectiveness {...effectiveness} />}
        {message && <p className="text-sm text-muted-foreground">{message}</p>}
        <div className="space-y-2">
          <h3 className="text-sm font-medium">Current policies</h3>
          {policies.length === 0 ? <p className="text-sm text-muted-foreground">No expression policies.</p> : policies.map((policy) => (
            <div key={policy.policy_id} className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm">
              <div>
                <div className="font-medium">{policy.policy_id} <span className="text-xs text-muted-foreground">v{policy.version} · {policy.status}</span></div>
                <div className="text-muted-foreground">{policy.subject.type}:{policy.subject.id} · {policy.resource_id} · {policy.expression.field}</div>
              </div>
              {isAdmin && <Button variant="outline" size="sm" onClick={async () => {
                const response = await fetch(`/api/admin/openfga/policies?policy_id=${encodeURIComponent(policy.policy_id)}&version=${policy.version}`, { method: "DELETE" });
                if (response.ok) await reload();
              }}>Delete</Button>}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
