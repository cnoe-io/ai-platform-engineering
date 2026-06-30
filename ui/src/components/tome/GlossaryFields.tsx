"use client";

import { Input } from "@/components/ui/input";
import {
  FM_ALIASES,
  FM_EXPANSION,
  FM_SCOPE,
  FM_STATUS,
  FM_TERM,
  FM_TERM_KIND,
  GLOSSARY_SCOPES,
  GLOSSARY_STATUSES,
  GLOSSARY_TERM_KINDS,
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

function aliasesOf(v: FrontmatterValue | undefined): string[] {
  if (Array.isArray(v)) return v.filter(Boolean);
  const s = str(v).trim();
  return s ? s.split(",").map((x) => x.trim()).filter(Boolean) : [];
}

/**
 * Structured editor for a glossary term's typed frontmatter. Rendered by
 * WikiPageView above the Crepe body editor when a page is `type: glossary`.
 * Dropdowns for scope / term kind / status; chips/comma-input for aliases.
 *
 * `type`-keyed, so the same mechanism can host other structured entry types.
 */
export function GlossaryFields({ value, editing, onChange }: Props) {
  const set = (key: string, v: FrontmatterValue) =>
    onChange({ ...value, [key]: v });

  const term = str(value[FM_TERM]);
  const expansion = str(value[FM_EXPANSION]);
  const scope = str(value[FM_SCOPE]) || "project";
  const termKind = str(value[FM_TERM_KIND]) || "term";
  const status = str(value[FM_STATUS]) || "current";
  const aliases = aliasesOf(value[FM_ALIASES]);
  const deprecated = status === "deprecated";

  if (!editing) {
    return (
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 border-b bg-muted/30 px-5 py-3 text-sm">
        <Term label="Term">
          <span className={cn("font-medium", deprecated && "line-through text-muted-foreground")}>
            {term || "—"}
          </span>
          {deprecated && (
            <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">
              Deprecated
            </span>
          )}
        </Term>
        {expansion && <Term label="Expansion">{expansion}</Term>}
        <Term label="Scope">
          <Pill>{scope}</Pill>
        </Term>
        <Term label="Kind">
          <Pill>{termKind}</Pill>
        </Term>
        {aliases.length > 0 && (
          <Term label="Aliases">
            <span className="flex flex-wrap gap-1">
              {aliases.map((a) => (
                <Pill key={a}>{a}</Pill>
              ))}
            </span>
          </Term>
        )}
      </dl>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-x-4 gap-y-3 border-b bg-muted/30 px-5 py-3 sm:grid-cols-2">
      <Field label="Term">
        <Input
          value={term}
          onChange={(e) => set(FM_TERM, e.target.value)}
          placeholder="e.g. TOME"
          className="h-8"
        />
      </Field>
      <Field label="Kind">
        <Select
          value={termKind}
          options={GLOSSARY_TERM_KINDS}
          onChange={(v) => set(FM_TERM_KIND, v)}
        />
      </Field>
      {termKind === "acronym" && (
        <Field label="Expansion" className="sm:col-span-2">
          <Input
            value={expansion}
            onChange={(e) => set(FM_EXPANSION, e.target.value)}
            placeholder="e.g. Team Outshift Memory Engine"
            className="h-8"
          />
        </Field>
      )}
      <Field label="Scope">
        <Select value={scope} options={GLOSSARY_SCOPES} onChange={(v) => set(FM_SCOPE, v)} />
      </Field>
      <Field label="Status">
        <Select value={status} options={GLOSSARY_STATUSES} onChange={(v) => set(FM_STATUS, v)} />
      </Field>
      <Field label="Aliases" className="sm:col-span-2">
        <Input
          value={aliases.join(", ")}
          onChange={(e) =>
            set(
              FM_ALIASES,
              e.target.value.split(",").map((x) => x.trim()).filter(Boolean),
            )
          }
          placeholder="e.g. tome, t.o.m.e."
          className="h-8"
        />
        <span className="text-[10px] text-muted-foreground">
          Other spellings people use, comma-separated.
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
      <dd className="flex items-center">{children}</dd>
    </>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded border px-1.5 py-0.5 text-xs capitalize text-foreground">
      {children}
    </span>
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
