"use client";

/**
 * Create/edit dialog for a RAG ingestion source
 * (spec 2026-07-21-rag-source-config-db).
 *
 * The `source_type` selector switches between the 5 discriminated variants'
 * identity fields, which — like `IMMUTABLE_FIELDS` on the API
 * (`/api/rag/sources/[sourceId]/route.ts`) — can never change after
 * creation, so they're disabled in edit mode. `visibility` is never
 * rendered here: it's server-controlled (defaults to "team" on create via
 * `POST /api/rag/sources`, and only flips via config seeding/adoption).
 */

import { TeamOwnershipFields } from "@/components/rbac/TeamOwnershipFields";
import { Button } from "@/components/ui/button";
import {
Dialog,
DialogContent,
DialogFooter,
DialogHeader,
DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RagApiError } from "@/lib/rag-api";
import { cn } from "@/lib/utils";
import type {
IngestionSourceConfig,
IngestionSourceType,
} from "@/types/ingestion-source";
import { Loader2 } from "lucide-react";
import { useEffect,useState } from "react";

const DEFAULT_CHUNK_SIZE = 10000;
const DEFAULT_CHUNK_OVERLAP = 2000;
const DEFAULT_RELOAD_INTERVAL = 86400;

const SOURCE_TYPE_OPTIONS: Array<{ value: IngestionSourceType; label: string }> = [
  { value: "slack_channel", label: "Slack Channel" },
  { value: "confluence_space", label: "Confluence Space" },
  { value: "jira_project", label: "Jira Project" },
  { value: "web_url", label: "Web URL" },
  { value: "webex_space", label: "Webex Space" },
];

interface TeamRow {
  _id?: string;
  slug?: string;
  name?: string;
}

export interface IngestionSourceFormValues {
  source_type: IngestionSourceType;
  name: string;
  description: string;
  // Type-specific identity fields — only the ones matching `source_type` are sent.
  channel_id: string;
  lookback_days: string;
  include_bots: boolean;
  confluence_url: string;
  space_key: string;
  project_key: string;
  source_slug: string;
  jql: string;
  include_comments: boolean;
  url: string;
  space_id: string;
  // Shared mutable fields.
  default_chunk_size: number;
  default_chunk_overlap: number;
  reload_interval: number;
  owner_team_slug: string;
  shared_with_teams: string[];
}

function emptyValues(): IngestionSourceFormValues {
  return {
    source_type: "slack_channel",
    name: "",
    description: "",
    channel_id: "",
    lookback_days: "",
    include_bots: false,
    confluence_url: "",
    space_key: "",
    project_key: "",
    source_slug: "",
    jql: "",
    include_comments: false,
    url: "",
    space_id: "",
    default_chunk_size: DEFAULT_CHUNK_SIZE,
    default_chunk_overlap: DEFAULT_CHUNK_OVERLAP,
    reload_interval: DEFAULT_RELOAD_INTERVAL,
    owner_team_slug: "",
    shared_with_teams: [],
  };
}

function valuesFromSource(source: IngestionSourceConfig): IngestionSourceFormValues {
  const base = emptyValues();
  return {
    ...base,
    source_type: source.source_type,
    name: source.name,
    description: source.description ?? "",
    channel_id: "channel_id" in source ? source.channel_id : "",
    lookback_days:
      "lookback_days" in source && source.lookback_days !== undefined
        ? String(source.lookback_days)
        : "",
    include_bots: "include_bots" in source ? Boolean(source.include_bots) : false,
    confluence_url: "confluence_url" in source ? source.confluence_url : "",
    space_key: "space_key" in source ? source.space_key : "",
    project_key: "project_key" in source ? source.project_key : "",
    source_slug: "source_slug" in source ? source.source_slug : "",
    jql: "jql" in source ? source.jql : "",
    include_comments: "include_comments" in source ? Boolean(source.include_comments) : false,
    url: "url" in source ? source.url : "",
    space_id: "space_id" in source ? source.space_id : "",
    default_chunk_size: source.default_chunk_size,
    default_chunk_overlap: source.default_chunk_overlap,
    reload_interval: source.reload_interval,
    owner_team_slug: source.owner_team_slug ?? "",
    shared_with_teams: source.shared_with_teams ?? [],
  };
}

