"use client";

import Link from "next/link";
import {
  type KeyboardEvent,
  type MouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AlertCircle,
  AlertTriangle,
  ExternalLink,
  GripVertical,
  HelpCircle,
  ListFilter,
  Loader2,
  MessagesSquare,
  Minus,
  Plus,
  RefreshCw,
  Search,
  X,
} from "lucide-react";

import { BetaBadge } from "@/components/tome/BetaBadge";
import { PanelShell } from "@/components/tome/PanelHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  emptyIssueFilters,
  hasIssueFilters,
  ISSUE_FILTER_NONE,
  issueFiltersForLabel,
  normalizeIssueFilters,
  type IssueFilters,
} from "@/lib/tome/issue-filter-views";
import {
  useAgenticSdlcStream,
  type AgenticSdlcStreamMessage,
} from "@/hooks/use-agentic-sdlc-stream";
import { cn } from "@/lib/utils";

type IssueStatus = "open" | "in_progress" | "resolved";
type IssuePriority = "critical" | "high" | "medium" | "low";
const ISSUE_LIVE_REFRESH_MS = 10_000;
const ISSUE_LIVE_EVENT_DEBOUNCE_MS = 400;
const TRACKED_ISSUE_LABELS = ["tome-tracker", "decision", "critical"] as const;

interface GitHubIssue {
  contentType?: "issue" | "discussion";
  repo: string;
  number: number;
  title: string;
  body: string | null;
  url: string;
  state: "open" | "closed";
  stateReason: string | null;
  displayStatus: IssueStatus;
  priority: IssuePriority | null;
  labels: string[];
  assignees: string[];
  author: string | null;
  milestone: string | null;
  category?: string | null;
  updatedAt: string | null;
}

interface IssuesPayload {
  issues: GitHubIssue[];
  credentialConfigured: boolean;
  writeCredentialConfigured?: boolean;
  writeCredentialOwner?: string | null;
  repos: string[];
  rollupProjectSlugs: string[];
  cache?: {
    source: "mongodb";
    stale: boolean;
    lastSynchronizedAt: string | null;
    errors: string[];
  };
}

