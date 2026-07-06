"use client";

import { Input } from "@/components/ui/input";
import {
  EDGE_CONFIDENCES,
  EDGE_RELATIONS,
  EDGE_STATUSES,
  FM_CONFIDENCE,
  FM_EVIDENCE,
  FM_RELATION,
  FM_SOURCE,
  FM_STATUS,
  FM_TARGET,
  type FrontmatterValue,
} from "@/lib/tome/schema";
import { cn } from "@/lib/utils";

type Fm = Record<string, FrontmatterValue>;

interface Props {
  value: Fm;
  editing: boolean;
  onChange: (next: Fm) => void;
}

function str(v: FrontmatterValue | undefined): string {
  return v === undefined || v === null ? "" : String(v);
}

function listOf(v: FrontmatterValue | undefined): string[] {
  if (Array.isArray(v)) return v.filter(Boolean);
  const s = str(v).trim();
  return s ? s.split(",").map((x) => x.trim()).filter(Boolean) : [];
}

/**
 * Structured editor for an edge's typed frontmatter. Rendered by
 * WikiPageView above the body editor when a page is `type: edge`. Mirrors
 * GlossaryFields — dropdowns for relation / confidence / status, ref inputs
 * for source / target / evidence.
 */
export function EdgeFields({ value, editing, onChange }: Props) {
  const set = (key: string, v: FrontmatterValue) =>
    onChange({ ...value, [key]: v });

  const relation = str(value[FM_RELATION]) || "relates-to";
  const source = str(value[FM_SOURCE]);
  const target = str(value[FM_TARGET]);
  const confidence = str(value[FM_CONFIDENCE]) || "medium";
  const status = str(value[FM_STATUS]) || "active";
  const evidence = listOf(value[FM_EVIDENCE]);
  const inactive = status !== "active";

  if (!editing) {
    return (
      <div className="border-b bg-muted/30 px-5 py-3">
        <dl className="inline-grid grid-cols-[auto_auto] items-baseline gap-x-4 gap-y-1.5 text-sm">
          <Term label="Relation">
            <span className={cn("capitalize", inactive && "text-muted-foreground line-through")}>
              {relation}
            </span>
          </Term>
          <Term label="Source">
            <code className="text-xs">{source || "—"}</code>
          </Term>
          <Term label="Target">
            <code className="text-xs">{target || "—"}</code>
          </Term>
          <Term label="Confidence">
            <span className="capitalize">{confidence}</span>
          </Term>
          <Term label="Status">
            <span className={cn("capitalize", inactive && "text-amber-600 dark:text-amber-400")}>
              {status}
            </span>
          </Term>
          {evidence.length > 0 && (
            <Term label="Evidence">
              <span className="flex flex-col gap-0.5">
                {evidence.map((e) => (
                  <code key={e} className="text-xs">
                    {e}
                  </code>
                ))}
              </span>
            </Term>
          )}
        </dl>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-x-4 gap-y-3 border-b bg-muted/30 px-5 py-3 sm:grid-cols-2">
      <Field label="Relation">
        <Select value={relation} options={EDGE_RELATIONS} onChange={(v) => set(FM_RELATION, v)} />
      </Field>
      <Field label="Confidence">
        <Select value={confidence} options={EDGE_CONFIDENCES} onChange={(v) => set(FM_CONFIDENCE, v)} />
      </Field>
      <Field label="Source" className="sm:col-span-2">
        <Input
          value={source}
          onChange={(e) => set(FM_SOURCE, e.target.value)}
          placeholder="tome://roadmap.md#q3-pivot"
          className="h-8 font-mono text-xs"
        />
      </Field>
      <Field label="Target" className="sm:col-span-2">
        <Input
          value={target}
          onChange={(e) => set(FM_TARGET, e.target.value)}
          placeholder="tome://@other-project/roadmap.md"
          className="h-8 font-mono text-xs"
        />
      </Field>
      <Field label="Status">
        <Select value={status} options={EDGE_STATUSES} onChange={(v) => set(FM_STATUS, v)} />
      </Field>
      <Field label="Evidence" className="sm:col-span-2">
        <Input
          value={evidence.join(", ")}
          onChange={(e) =>
            set(
              FM_EVIDENCE,
              e.target.value.split(",").map((x) => x.trim()).filter(Boolean),
            )
          }
          placeholder="tome://conversations.md#pr-4821, tome://@other-project/issues#142"
          className="h-8 font-mono text-xs"
        />
        <span className="text-[10px] text-muted-foreground">
          `tome://` refs backing this edge, comma-separated.
        </span>
      </Field>
    </div>
  );
}

function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={cn("flex flex-col gap-1", className)}>
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

function Term({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd className="flex min-w-0 items-center">{children}</dd>
    </>
  );
}

function Select({
  value,
  options,
  onChange,
}: {
  value: string;
  options: readonly string[];
  onChange: (v: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm capitalize ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      {options.map((o) => (
        <option key={o} value={o} className="capitalize">
          {o}
        </option>
      ))}
    </select>
  );
}
