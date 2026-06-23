"use client";

import type { ComponentType } from "react";
import { GithubRepoPicker } from "./GithubRepoPicker";
import { ConfluenceSpacePicker } from "./ConfluenceSpacePicker";
import { WebexRoomsPicker } from "./WebexRoomsPicker";

/** The connectors a project can draw sources from (YAML `source:` values). */
export type SourceKind = "github" | "confluence" | "webex";

export interface SourcePickerProps {
  /** Selected values (github: repo URLs/refs; confluence: a single space URL; webex: room IDs). */
  selected: string[];
  onChange: (next: string[]) => void;
}

/** Each connector gets its own picker UX, keyed by the step's `source`. */
const REGISTRY: Record<string, ComponentType<SourcePickerProps>> = {
  github: GithubRepoPicker,
  confluence: ConfluenceSpacePicker,
  webex: WebexRoomsPicker,
};

/** Renders the right per-connector picker for a `source` onboarding step. */
export function SourcePicker({
  source,
  selected,
  onChange,
}: { source?: string } & SourcePickerProps) {
  const Comp = source ? REGISTRY[source] : undefined;
  if (!Comp) {
    return (
      <div className="rounded-lg border border-dashed border-border/60 bg-muted/20 p-4 text-sm text-muted-foreground">
        {`No picker for source "${source ?? "?"}".`}
      </div>
    );
  }
  return <Comp selected={selected} onChange={onChange} />;
}