interface IssueMutationPayload {
  issue: GitHubIssue;
  warning?: string;
  warningCode?: string;
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

function issueSummary(markdown: string | null): string {
  if (!markdown) return "";
  return markdown
    .replace(/<!--(?:.|\n)*?-->/g, "")
    .replace(/[#>*_`[\]]/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);
}

const STATUS_COLUMNS: Array<{
  status: IssueStatus;
  label: string;
  dot: string;
}> = [
  { status: "open", label: "Open", dot: "bg-green-500" },
  { status: "in_progress", label: "In progress", dot: "bg-amber-500" },
  { status: "resolved", label: "Resolved", dot: "bg-purple-500" },
];

const PRIORITY_STYLES: Record<IssuePriority, string> = {
  critical:
    "border-red-300 bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300",
  high: "border-orange-300 bg-orange-50 text-orange-700 dark:bg-orange-950/30 dark:text-orange-300",
  medium:
    "border-yellow-300 bg-yellow-50 text-yellow-700 dark:bg-yellow-950/30 dark:text-yellow-300",
  low: "border-slate-300 bg-slate-50 text-slate-700 dark:bg-slate-950/30 dark:text-slate-300",
};

const STEWARD_CREDENTIAL_ERROR_CODES = new Set([
  "TOME_STEWARD_GITHUB_CREDENTIAL_REQUIRED",
  "TOME_STEWARD_GITHUB_CREDENTIAL_INVALID",
  "TOME_STEWARD_GITHUB_WRITE_DENIED",
  "TOME_STEWARD_GITHUB_PROJECT_WRITE_DENIED",
]);

function sortedUnique(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort(
    (left, right) => left.localeCompare(right),
  );
}

function isMissingOption(current: string, options: string[]): boolean {
  return current !== "all" &&
    current !== ISSUE_FILTER_NONE &&
    !options.includes(current);
}

function issueKey(
  issue: Pick<GitHubIssue, "repo" | "number" | "contentType">,
): string {
  const type = issue.contentType === "discussion"
    ? "discussion"
    : "issue";
  return `${issue.repo.toLowerCase()}:${type}#${issue.number}`;
}

function secondaryFilterCount(filters: IssueFilters): number {
  return [
    filters.state,
    filters.contentType,
    filters.repository,
    filters.label,
    filters.assignee,
    filters.author,
    filters.milestone,
    filters.priority,
  ].filter((value) => value !== "all").length;
}

export function GithubIssuesPanel({
  slug,
  canEdit,
  initialLabel,
  initialFilters,
  title,
  onLabelsLoaded,
}: {
  slug: string;
  canEdit: boolean;
  initialLabel?: string;
  initialFilters?: IssueFilters;
  title?: string;
  onLabelsLoaded?: (labels: string[]) => void;
}) {
  const startingFilters = normalizeIssueFilters(
    initialFilters ?? (initialLabel ? issueFiltersForLabel(initialLabel) : undefined),
  );
  const pinnedLabel = initialLabel && !initialFilters ? initialLabel : undefined;
  const [payload, setPayload] = useState<IssuesPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [warningCode, setWarningCode] = useState<string | null>(null);
  const [query, setQuery] = useState(startingFilters.query);
  const [repoFilter, setRepoFilter] = useState(startingFilters.repository);
  const [contentTypeFilter, setContentTypeFilter] = useState(
    startingFilters.contentType,
  );
  const [stateFilter, setStateFilter] = useState(startingFilters.state);
  const [labelFilter, setLabelFilter] = useState(startingFilters.label);
  const [assigneeFilter, setAssigneeFilter] = useState(startingFilters.assignee);
  const [authorFilter, setAuthorFilter] = useState(startingFilters.author);
  const [milestoneFilter, setMilestoneFilter] = useState(startingFilters.milestone);
  const [priorityFilter, setPriorityFilter] = useState(startingFilters.priority);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [movingIssueKeys, setMovingIssueKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const [updatingLabelKeys, setUpdatingLabelKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const [draggedIssueKey, setDraggedIssueKey] = useState<string | null>(null);
  const [dragOverStatus, setDragOverStatus] = useState<IssueStatus | null>(null);
  const dragSourceRef = useRef<string | null>(null);
  const movingIssueKeysRef = useRef(movingIssueKeys);
  const liveRefreshTimerRef = useRef<number | null>(null);
  const liveConnectedRef = useRef(false);

  useEffect(() => {
    movingIssueKeysRef.current = movingIssueKeys;
  }, [movingIssueKeys]);

  const load = useCallback(
    async (options?: { refresh?: boolean; silent?: boolean }) => {
      const silent = Boolean(options?.silent);
      if (!silent) {
        if (!payload) setLoading(true);
        setRefreshing(Boolean(options?.refresh));
        setError(null);
        setErrorCode(null);
        setWarning(null);
        setWarningCode(null);
      }
      try {
        const suffix = options?.refresh ? "?refresh=1" : "";
        setPayload(
          await fetchJson<IssuesPayload>(
            `/api/tome/projects/${encodeURIComponent(slug)}/github-issues${suffix}`,
          ),
        );
      } catch (err) {
        if (!silent) {
          setError(
            err instanceof Error ? err.message : "Failed to load GitHub issues",
          );
          setErrorCode(err instanceof ApiRequestError ? (err.code ?? null) : null);
        }
      } finally {
        if (!silent) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [payload, slug],
  );

  useEffect(() => {
    void load();
    // The initial load is intentionally keyed only by project slug. Including
    // payload would refetch after every response.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  useEffect(() => {
    const syncFromCache = () => {
      if (
        document.visibilityState === "visible" &&
        movingIssueKeysRef.current.size === 0
      ) {
        void load({ silent: true });
      }
    };
    const timer = window.setInterval(syncFromCache, ISSUE_LIVE_REFRESH_MS);
    window.addEventListener("focus", syncFromCache);
    document.addEventListener("visibilitychange", syncFromCache);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", syncFromCache);
      document.removeEventListener("visibilitychange", syncFromCache);
    };
  }, [load]);

  const scheduleLiveRefresh = useCallback(() => {
    if (liveRefreshTimerRef.current !== null) {
      window.clearTimeout(liveRefreshTimerRef.current);
    }
    liveRefreshTimerRef.current = window.setTimeout(() => {
      liveRefreshTimerRef.current = null;
      if (movingIssueKeysRef.current.size === 0) {
        void load({ silent: true });
      }
    }, ISSUE_LIVE_EVENT_DEBOUNCE_MS);
  }, [load]);

  useEffect(() => {
    liveConnectedRef.current = false;
    return () => {
      if (liveRefreshTimerRef.current !== null) {
        window.clearTimeout(liveRefreshTimerRef.current);
        liveRefreshTimerRef.current = null;
      }
    };
  }, [slug]);

  const handleLiveIssueEvent = useCallback(
    (message: AgenticSdlcStreamMessage) => {
      if (message.event === "github_issue_updated") {
        scheduleLiveRefresh();
      } else if (message.event === "connected") {
        // The first connection races with the panel's initial load. A later
        // connected event means EventSource reconnected, so refresh once to
        // cover any generations missed while the stream was unavailable.
        if (liveConnectedRef.current) scheduleLiveRefresh();
        else liveConnectedRef.current = true;
      }
    },
    [scheduleLiveRefresh],
  );
  useAgenticSdlcStream({
    url: `/api/tome/projects/${encodeURIComponent(slug)}/github-issues/events`,
    onEvent: handleLiveIssueEvent,
  });

  useEffect(() => {
    const next = normalizeIssueFilters(
      initialFilters ?? (initialLabel ? issueFiltersForLabel(initialLabel) : undefined),
    );
    setQuery(next.query);
    setRepoFilter(next.repository);
    setContentTypeFilter(next.contentType);
    setStateFilter(next.state);
    setLabelFilter(next.label);
    setAssigneeFilter(next.assignee);
    setAuthorFilter(next.author);
    setMilestoneFilter(next.milestone);
    setPriorityFilter(next.priority);
    setFiltersOpen(false);
  }, [initialFilters, initialLabel]);

  const issues = useMemo(() => payload?.issues ?? [], [payload?.issues]);
  const labels = useMemo(
    () => sortedUnique(issues.flatMap((issue) => issue.labels)),
    [issues],
  );
  useEffect(() => {
    onLabelsLoaded?.(labels);
  }, [labels, onLabelsLoaded]);
  const assignees = useMemo(
    () => sortedUnique(issues.flatMap((issue) => issue.assignees)),
    [issues],
  );
  const authors = useMemo(
    () => sortedUnique(issues.map((issue) => issue.author)),
    [issues],
  );
  const milestones = useMemo(
    () => sortedUnique(issues.map((issue) => issue.milestone)),
    [issues],
  );

  const filteredIssues = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return issues
      .filter(
        (issue) =>
          contentTypeFilter === "all" ||
          (issue.contentType ?? "issue") === contentTypeFilter,
      )
      .filter((issue) => repoFilter === "all" || issue.repo === repoFilter)
      .filter((issue) => stateFilter === "all" || issue.state === stateFilter)
      .filter((issue) => {
        if (labelFilter === "all") return true;
        if (labelFilter === ISSUE_FILTER_NONE) return issue.labels.length === 0;
        return issue.labels.some(
          (label) => label.toLowerCase() === labelFilter.toLowerCase(),
        );
      })
      .filter((issue) => {
        if (assigneeFilter === "all") return true;
        if (assigneeFilter === ISSUE_FILTER_NONE) return issue.assignees.length === 0;
        return issue.assignees.includes(assigneeFilter);
      })
      .filter((issue) => authorFilter === "all" || issue.author === authorFilter)
      .filter((issue) => {
        if (milestoneFilter === "all") return true;
        if (milestoneFilter === ISSUE_FILTER_NONE) return !issue.milestone;
        return issue.milestone === milestoneFilter;
      })
      .filter((issue) => {
        if (priorityFilter === "all") return true;
        if (priorityFilter === ISSUE_FILTER_NONE) return !issue.priority;
        return issue.priority === priorityFilter;
      })
      .filter((issue) => {
        if (!normalizedQuery) return true;
        return [
          issue.title,
          issue.body ?? "",
          issue.repo,
          String(issue.number),
          issue.category ?? "",
          issue.author ?? "",
          issue.milestone ?? "",
          ...issue.labels,
          ...issue.assignees,
        ].some((value) => value.toLowerCase().includes(normalizedQuery));
      });
  }, [
    assigneeFilter,
    authorFilter,
    contentTypeFilter,
    issues,
    labelFilter,
    milestoneFilter,
    priorityFilter,
    query,
    repoFilter,
    stateFilter,
  ]);

  const currentFilters = useMemo<IssueFilters>(() => ({
    query,
    contentType: contentTypeFilter,
    state: stateFilter,
    repository: repoFilter,
    label: labelFilter,
    assignee: assigneeFilter,
    author: authorFilter,
    milestone: milestoneFilter,
    priority: priorityFilter,
  }), [
    assigneeFilter,
    authorFilter,
    contentTypeFilter,
    labelFilter,
    milestoneFilter,
    priorityFilter,
    query,
    repoFilter,
    stateFilter,
  ]);

  const filtersApplied = hasIssueFilters(currentFilters);
  const activeSecondaryFilters = secondaryFilterCount(currentFilters);
  const canMoveIssues =
    canEdit && payload?.writeCredentialConfigured !== false;
  const clearFilters = () => {
    const cleared = pinnedLabel ? issueFiltersForLabel(pinnedLabel) : emptyIssueFilters();
    setQuery(cleared.query);
    setRepoFilter(cleared.repository);
    setContentTypeFilter(cleared.contentType);
    setStateFilter(cleared.state);
    setLabelFilter(cleared.label);
    setAssigneeFilter(cleared.assignee);
    setAuthorFilter(cleared.author);
    setMilestoneFilter(cleared.milestone);
    setPriorityFilter(cleared.priority);
    setFiltersOpen(false);
  };

  const finishIssueDrag = useCallback(() => {
    dragSourceRef.current = null;
    setDraggedIssueKey(null);
    setDragOverStatus(null);
  }, []);

  useEffect(() => {
    window.addEventListener("mouseup", finishIssueDrag);
    return () => window.removeEventListener("mouseup", finishIssueDrag);
  }, [finishIssueDrag]);

  const moveIssue = useCallback(
    async (issue: GitHubIssue, status: IssueStatus) => {
      const key = issueKey(issue);
      if (
        !canMoveIssues ||
        issue.displayStatus === status ||
        movingIssueKeys.has(key)
      ) {
        return;
      }

      setError(null);
      setErrorCode(null);
      setWarning(null);
      setWarningCode(null);
      setMovingIssueKeys((current) => new Set(current).add(key));
      setPayload((current) =>
        current
          ? {
              ...current,
              issues: current.issues.map((candidate) =>
                issueKey(candidate) === key
                  ? {
                      ...candidate,
                      displayStatus: status,
                      state: status === "resolved" ? "closed" : "open",
                      stateReason: status === "resolved" ? "completed" : null,
                    }
                  : candidate,
              ),
            }
          : current,
      );

      try {
        const result = await fetchJson<IssueMutationPayload>(
          `/api/tome/projects/${encodeURIComponent(slug)}/github-issues`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              repo: issue.repo,
              number: issue.number,
              status,
            }),
          },
        );
        setPayload((current) =>
          current
            ? {
                ...current,
                issues: current.issues.map((candidate) =>
                  issueKey(candidate) === key ? result.issue : candidate,
                ),
              }
            : current,
        );
        setWarning(result.warning ?? null);
        setWarningCode(result.warningCode ?? null);
      } catch (err) {
        setPayload((current) =>
          current
            ? {
                ...current,
                issues: current.issues.map((candidate) =>
                  issueKey(candidate) === key ? issue : candidate,
                ),
              }
            : current,
        );
        setError(
          err instanceof Error
            ? `Could not move ${issue.repo} #${issue.number}: ${err.message}`
            : `Could not move ${issue.repo} #${issue.number}`,
        );
        setErrorCode(err instanceof ApiRequestError ? (err.code ?? null) : null);
      } finally {
        setMovingIssueKeys((current) => {
          const next = new Set(current);
          next.delete(key);
          return next;
        });
      }
    },
    [canMoveIssues, movingIssueKeys, slug],
  );

  const updateIssueLabel = useCallback(
    async (
      issue: GitHubIssue,
      label: string,
      operation: "add" | "remove",
    ) => {
      const key = issueKey(issue);
      if (
        !canMoveIssues ||
        issue.contentType === "discussion" ||
        updatingLabelKeys.has(key)
      ) {
        return;
      }

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
      setWarning(null);
      setWarningCode(null);
      setUpdatingLabelKeys((current) => new Set(current).add(key));
      setPayload((current) =>
        current
          ? {
              ...current,
              issues: current.issues.map((candidate) =>
                issueKey(candidate) === key
                  ? { ...candidate, labels: optimisticLabels }
                  : candidate,
              ),
            }
          : current,
      );

      try {
        const result = await fetchJson<IssueMutationPayload>(
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
        setPayload((current) =>
          current
            ? {
                ...current,
                issues: current.issues.map((candidate) =>
                  issueKey(candidate) === key ? result.issue : candidate,
                ),
              }
            : current,
        );
      } catch (err) {
        setPayload((current) =>
          current
            ? {
                ...current,
                issues: current.issues.map((candidate) =>
                  issueKey(candidate) === key ? issue : candidate,
                ),
              }
            : current,
        );
        setError(
          err instanceof Error
            ? `Could not ${operation} ${label} on ${issue.repo} #${issue.number}: ${err.message}`
            : `Could not ${operation} ${label} on ${issue.repo} #${issue.number}`,
        );
        setErrorCode(err instanceof ApiRequestError ? (err.code ?? null) : null);
      } finally {
        setUpdatingLabelKeys((current) => {
          const next = new Set(current);
          next.delete(key);
          return next;
        });
      }
    },
    [canMoveIssues, slug, updatingLabelKeys],
  );

  const beginIssueDrag = useCallback(
    (event: MouseEvent<HTMLDivElement>, issue: GitHubIssue) => {
      const key = issueKey(issue);
      if (!canMoveIssues || event.button !== 0 || movingIssueKeys.has(key)) return;
      if (issue.contentType === "discussion") return;
      event.preventDefault();
      dragSourceRef.current = key;
      setDraggedIssueKey(key);
      setDragOverStatus(null);
    },
    [canMoveIssues, movingIssueKeys],
  );

  const markIssueDropTarget = useCallback(
    (status: IssueStatus) => {
      const key = dragSourceRef.current;
      if (!key) return;
      const source = payload?.issues.find((issue) => issueKey(issue) === key);
      setDragOverStatus(source?.displayStatus === status ? null : status);
    },
    [payload?.issues],
  );

  const dropIssueOnStatus = useCallback(
    (status: IssueStatus) => {
      const key = dragSourceRef.current;
      const source = payload?.issues.find((issue) => issueKey(issue) === key);
      if (source && source.displayStatus !== status) {
        void moveIssue(source, status);
      }
      finishIssueDrag();
    },
    [finishIssueDrag, moveIssue, payload?.issues],
  );

  const moveIssueWithKeyboard = useCallback(
    (event: KeyboardEvent<HTMLDivElement>, issue: GitHubIssue) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const sourceIndex = STATUS_COLUMNS.findIndex(
        (column) => column.status === issue.displayStatus,
      );
      const targetIndex = sourceIndex + (event.key === "ArrowLeft" ? -1 : 1);
      const target = STATUS_COLUMNS[targetIndex];
      if (target) void moveIssue(issue, target.status);
    },
    [moveIssue],
  );

  return (
    <PanelShell
      maxWidthClassName=""
      contentClassName="space-y-3 p-4 sm:p-5"
      title={title ?? "Issues"}
      titleAccessory={<BetaBadge />}
      description="GitHub is authoritative; TOME keeps a disposable cache."
      action={
        <div className="flex items-center gap-1">
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 text-muted-foreground"
                aria-label="About GitHub issues"
                title="About GitHub issues"
              >
                <HelpCircle className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 space-y-2 text-xs">
              <p className="text-sm font-medium">GitHub issues and discussions</p>
              <p className="text-muted-foreground">
                {filteredIssues.length} of {issues.length} items from{" "}
                {payload?.repos.length === 1
                  ? payload.repos[0]
                  : `${payload?.repos.length ?? 0} repositories`}.
              </p>
              <p className="text-muted-foreground">
                Open and closed items are shown by default. Filters apply to
                issues and discussions.
              </p>
              {canMoveIssues && (
                <p className="text-muted-foreground">
                  Drag an issue handle or focus it and press left or right arrow
                  to change status. Discussions are read-only.
                </p>
              )}
              {payload?.cache?.lastSynchronizedAt && (
                <p className="text-muted-foreground">
                  Last synchronized{" "}
                  {new Date(payload.cache.lastSynchronizedAt).toLocaleString()}.
                </p>
              )}
            </PopoverContent>
          </Popover>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load({ refresh: true })}
            disabled={refreshing}
            aria-label="Refresh from GitHub"
            title="Refresh from GitHub"
          >
            {refreshing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            <span className="hidden sm:inline">Refresh</span>
          </Button>
        </div>
      }
    >
      {payload && !payload.credentialConfigured && (
        <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            GitHub is not connected. Cached issues remain available, but refreshes
            require this project&apos;s data steward to authorize GitHub in{" "}
            <Link href="/credentials" className="font-medium underline">
              Connected Credentials
            </Link>
            .
          </p>
        </div>
      )}

      {payload?.cache?.stale && (
        <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Showing the last cached GitHub snapshot. A webhook or refresh sync
            could not be fully reconciled.
          </p>
        </div>
      )}

      {payload?.credentialConfigured &&
        canEdit &&
        payload.writeCredentialConfigured === false && (
          <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              {payload.writeCredentialOwner ? (
                <>
                  The data steward {payload.writeCredentialOwner} must authorize
                  GitHub
                </>
              ) : (
                <>Assign a user data steward and authorize GitHub</>
              )}{" "}
              in{" "}
              <Link href="/credentials" className="font-medium underline">
                Connected Credentials
              </Link>{" "}
              before issues can be moved.
            </p>
          </div>
        )}

      {payload && (payload.credentialConfigured || payload.issues.length > 0) && (
        <>
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search issues…"
                className="h-9 pl-8"
                aria-label="Filter GitHub issues"
              />
            </div>
            <Button
              type="button"
              variant={filtersOpen || activeSecondaryFilters > 0 ? "secondary" : "outline"}
              size="sm"
              aria-expanded={filtersOpen}
              aria-controls="github-issue-filters"
              onClick={() => setFiltersOpen((open) => !open)}
            >
              <ListFilter className="h-4 w-4" />
              Filters
              {activeSecondaryFilters > 0 && (
                <span className="rounded-full bg-background px-1.5 text-xs tabular-nums">
                  {activeSecondaryFilters}
                </span>
              )}
            </Button>
            {filtersApplied && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearFilters}
                className="hidden sm:inline-flex"
              >
                <X className="h-4 w-4" /> Clear
              </Button>
            )}
          </div>

          {filtersOpen && (
            <div
              id="github-issue-filters"
              className="grid grid-cols-2 gap-2 rounded-md border bg-muted/20 p-2 sm:grid-cols-4 xl:grid-cols-8"
            >
            <select
              value={contentTypeFilter}
              onChange={(event) => setContentTypeFilter(event.target.value)}
              className="min-w-0 rounded-md border bg-background px-2 py-1.5 text-sm"
              aria-label="Filter by GitHub content type"
            >
              <option value="all">Issues &amp; discussions</option>
              <option value="issue">Issues only</option>
              <option value="discussion">Discussions only</option>
            </select>
            <select
              value={stateFilter}
              onChange={(event) => setStateFilter(event.target.value)}
              className="min-w-0 rounded-md border bg-background px-2 py-1.5 text-sm"
              aria-label="Filter by GitHub state"
            >
              <option value="all">All states</option>
              <option value="open">Open</option>
              <option value="closed">Closed</option>
            </select>
            <select
              value={repoFilter}
              onChange={(event) => setRepoFilter(event.target.value)}
              className="min-w-0 rounded-md border bg-background px-2 py-1.5 text-sm"
              aria-label="Filter by repository"
            >
              <option value="all">All repositories</option>
              {isMissingOption(repoFilter, payload?.repos ?? []) && (
                <option value={repoFilter}>{repoFilter}</option>
              )}
              {(payload?.repos ?? []).map((repo) => (
                <option key={repo} value={repo}>
                  {repo}
                </option>
              ))}
            </select>
            {pinnedLabel ? (
              <span className="min-w-0 truncate rounded-md border bg-muted/40 px-2 py-1.5 text-sm">
                Label: {pinnedLabel}
              </span>
            ) : (
              <select
                value={labelFilter}
                onChange={(event) => setLabelFilter(event.target.value)}
                className="min-w-0 rounded-md border bg-background px-2 py-1.5 text-sm"
                aria-label="Filter by GitHub label"
              >
                <option value="all">All labels</option>
                <option value={ISSUE_FILTER_NONE}>No label</option>
                {isMissingOption(labelFilter, labels) && (
                  <option value={labelFilter}>{labelFilter}</option>
                )}
                {labels.map((label) => (
                  <option key={label} value={label}>
                    {label}
                  </option>
                ))}
              </select>
            )}
            <select
              value={assigneeFilter}
              onChange={(event) => setAssigneeFilter(event.target.value)}
              className="min-w-0 rounded-md border bg-background px-2 py-1.5 text-sm"
              aria-label="Filter by assignee"
            >
              <option value="all">All assignees</option>
              <option value={ISSUE_FILTER_NONE}>Unassigned</option>
              {isMissingOption(assigneeFilter, assignees) && (
                <option value={assigneeFilter}>@{assigneeFilter}</option>
              )}
              {assignees.map((assignee) => (
                <option key={assignee} value={assignee}>
                  @{assignee}
                </option>
              ))}
            </select>
            <select
              value={authorFilter}
              onChange={(event) => setAuthorFilter(event.target.value)}
              className="min-w-0 rounded-md border bg-background px-2 py-1.5 text-sm"
              aria-label="Filter by author"
            >
              <option value="all">All authors</option>
              {isMissingOption(authorFilter, authors) && (
                <option value={authorFilter}>@{authorFilter}</option>
              )}
              {authors.map((author) => (
                <option key={author} value={author}>
                  @{author}
                </option>
              ))}
            </select>
            <select
              value={milestoneFilter}
              onChange={(event) => setMilestoneFilter(event.target.value)}
              className="min-w-0 rounded-md border bg-background px-2 py-1.5 text-sm"
              aria-label="Filter by milestone"
            >
              <option value="all">All milestones</option>
              <option value={ISSUE_FILTER_NONE}>No milestone</option>
              {isMissingOption(milestoneFilter, milestones) && (
                <option value={milestoneFilter}>{milestoneFilter}</option>
              )}
              {milestones.map((milestone) => (
                <option key={milestone} value={milestone}>
                  {milestone}
                </option>
              ))}
            </select>
            <select
              value={priorityFilter}
              onChange={(event) => setPriorityFilter(event.target.value)}
              className="min-w-0 rounded-md border bg-background px-2 py-1.5 text-sm"
              aria-label="Filter by priority"
            >
              <option value="all">All priorities</option>
              <option value={ISSUE_FILTER_NONE}>No priority</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
            {filtersApplied && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearFilters}
                className="sm:hidden"
              >
                <X className="h-4 w-4" /> Clear
              </Button>
            )}
            </div>
          )}
        </>
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

