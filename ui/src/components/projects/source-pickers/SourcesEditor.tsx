"use client";

import { GitBranch } from "lucide-react";

import { ProviderLogo } from "@/components/credentials/provider-logo";
import type { ProjectSources } from "@/types/projects";
import {
  decodeWebexRoom,
  toWebexRoomSource,
  webexRoomToPickerValue,
} from "@/lib/projects/webex-room";
import { SourcePicker, type SourceKind } from "./index";

/**
 * The single, generic, config-driven sources surface, used everywhere a
 * project's GitHub / Confluence / Webex sources are defined (create wizard,
 * project editing, ingest). The connectors shown are driven entirely by the
 * onboarding YAML via `useProjectSourceKinds()`; each renders the same rich
 * per-connector picker (live `/source-options`, search, manual add). Speaks the
 * canonical `ProjectSources` shape so every call site shares one data contract.
 */

const LABELS: Record<SourceKind, string> = {
  github: "GitHub repos",
  confluence: "Confluence space",
  webex: "Webex",
};

/** Source kind → credentials provider id (for the shared ProviderLogo). */
const PROVIDER_FOR_KIND: Record<SourceKind, string> = {
  github: "github",
  confluence: "atlassian",
  webex: "webex",
};

/** Canonical ProjectSources ↔ per-connector string[] (the picker contract). */
function valueFor(kind: SourceKind, sources: ProjectSources): string[] {
  if (kind === "github") return sources.repos ?? [];
  if (kind === "confluence")
    return sources.confluence_url ? [sources.confluence_url] : [];
  if (kind === "webex")
    return (sources.webex_rooms ?? []).map(webexRoomToPickerValue);
  return [];
}

function applyTo(
  kind: SourceKind,
  next: string[],
  sources: ProjectSources,
): ProjectSources {
  if (kind === "github") return { ...sources, repos: next };
  if (kind === "confluence")
    return { ...sources, confluence_url: next[0] ?? "" };
  if (kind === "webex")
    return { ...sources, webex_rooms: next.map(toWebexRoomSource) };
  return sources;
}

function repoUrl(repo: string): string {
  return /^https?:\/\//.test(repo)
    ? repo
    : `https://github.com/${repo.replace(/^\/+/, "")}`;
}

export interface SourcesEditorProps {
  kinds: SourceKind[];
  value: ProjectSources;
  onChange: (next: ProjectSources) => void;
  readOnly?: boolean;
}

export function SourcesEditor({
  kinds,
  value,
  onChange,
  readOnly = false,
}: SourcesEditorProps) {
  if (kinds.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No sources are configured for this deployment.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      {kinds.map((kind) =>
        readOnly ? (
          <div key={kind} className="space-y-2">
            <h4 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <ProviderLogo
                provider={PROVIDER_FOR_KIND[kind]}
                className="h-4 w-4 shrink-0 object-contain"
              />
              {LABELS[kind]}
            </h4>
            <ReadOnlyKind kind={kind} value={valueFor(kind, value)} />
          </div>
        ) : (
          // The picker renders its own bounded card + branded header — no
          // wrapper needed here (see SourceItemPicker.tsx).
          <SourcePicker
            key={kind}
            source={kind}
            selected={valueFor(kind, value)}
            onChange={(next) => onChange(applyTo(kind, next, value))}
          />
        ),
      )}
    </div>
  );
}

function ReadOnlyKind({ kind, value }: { kind: SourceKind; value: string[] }) {
  if (value.length === 0) {
    return <p className="text-sm text-muted-foreground">None attached.</p>;
  }
  if (kind === "github") {
    return (
      <ul className="space-y-1 text-sm">
        {value.map((r) => (
          <li key={r}>
            <a
              href={repoUrl(r)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-foreground hover:underline"
            >
              <GitBranch className="h-3.5 w-3.5 shrink-0" />
              {r.replace(/^https?:\/\/github\.com\//, "")}
            </a>
          </li>
        ))}
      </ul>
    );
  }
  if (kind === "webex") {
    return (
      <ul className="space-y-1 text-sm">
        {value.map((v) => {
          const { room_id, name } = decodeWebexRoom(v);
          return (
            <li key={room_id} className="break-all text-foreground">
              {name}
            </li>
          );
        })}
      </ul>
    );
  }
  // confluence: single URL or plain value(s)
  return (
    <ul className="space-y-1 text-sm">
      {value.map((v) => (
        <li key={v}>
          {/^https?:\/\//.test(v) ? (
            <a
              href={v}
              target="_blank"
              rel="noopener noreferrer"
              className="break-all text-foreground hover:underline"
            >
              {v}
            </a>
          ) : (
            <span className="break-all text-foreground">{v}</span>
          )}
        </li>
      ))}
    </ul>
  );
}
