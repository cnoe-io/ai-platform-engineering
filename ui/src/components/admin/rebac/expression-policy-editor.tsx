"use client";

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";

export interface PolicyToolOption {
  ref: string;
  name: string;
  schema_hash: string;
  eligible_fields: Array<{ pointer: string; type: "string" | "integer" | "boolean"; required: boolean }>;
}

export interface PolicyEditorValue {
  policy_id: string;
  version: number;
  resource_type: "tool";
  resource_id: string;
  subject: { type: "user" | "service_account"; id: string };
  expression: { template: "string_argument_in_v1"; version: "1"; field: string; values: string[] };
  input_schema_sha256: string;
  exclusive: boolean;
}

export function ExpressionPolicyEditor({
  tools,
  disabled = false,
  onSave,
}: {
  tools: PolicyToolOption[];
  disabled?: boolean;
  onSave: (value: PolicyEditorValue) => Promise<void>;
}) {
  const [toolRef, setToolRef] = useState(tools[0]?.ref ?? "");
  const [field, setField] = useState(tools[0]?.eligible_fields.find((item) => item.type === "string")?.pointer ?? "");
  const [policyId, setPolicyId] = useState("");
  const [subjectType, setSubjectType] = useState<"user" | "service_account">("user");
  const [subjectId, setSubjectId] = useState("");
  const [values, setValues] = useState("");
  const [exclusive, setExclusive] = useState(false);
  const [saving, setSaving] = useState(false);
  const selected = useMemo(() => tools.find((tool) => tool.ref === toolRef), [toolRef, tools]);
  const stringFields = selected?.eligible_fields.filter((item) => item.type === "string") ?? [];
  const parsedValues = [...new Set(values.split(",").map((value) => value.trim()).filter(Boolean))].sort();
  const valid = Boolean(selected && policyId.trim() && subjectId.trim() && field && parsedValues.length);

  const selectTool = (ref: string): void => {
    setToolRef(ref);
    const tool = tools.find((item) => item.ref === ref);
    setField(tool?.eligible_fields.find((item) => item.type === "string")?.pointer ?? "");
  };

  return (
    <form className="space-y-4" onSubmit={async (event) => {
      event.preventDefault();
      if (!selected || !valid) return;
      setSaving(true);
      try {
        await onSave({
          policy_id: policyId.trim(),
          version: 0,
          resource_type: "tool",
          resource_id: selected.ref,
          subject: { type: subjectType, id: subjectId.trim() },
          expression: { template: "string_argument_in_v1", version: "1", field, values: parsedValues },
          input_schema_sha256: selected.schema_hash,
          exclusive,
        });
      } finally {
        setSaving(false);
      }
    }}>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="font-medium">Policy ID</span>
          <input className="w-full rounded-md border bg-background px-3 py-2" value={policyId} onChange={(event) => setPolicyId(event.target.value)} placeholder="primary-project-create" />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Exact tool</span>
          <select className="w-full rounded-md border bg-background px-3 py-2" value={toolRef} onChange={(event) => selectTool(event.target.value)}>
            <option value="">Select a cataloged tool</option>
            {tools.map((tool) => <option key={tool.ref} value={tool.ref}>{tool.name}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Subject type</span>
          <select className="w-full rounded-md border bg-background px-3 py-2" value={subjectType} onChange={(event) => setSubjectType(event.target.value as "user" | "service_account")}>
            <option value="user">User</option>
            <option value="service_account">Service account</option>
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Subject ID</span>
          <input className="w-full rounded-md border bg-background px-3 py-2" value={subjectId} onChange={(event) => setSubjectId(event.target.value)} placeholder="example-user" />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">String argument field</span>
          <select className="w-full rounded-md border bg-background px-3 py-2" value={field} onChange={(event) => setField(event.target.value)}>
            <option value="">Select an eligible field</option>
            {stringFields.map((item) => <option key={item.pointer} value={item.pointer}>{item.pointer}{item.required ? " (required)" : ""}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Allowed values</span>
          <input className="w-full rounded-md border bg-background px-3 py-2" value={values} onChange={(event) => setValues(event.target.value)} placeholder="PRIMARY, SECONDARY" />
        </label>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={exclusive} onChange={(event) => setExclusive(event.target.checked)} />
        Reject save if a known exact, wildcard, or transitive allow bypasses this condition
      </label>
      <div className="rounded-md bg-muted/40 p-3 text-sm">
        <div className="font-medium">Read-only policy preview</div>
        <p className="mt-1 text-muted-foreground">
          Allow {subjectType}:{subjectId || "…"} to invoke {toolRef || "…"} when {field || "…"} is one of {parsedValues.length ? parsedValues.join(", ") : "…"}.
        </p>
        <p className="mt-1 font-mono text-xs text-muted-foreground">Schema {selected?.schema_hash ?? "not selected"}</p>
      </div>
      <Button type="submit" disabled={disabled || saving || !valid}>{saving ? "Saving…" : "Validate and save"}</Button>
    </form>
  );
}
