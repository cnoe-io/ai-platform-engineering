"use client";

import { Input } from "@/components/ui/input";
import { useEffect, useState } from "react";

interface NamespaceOption {
  key: string;
  label: string;
}

interface MemoryNamespacePickerProps {
  agentId: string;
  value?: string;
  disabled?: boolean;
  onChange: (value?: string) => void;
}

export function MemoryNamespacePicker({
  agentId,
  value,
  disabled,
  onChange,
}: MemoryNamespacePickerProps) {
  const [items, setItems] = useState<NamespaceOption[]>([]);
  const [allowCustom, setAllowCustom] = useState(false);
  const [custom, setCustom] = useState("");
  const [customMode, setCustomMode] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/dynamic-agents/${encodeURIComponent(agentId)}/memory-namespaces`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error("namespace source unavailable");
        if (!cancelled) {
          setItems(payload.data?.items ?? []);
          setAllowCustom(payload.data?.allow_custom === true);
          setError(false);
        }
      })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [agentId]);

  if (items.length === 0 && !allowCustom && !value && !error) return null;

  return (
    <div className="flex items-center gap-2">
      <select
        aria-label="Memory namespace"
        value={customMode || (value && !items.some((item) => item.key === value)) ? "__custom" : value || ""}
        disabled={disabled}
        onChange={(event) => {
          if (event.target.value === "__custom") {
            setCustomMode(true);
            setCustom(value || "");
            return;
          }
          setCustomMode(false);
          setCustom("");
          onChange(event.target.value || undefined);
        }}
        className="h-8 max-w-48 rounded-md border border-input bg-background px-2 text-xs"
      >
        <option value="">No working context</option>
        {items.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
        {allowCustom && <option value="__custom">Custom…</option>}
      </select>
      {allowCustom && (customMode || Boolean(value && !items.some((item) => item.key === value))) && (
        <Input
          aria-label="Custom memory namespace"
          value={custom || value || ""}
          disabled={disabled}
          placeholder="namespace-key"
          className="h-8 w-40 text-xs"
          onChange={(event) => setCustom(event.target.value.toLowerCase())}
          onBlur={() => {
            if (/^[a-z0-9][a-z0-9_-]{0,63}$/.test(custom)) {
              onChange(custom);
              setCustomMode(true);
            }
          }}
        />
      )}
      {error && <span className="text-[11px] text-amber-400">Contexts unavailable; unscoped chat still works.</span>}
    </div>
  );
}