/** Payload sent to POST/PATCH — only fields relevant to the action + type. */
function buildPayload(values: IngestionSourceFormValues, isEdit: boolean): Record<string, unknown> {
  const shared = {
    name: values.name.trim(),
    description: values.description.trim(),
    default_chunk_size: values.default_chunk_size,
    default_chunk_overlap: values.default_chunk_overlap,
    reload_interval: values.reload_interval,
    shared_with_teams: values.shared_with_teams,
  };

  if (isEdit) {
    // IMMUTABLE_FIELDS (source_type + identity fields) must never be sent on
    // PATCH — the API 400s on any attempted change.
    switch (values.source_type) {
      case "slack_channel":
        return { ...shared, lookback_days: numberOrUndefined(values.lookback_days), include_bots: values.include_bots };
      case "jira_project":
        return { ...shared, jql: values.jql.trim(), include_comments: values.include_comments };
      default:
        return shared;
    }
  }

  const create: Record<string, unknown> = {
    ...shared,
    source_type: values.source_type,
    owner_team_slug: values.owner_team_slug.trim(),
  };
  switch (values.source_type) {
    case "slack_channel":
      create.channel_id = values.channel_id.trim();
      create.lookback_days = numberOrUndefined(values.lookback_days);
      create.include_bots = values.include_bots;
      break;
    case "confluence_space":
      create.confluence_url = values.confluence_url.trim();
      create.space_key = values.space_key.trim();
      break;
    case "jira_project":
      create.project_key = values.project_key.trim();
      create.source_slug = values.source_slug.trim();
      create.jql = values.jql.trim();
      create.include_comments = values.include_comments;
      break;
    case "web_url":
      create.url = values.url.trim();
      break;
    case "webex_space":
      create.space_id = values.space_id.trim();
      break;
  }
  return create;
}

