"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ExternalLink,
  ListChecks,
  Loader2,
  Minus,
  Plus,
  Search,
} from "lucide-react";

import { BetaBadge } from "@/components/tome/BetaBadge";
import { PanelShell } from "@/components/tome/PanelHeader";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

const SEARCH_DEBOUNCE_MS = 300;
const SEARCH_RESULT_LIMIT = 20;
const TRACKED_ISSUE_LABELS = ["tome-tracker", "decision", "critical"] as const;
const STEWARD_CREDENTIAL_ERROR_CODES = new Set([
  "TOME_STEWARD_GITHUB_CREDENTIAL_REQUIRED",
  "TOME_STEWARD_GITHUB_CREDENTIAL_INVALID",
  "TOME_STEWARD_GITHUB_WRITE_DENIED",
]);

interface GitHubIssue {
  repo: string;
  number: number;
  title: string;
  url: string;
  state: "open" | "closed";
  labels: string[];
  updatedAt: string | null;
}

interface IssuesPayload {
  issues: GitHubIssue[];
  credentialConfigured: boolean;
  writeCredentialConfigured?: boolean;
  writeCredentialOwner?: string | null;
}

class ApiRequestError extends Error {
  code?: string;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new ApiRequestError(
      body?.error ?? `Request failed (${response.status})`,
    );
    error.code = body?.code;
    throw error;
  }
  if (!body || typeof body !== "object" || !("data" in body)) {
    throw new ApiRequestError("The server returned an invalid response");
  }
  return body.data as T;
}

function issueKey(issue: Pick<GitHubIssue, "repo" | "number">): string {
  return `${issue.repo.toLowerCase()}#${issue.number}`;
}

