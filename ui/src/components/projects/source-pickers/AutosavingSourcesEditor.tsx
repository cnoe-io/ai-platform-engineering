"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Loader2, TriangleAlert } from "lucide-react";

import type { ProjectDocument, ProjectSources } from "@/types/projects";
import type { SourceKind } from "./index";
import { SourcesEditor } from "./SourcesEditor";

const AUTOSAVE_DELAY_MS = 800;

type SaveStatus = "idle" | "pending" | "saving" | "saved" | "error";

function sourcesPayload(sources: ProjectSources): Record<string, unknown> {
  return {
    ...sources,
    repos: (sources.repos ?? []).map((repo) => repo.trim()).filter(Boolean),
    confluence_url: (sources.confluence_url ?? "").trim(),
    confluence_page_scopes: sources.confluence_page_scopes ?? [],
    confluence_page_scope: sources.confluence_page_scope ?? null,
  };
}

export function AutosavingSourcesEditor({
  slug,
  kinds,
  value,
  onChange,
  onSaved,
  onDirtyChange,
}: {
  slug: string;
  kinds: SourceKind[];
  value: ProjectSources;
  onChange: (next: ProjectSources) => void;
  onSaved?: (project: ProjectDocument) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [saveError, setSaveError] = useState("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestSourcesRef = useRef(value);
  const versionRef = useRef(0);

  useEffect(() => {
    latestSourcesRef.current = value;
  }, [value]);

  const persist = useCallback(
    async (next: ProjectSources, version: number) => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setStatus("saving");
      setSaveError("");
      try {
        const response = await fetch(
          `/api/projects/${encodeURIComponent(slug)}`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ sources: sourcesPayload(next) }),
          },
        );
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(body.error ?? `Save failed (${response.status})`);
        }
        if (version === versionRef.current) {
          setStatus("saved");
          onDirtyChange?.(false);
          onSaved?.(body.data.project as ProjectDocument);
        }
      } catch (error) {
        if (version === versionRef.current) {
          onDirtyChange?.(true);
          setSaveError(
            error instanceof Error ? error.message : String(error),
          );
          setStatus("error");
        }
      }
    },
    [onDirtyChange, onSaved, slug],
  );

  const queueSave = useCallback(
    (next: ProjectSources) => {
      onChange(next);
      onDirtyChange?.(true);
      latestSourcesRef.current = next;
      versionRef.current += 1;
      const version = versionRef.current;
      setStatus("pending");
      setSaveError("");
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        void persist(next, version);
      }, AUTOSAVE_DELAY_MS);
    },
    [onChange, onDirtyChange, persist],
  );

  const flushPendingSave = useCallback(() => {
    if (!timerRef.current) return;
    clearTimeout(timerRef.current);
    timerRef.current = null;
    void persist(latestSourcesRef.current, versionRef.current);
  }, [persist]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  return (
    <div
      data-testid="autosaving-sources-editor"
      onBlurCapture={(event) => {
        const nextTarget = event.relatedTarget;
        if (
          !nextTarget ||
          !(nextTarget instanceof Node) ||
          !event.currentTarget.contains(nextTarget)
        ) {
          flushPendingSave();
        }
      }}
    >
      <SourcesEditor kinds={kinds} value={value} onChange={queueSave} />
      <div
        role="status"
        aria-live="polite"
        className="mt-3 flex min-h-5 items-center gap-1.5 text-xs text-muted-foreground"
      >
        {status === "saving" ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Saving source selections…
          </>
        ) : status === "saved" ? (
          <>
            <Check className="h-3.5 w-3.5 text-emerald-500" />
            Source selections saved
          </>
        ) : status === "error" ? (
          <>
            <TriangleAlert className="h-3.5 w-3.5 text-destructive" />
            <span className="text-destructive">
              Could not save source selections: {saveError}
            </span>
            <button
              type="button"
              onClick={() =>
                void persist(latestSourcesRef.current, versionRef.current)
              }
              className="font-medium text-foreground underline underline-offset-2"
            >
              Retry
            </button>
          </>
        ) : status === "pending" ? (
          "Source changes pending…"
        ) : (
          "Source selections save automatically."
        )}
      </div>
    </div>
  );
}