      {warning && (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          {warning}.{" "}
          {warningCode && STEWARD_CREDENTIAL_ERROR_CODES.has(warningCode) && (
            <Link href="/credentials" className="font-medium underline">
              Open Connected Credentials
            </Link>
          )}
        </p>
      )}

      {loading && !payload ? (
        <div className="flex items-center justify-center gap-2 py-20 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading GitHub content from
          GitHub…
        </div>
      ) : filteredIssues.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-12 text-center">
          <AlertCircle className="mx-auto h-10 w-10 text-muted-foreground/40" />
          <p className="mt-3 font-medium">
            {(payload?.repos.length ?? 0) === 0
              ? "No attached GitHub repositories"
              : issues.length === 0
                ? "No GitHub issues or discussions found"
                : "No GitHub content matches these filters"}
          </p>
          {filtersApplied && (
            <Button variant="link" onClick={clearFilters}>
              Clear filters
            </Button>
          )}
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {STATUS_COLUMNS.map((column) => {
            const columnIssues = filteredIssues.filter(
              (issue) => issue.displayStatus === column.status,
            );
            return (
              <section
                key={column.status}
                data-issue-status={column.status}
                aria-label={`${column.label} issues`}
                onMouseEnter={() => markIssueDropTarget(column.status)}
                onMouseUp={() => dropIssueOnStatus(column.status)}
                className={cn(
                  "rounded-xl border bg-muted/20 p-3 transition-colors",
                  dragOverStatus === column.status &&
                    "border-primary/60 bg-primary/5 ring-2 ring-primary/20",
                )}
              >
                <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                  <span
                    className={cn("h-2.5 w-2.5 rounded-full", column.dot)}
                  />
                  {column.label}
                  <span className="text-xs font-normal text-muted-foreground">
                    {columnIssues.length}
                  </span>
                </h2>
                <div className="space-y-3">
                  {columnIssues.map((issue) => {
                    const summary = issueSummary(issue.body);
                    const labelUpdatePending = updatingLabelKeys.has(issueKey(issue));
                    const availableTrackedLabels = TRACKED_ISSUE_LABELS.filter(
                      (label) => !issue.labels.some(
                        (candidate) => candidate.toLowerCase() === label,
                      ),
                    );
                    const removableTrackedLabels = issue.labels.filter((label) =>
                      TRACKED_ISSUE_LABELS.some(
                        (tracked) => tracked === label.toLowerCase(),
                      ),
                    );
                    return (
                      <article
                        key={issueKey(issue)}
                        data-issue-card={issueKey(issue)}
                        className={cn(
                          "group/issue relative rounded-lg border bg-background p-3 pr-9 shadow-sm transition",
                          draggedIssueKey === issueKey(issue) && "opacity-50",
                          movingIssueKeys.has(issueKey(issue)) && "opacity-70",
                        )}
                      >
                        {canMoveIssues && issue.contentType !== "discussion" && (
                          <div
                            role="button"
                            tabIndex={0}
                            title={`Drag ${issue.repo} #${issue.number} to move; use left and right arrow keys for keyboard`}
                            aria-label={`Move ${issue.title}`}
                            onMouseDown={(event) => beginIssueDrag(event, issue)}
                            onKeyDown={(event) =>
                              moveIssueWithKeyboard(event, issue)
                            }
                            className="absolute right-2 top-2 select-none cursor-grab rounded p-1 text-muted-foreground/60 hover:bg-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary active:cursor-grabbing"
                          >
                            {movingIssueKeys.has(issueKey(issue)) ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <GripVertical className="h-4 w-4" />
                            )}
                          </div>
                        )}
                        <Link
                          href={issue.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-sm font-semibold hover:underline"
                        >
                          {issue.title}{" "}
                          <ExternalLink className="inline h-3 w-3" />
                        </Link>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {issue.repo} · {issue.contentType === "discussion" ? "Discussion" : "Issue"} #{issue.number}
                          {issue.author ? ` · opened by @${issue.author}` : ""}
                        </p>
                        {issue.contentType === "discussion" && issue.category && (
                          <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                            <MessagesSquare className="h-3 w-3" />
                            {issue.category}
                          </p>
                        )}
                        {summary && (
                          <p className="mt-2 text-xs leading-5 text-muted-foreground">
                            {summary}
                            {(issue.body?.length ?? 0) > summary.length ? "…" : ""}
                          </p>
                        )}
                        <div className="mt-2 flex flex-wrap gap-1">
                          {issue.priority && (
                            <span
                              className={cn(
                                "rounded-full border px-2 py-0.5 text-[10px] font-medium",
                                PRIORITY_STYLES[issue.priority],
                              )}
                            >
                              {issue.priority}
                            </span>
                          )}
                          {issue.labels.map((label) => (
                            <span
                              key={label}
                              className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] text-muted-foreground"
                            >
                              {label}
                            </span>
                          ))}
                          {canMoveIssues &&
                            issue.contentType !== "discussion" &&
                            removableTrackedLabels.length > 0 && (
                              <Popover>
                                <PopoverTrigger asChild>
                                  <button
                                    type="button"
                                    disabled={labelUpdatePending}
                                    aria-label={`Remove label from ${issue.title}`}
                                    title="Remove tracked label"
                                    className="inline-flex h-5 w-5 items-center justify-center rounded-full border text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                                  >
                                    {labelUpdatePending ? (
                                      <Loader2 className="h-3 w-3 animate-spin" />
                                    ) : (
                                      <Minus className="h-3 w-3" />
                                    )}
                                  </button>
                                </PopoverTrigger>
                                <PopoverContent align="start" className="w-48 p-1">
                                  {removableTrackedLabels.map((label) => (
                                    <button
                                      key={label}
                                      type="button"
                                      onClick={() => void updateIssueLabel(issue, label, "remove")}
                                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted"
                                    >
                                      <Minus className="h-3 w-3" />
                                      {label}
                                    </button>
                                  ))}
                                </PopoverContent>
                              </Popover>
                            )}
                          {canMoveIssues &&
                            issue.contentType !== "discussion" &&
                            availableTrackedLabels.length > 0 && (
                              <Popover>
                                <PopoverTrigger asChild>
                                  <button
                                    type="button"
                                    disabled={labelUpdatePending}
                                    aria-label={`Add label to ${issue.title}`}
                                    title="Add tracked label"
                                    className="inline-flex h-5 w-5 items-center justify-center rounded-full border text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                                  >
                                    {labelUpdatePending ? (
                                      <Loader2 className="h-3 w-3 animate-spin" />
                                    ) : (
                                      <Plus className="h-3 w-3" />
                                    )}
                                  </button>
                                </PopoverTrigger>
                                <PopoverContent align="start" className="w-48 p-1">
                                  {availableTrackedLabels.map((label) => (
                                    <button
                                      key={label}
                                      type="button"
                                      onClick={() => void updateIssueLabel(issue, label, "add")}
                                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted"
                                    >
                                      <Plus className="h-3 w-3" />
                                      {label}
                                    </button>
                                  ))}
                                </PopoverContent>
                              </Popover>
                            )}
                        </div>
                        {issue.assignees.length > 0 && (
                          <p className="mt-2 text-[11px] text-muted-foreground">
                            Assigned to{" "}
                            {issue.assignees
                              .map((assignee) => `@${assignee}`)
                              .join(", ")}
                          </p>
                        )}
                        {issue.milestone && (
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            Milestone: {issue.milestone}
                          </p>
                        )}
                      </article>
                    );
                  })}
                  {columnIssues.length === 0 && (
                    <p className="py-6 text-center text-xs text-muted-foreground">
                      No items
                    </p>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </PanelShell>
  );
}