function labelTitle(label: string): string {
  if (label === "tome-tracker") return "Tome Tracker";
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function GithubIssueLabelManager({
  slug,
  canEdit,
}: {
  slug: string;
  canEdit: boolean;
}) {
  const [query, setQuery] = useState("");
  const [payload, setPayload] = useState<IssuesPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [updatingKeys, setUpdatingKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const normalizedQuery = query.trim();

  useEffect(() => {
    if (normalizedQuery.length < 2) {
      setPayload(null);
      setLoading(false);
      setError(null);
      setErrorCode(null);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      setErrorCode(null);
      try {
        const params = new URLSearchParams({
          content_type: "issue",
          q: normalizedQuery,
          limit: String(SEARCH_RESULT_LIMIT),
        });
        const result = await fetchJson<IssuesPayload>(
          `/api/tome/projects/${encodeURIComponent(slug)}/github-issues?${params}`,
          { signal: controller.signal },
        );
        setPayload(result);
      } catch (caught) {
        if (controller.signal.aborted) return;
        setPayload(null);
        setError(caught instanceof Error ? caught.message : "Could not search issues");
        setErrorCode(caught instanceof ApiRequestError ? (caught.code ?? null) : null);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [normalizedQuery, slug]);

  const canManageLabels = canEdit && payload?.writeCredentialConfigured !== false;

  const updateIssueLabel = useCallback(
    async (issue: GitHubIssue, label: string, operation: "add" | "remove") => {
      const key = issueKey(issue);
      if (!canManageLabels || updatingKeys.has(key)) return;

      const normalizedLabel = label.toLowerCase();
      const optimisticLabels = operation === "add"
        ? issue.labels.some((candidate) => candidate.toLowerCase() === normalizedLabel)
          ? issue.labels
          : [...issue.labels, label]
        : issue.labels.filter(
            (candidate) => candidate.toLowerCase() !== normalizedLabel,
          );

      setError(null);
      setErrorCode(null);
      setUpdatingKeys((current) => new Set(current).add(key));
      setPayload((current) => current
        ? {
            ...current,
            issues: current.issues.map((candidate) =>
              issueKey(candidate) === key
                ? { ...candidate, labels: optimisticLabels }
                : candidate,
            ),
          }
        : current);

      try {
        const result = await fetchJson<{ issue: GitHubIssue }>(
          `/api/tome/projects/${encodeURIComponent(slug)}/github-issues`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              repo: issue.repo,
              number: issue.number,
              label,
              operation,
            }),
          },
        );
        setPayload((current) => current
          ? {
              ...current,
              issues: current.issues.map((candidate) =>
                issueKey(candidate) === key ? result.issue : candidate,
              ),
            }
          : current);
      } catch (caught) {
        setPayload((current) => current
          ? {
              ...current,
              issues: current.issues.map((candidate) =>
                issueKey(candidate) === key ? issue : candidate,
              ),
            }
          : current);
        setError(
          caught instanceof Error
            ? `Could not ${operation} ${label} on ${issue.repo} #${issue.number}: ${caught.message}`
            : `Could not ${operation} ${label} on ${issue.repo} #${issue.number}`,
        );
        setErrorCode(caught instanceof ApiRequestError ? (caught.code ?? null) : null);
      } finally {
        setUpdatingKeys((current) => {
          const next = new Set(current);
          next.delete(key);
          return next;
        });
      }
    },
    [canManageLabels, slug, updatingKeys],
  );

  const resultCount = payload?.issues.length ?? 0;
  const credentialMessage = useMemo(() => {
    if (!payload || payload.writeCredentialConfigured !== false || !canEdit) return null;
    return payload.writeCredentialOwner
      ? `The data steward ${payload.writeCredentialOwner} must authorize GitHub`
      : "Assign a user data steward and authorize GitHub";
  }, [canEdit, payload]);

  return (
    <PanelShell
      maxWidthClassName="max-w-5xl"
      contentClassName="space-y-4 p-4 sm:p-5"
      title="Issues"
      titleAccessory={<BetaBadge />}
      description="Search cached GitHub issues and manage TOME labels."
    >
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by title, number, repository, or label…"
          className="pl-9"
          aria-label="Search GitHub issues"
        />
        {loading && (
          <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
      </div>

      {credentialMessage && (
        <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            {credentialMessage} in{" "}
            <Link href="/credentials" className="font-medium underline">
              Connected Credentials
            </Link>{" "}
            before labels can be changed.
          </p>
        </div>
      )}

      {error && (
        <p className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">
          {error}.{" "}
          {errorCode && STEWARD_CREDENTIAL_ERROR_CODES.has(errorCode) && (
            <Link href="/credentials" className="font-medium underline">
              Open Connected Credentials
            </Link>
          )}
        </p>
      )}

      {normalizedQuery.length < 2 ? (
        <div className="rounded-xl border border-dashed py-14 text-center">
          <ListChecks className="mx-auto h-8 w-8 text-muted-foreground/50" />
          <p className="mt-3 text-sm font-medium">Search for an issue to manage labels</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Issues are not loaded until you enter at least two characters.
          </p>
        </div>
      ) : !loading && payload && resultCount === 0 ? (
        <div className="rounded-xl border border-dashed py-14 text-center text-sm text-muted-foreground">
          No GitHub issues match “{normalizedQuery}”.
        </div>
      ) : payload && resultCount > 0 ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            {resultCount === SEARCH_RESULT_LIMIT ? "First 20 matches" : `${resultCount} match${resultCount === 1 ? "" : "es"}`}
          </p>
          {payload.issues.map((issue) => {
            const key = issueKey(issue);
            const pending = updatingKeys.has(key);
            const availableLabels = TRACKED_ISSUE_LABELS.filter(
              (label) => !issue.labels.some(
                (candidate) => candidate.toLowerCase() === label,
              ),
            );
            const removableLabels = issue.labels.filter((label) =>
              TRACKED_ISSUE_LABELS.some(
                (tracked) => tracked === label.toLowerCase(),
              ),
            );
            return (
              <article
                key={key}
                className="flex flex-col gap-3 rounded-lg border bg-card p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <a
                    href={issue.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex max-w-full items-center gap-1.5 font-medium hover:underline"
                  >
                    <span className="truncate">{issue.title}</span>
                    <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                  </a>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {issue.repo} #{issue.number} · {issue.state}
                  </p>
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                  {issue.labels.map((label) => (
                    <span
                      key={label}
                      className="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground"
                    >
                      {label}
                    </span>
                  ))}
                  {canManageLabels && removableLabels.length > 0 && (
                    <Popover>
                      <PopoverTrigger asChild>
                          <button
                            type="button"
                            disabled={pending}
                            aria-label={`Remove label from ${issue.title}`}
                            title="Remove tracked label"
                            className="inline-flex h-6 w-6 items-center justify-center rounded-full border text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                          >
                            {pending ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Minus className="h-3 w-3" />
                            )}
                          </button>
                      </PopoverTrigger>
                      <PopoverContent align="end" className="w-48 p-1">
                        {removableLabels.map((label) => (
                          <button
                            key={label}
                            type="button"
                            onClick={() => void updateIssueLabel(issue, label, "remove")}
                            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted"
                          >
                            <Minus className="h-3 w-3" />
                            {labelTitle(label)}
                          </button>
                        ))}
                      </PopoverContent>
                    </Popover>
                  )}
                  {canManageLabels && availableLabels.length > 0 && (
                    <Popover>
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          disabled={pending}
                          aria-label={`Add label to ${issue.title}`}
                          title="Add tracked label"
                          className="inline-flex h-6 w-6 items-center justify-center rounded-full border text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                        >
                          {pending ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Plus className="h-3 w-3" />
                          )}
                        </button>
                      </PopoverTrigger>
                      <PopoverContent align="end" className="w-48 p-1">
                        {availableLabels.map((label) => (
                          <button
                            key={label}
                            type="button"
                            onClick={() => void updateIssueLabel(issue, label, "add")}
                            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted"
                          >
                            <Plus className="h-3 w-3" />
                            {labelTitle(label)}
                          </button>
                        ))}
                      </PopoverContent>
                    </Popover>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      ) : null}
    </PanelShell>
  );
}