function numberOrUndefined(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function identityFieldsValid(values: IngestionSourceFormValues): boolean {
  switch (values.source_type) {
    case "slack_channel":
      return values.channel_id.trim().length > 0;
    case "confluence_space":
      return values.confluence_url.trim().length > 0 && values.space_key.trim().length > 0;
    case "jira_project":
      return values.project_key.trim().length > 0 && values.source_slug.trim().length > 0;
    case "web_url":
      return values.url.trim().length > 0;
    case "webex_space":
      return values.space_id.trim().length > 0;
    default:
      return false;
  }
}

export interface IngestionSourceFormProps {
  open: boolean;
  onClose: () => void;
  onSave: (payload: Record<string, unknown>) => Promise<void>;
  initial?: IngestionSourceConfig | null;
}

export function IngestionSourceForm({ open, onClose, onSave, initial }: IngestionSourceFormProps) {
  const isEdit = Boolean(initial);
  const [values, setValues] = useState<IngestionSourceFormValues>(
    initial ? valuesFromSource(initial) : emptyValues(),
  );
  const [availableTeams, setAvailableTeams] = useState<TeamRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setValues(initial ? valuesFromSource(initial) : emptyValues());
    setSaving(false);
    setError(null);

    fetch("/api/dynamic-agents/teams")
      .then((res) => res.json())
      .then((data: { success?: boolean; data?: TeamRow[] }) => {
        if (data?.success && Array.isArray(data.data)) setAvailableTeams(data.data);
      })
      .catch(() => {});
  }, [open, initial]);

  const canSave =
    values.name.trim().length > 0 &&
    (isEdit || (identityFieldsValid(values) && values.owner_team_slug.trim().length > 0));

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave(buildPayload(values, isEdit));
    } catch (err) {
      const serverMessage = err instanceof RagApiError ? err.serverMessage : undefined;
      setError(serverMessage || "Could not save the source. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Ingestion Source" : "New Ingestion Source"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="source-type">Source Type</Label>
            <select
              id="source-type"
              value={values.source_type}
              onChange={(e) =>
                setValues((v) => ({ ...v, source_type: e.target.value as IngestionSourceType }))
              }
              disabled={isEdit}
              className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
              {SOURCE_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="source-name">
              Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="source-name"
              value={values.name}
              onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
              placeholder="e.g. Platform Team Slack Channel"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="source-description">Description</Label>
            <Input
              id="source-description"
              value={values.description}
              onChange={(e) => setValues((v) => ({ ...v, description: e.target.value }))}
              placeholder="Optional description"
            />
          </div>

          {/* Type-specific identity fields — immutable once created. */}
          {values.source_type === "slack_channel" && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="channel-id">
                  Channel ID {!isEdit && <span className="text-destructive">*</span>}
                </Label>
                <Input
                  id="channel-id"
                  value={values.channel_id}
                  onChange={(e) => setValues((v) => ({ ...v, channel_id: e.target.value }))}
                  disabled={isEdit}
                  placeholder="e.g. C0123456789"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lookback-days">Lookback Days</Label>
                <Input
                  id="lookback-days"
                  type="number"
                  value={values.lookback_days}
                  onChange={(e) => setValues((v) => ({ ...v, lookback_days: e.target.value }))}
                  placeholder="Optional"
                />
              </div>
              <BoolToggle
                label="Include bot messages"
                checked={values.include_bots}
                disabled={saving}
                onChange={(checked) => setValues((v) => ({ ...v, include_bots: checked }))}
              />
            </>
          )}

          {values.source_type === "confluence_space" && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="confluence-url">
                  Confluence URL {!isEdit && <span className="text-destructive">*</span>}
                </Label>
                <Input
                  id="confluence-url"
                  value={values.confluence_url}
                  onChange={(e) => setValues((v) => ({ ...v, confluence_url: e.target.value }))}
                  disabled={isEdit}
                  placeholder="https://example.atlassian.net/wiki"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="space-key">
                  Space Key {!isEdit && <span className="text-destructive">*</span>}
                </Label>
                <Input
                  id="space-key"
                  value={values.space_key}
                  onChange={(e) => setValues((v) => ({ ...v, space_key: e.target.value }))}
                  disabled={isEdit}
                  placeholder="e.g. ENG"
                />
              </div>
            </>
          )}

          {values.source_type === "jira_project" && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="project-key">
                  Project Key {!isEdit && <span className="text-destructive">*</span>}
                </Label>
                <Input
                  id="project-key"
                  value={values.project_key}
                  onChange={(e) => setValues((v) => ({ ...v, project_key: e.target.value }))}
                  disabled={isEdit}
                  placeholder="e.g. ENG"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="source-slug">
                  Source Slug {!isEdit && <span className="text-destructive">*</span>}
                </Label>
                <Input
                  id="source-slug"
                  value={values.source_slug}
                  onChange={(e) => setValues((v) => ({ ...v, source_slug: e.target.value }))}
                  disabled={isEdit}
                  placeholder="Immutable identifier — does not change if the name changes"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="jql">JQL</Label>
                <Input
                  id="jql"
                  value={values.jql}
                  onChange={(e) => setValues((v) => ({ ...v, jql: e.target.value }))}
                  placeholder="e.g. project = ENG AND status != Done"
                />
              </div>
              <BoolToggle
                label="Include comments"
                checked={values.include_comments}
                disabled={saving}
                onChange={(checked) => setValues((v) => ({ ...v, include_comments: checked }))}
              />
            </>
          )}

          {values.source_type === "web_url" && (
            <div className="space-y-1.5">
              <Label htmlFor="web-url">
                URL {!isEdit && <span className="text-destructive">*</span>}
              </Label>
              <Input
                id="web-url"
                value={values.url}
                onChange={(e) => setValues((v) => ({ ...v, url: e.target.value }))}
                disabled={isEdit}
                placeholder="https://example.com/docs"
              />
            </div>
          )}

          {values.source_type === "webex_space" && (
            <div className="space-y-1.5">
              <Label htmlFor="space-id">
                Space ID {!isEdit && <span className="text-destructive">*</span>}
              </Label>
              <Input
                id="space-id"
                value={values.space_id}
                onChange={(e) => setValues((v) => ({ ...v, space_id: e.target.value }))}
                disabled={isEdit}
                placeholder="e.g. Y2lzY29zcGFyazovL3VzL1JPT00v..."
              />
            </div>
          )}

          {/* Chunking / reload settings */}
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="chunk-size">Chunk Size</Label>
              <Input
                id="chunk-size"
                type="number"
                value={values.default_chunk_size}
                onChange={(e) =>
                  setValues((v) => ({ ...v, default_chunk_size: Number(e.target.value) }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="chunk-overlap">Chunk Overlap</Label>
              <Input
                id="chunk-overlap"
                type="number"
                value={values.default_chunk_overlap}
                onChange={(e) =>
                  setValues((v) => ({ ...v, default_chunk_overlap: Number(e.target.value) }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reload-interval">Reload Interval (s)</Label>
              <Input
                id="reload-interval"
                type="number"
                value={values.reload_interval}
                onChange={(e) =>
                  setValues((v) => ({ ...v, reload_interval: Number(e.target.value) }))
                }
              />
            </div>
          </div>

          {/* Ownership & sharing. Visibility is never rendered — it's
              server-controlled (team on create, global only via config seed). */}
          <TeamOwnershipFields
            ownerTeamSlug={values.owner_team_slug}
            sharedTeamSlugs={values.shared_with_teams}
            creatorSubject={initial?.creator_subject ?? null}
            isEditing={isEdit}
            ownerRequired={!isEdit}
            resourceNoun="ingestion source"
            disabled={saving}
            availableTeams={availableTeams
              .filter((t): t is TeamRow & { slug: string } => Boolean(t.slug))
              .map((t) => ({ slug: t.slug, name: t.name ?? t.slug, _id: t._id }))}
            currentUserTeamSlugs={availableTeams
              .map((t) => t.slug)
              .filter((s): s is string => Boolean(s))}
            onOwnerTeamChange={(slug) => setValues((v) => ({ ...v, owner_team_slug: slug }))}
            onSharedTeamsChange={(slugs) => setValues((v) => ({ ...v, shared_with_teams: slugs }))}
            shareHelpText={
              <>
                Teams you share with can read and manage this source, in
                addition to the owner team.
              </>
            }
          />
        </div>

        {error && (
          <div
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
          >
            {error}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving || !canSave}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {isEdit ? "Save Changes" : "Create Source"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface BoolToggleProps {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}

function BoolToggle({ label, checked, disabled, onChange }: BoolToggleProps) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border/50 p-3">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative w-9 shrink-0 rounded-full transition-colors",
          checked ? "bg-primary" : "bg-muted",
          disabled && "opacity-50 cursor-not-allowed",
        )}
        style={{ height: "20px" }}
      >
        <span
          className={cn(
            "absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow transition-all",
            checked ? "left-[calc(100%-16px)]" : "left-0.5",
          )}
        />
      </button>
      <Label className="cursor-pointer" onClick={() => !disabled && onChange(!checked)}>
        {label}
      </Label>
    </div>
  );
}

export default IngestionSourceForm;
