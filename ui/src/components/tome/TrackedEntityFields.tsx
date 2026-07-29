"use client";

import { Input } from "@/components/ui/input";
import {
  DECISION_STATUSES,
  DECISION_TYPE,
  FM_CLOSED,
  FM_OPENED,
  FM_OWNER,
  FM_PRIORITY,
  FM_STATUS,
  FM_TARGET,
  FM_TYPE,
  ISSUE_STATUSES,
  ISSUE_TYPE,
  SUGGESTION_STATUSES,
  TRACKED_ENTITY_PRIORITIES,
  type FrontmatterValue,
} from "@/lib/tome/schema";
import { cn } from "@/lib/utils";

type Fm = Record<string, FrontmatterValue>;

interface Props {
  value: Fm;
  editing: boolean;
  onChange: (next: Fm) => void;
}

function str(value: FrontmatterValue | undefined): string {
  return value === undefined || value === null ? "" : String(value);
}

function statusesFor(type: string): readonly string[] {
  if (type === ISSUE_TYPE) return ISSUE_STATUSES;
  if (type === DECISION_TYPE) return DECISION_STATUSES;
  return SUGGESTION_STATUSES;
}

export function TrackedEntityFields({ value, editing, onChange }: Props) {
  const set = (key: string, next: FrontmatterValue) =>
    onChange({ ...value, [key]: next });
  const type = str(value[FM_TYPE]).toLowerCase();
  const statusOptions = statusesFor(type);
  const status = str(value[FM_STATUS]) || statusOptions[0];
  const priority = str(value[FM_PRIORITY]) || "medium";
  const owner = str(value[FM_OWNER]);
  const opened = str(value[FM_OPENED]);
  const closed = str(value[FM_CLOSED]);
  const target = str(value[FM_TARGET]);
  const terminal =
    status === "resolved" || status === "accepted" || status === "rejected";

  if (!editing) {
    return (
      <div className="border-b bg-muted/30 px-5 py-3">
        <dl className="inline-grid grid-cols-[auto_auto] items-baseline gap-x-4 gap-y-1.5 text-sm">
          <Term label="Type">
            <span className="capitalize">{type}</span>
          </Term>
          <Term label="Status">
            <span className={cn("capitalize", terminal && "text-muted-foreground")}>
              {status.replaceAll("_", " ")}
            </span>
          </Term>
          <Term label="Priority">
            <span
              className={cn(
                "capitalize",
                priority === "critical" && "font-semibold text-red-600 dark:text-red-400",
              )}
            >
              {priority}
            </span>
          </Term>
          {owner && <Term label="Owner">{owner}</Term>}
          {opened && <Term label="Opened">{opened}</Term>}
          {closed && <Term label="Closed">{closed}</Term>}
          {target && (
            <Term label="Target">
              <code className="text-xs">{target}</code>
            </Term>
          )}
        </dl>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-x-4 gap-y-3 border-b bg-muted/30 px-5 py-3 sm:grid-cols-2">
      <Field label="Status">
        <Select value={status} options={statusOptions} onChange={(next) => set(FM_STATUS, next)} />
      </Field>
      <Field label="Priority">
        <Select
          value={priority}
          options={TRACKED_ENTITY_PRIORITIES}
          onChange={(next) => set(FM_PRIORITY, next)}
        />
      </Field>
      <Field label="Owner">
        <Input
          value={owner}
          onChange={(event) => set(FM_OWNER, event.target.value)}
          placeholder="Owner or decision maker"
          className="h-8"
        />
      </Field>
      <Field label="Opened">
        <Input
          type="date"
          value={opened}
          onChange={(event) => set(FM_OPENED, event.target.value)}
          className="h-8"
        />
      </Field>
      {terminal && (
        <Field label="Closed">
          <Input
            type="date"
            value={closed}
            onChange={(event) => set(FM_CLOSED, event.target.value)}
            className="h-8"
          />
        </Field>
      )}
      <Field label="Roll-up target" className="sm:col-span-2">
        <Input
          value={target}
          onChange={(event) => set(FM_TARGET, event.target.value)}
          placeholder="tome://@project-or-bhag/overview.md"
          className="h-8 font-mono text-xs"
        />
        <span className="text-[10px] text-muted-foreground">
          Optional cross-project, Area, or BHAG target.
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
  onChange: (value: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm capitalize ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      {options.map((option) => (
        <option key={option} value={option}>
          {option.replaceAll("_", " ")}
        </option>
      ))}
    </select>
  );
}
