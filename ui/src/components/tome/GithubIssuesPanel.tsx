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
  Loader2,
  MessagesSquare,
  Plus,
  RefreshCw,
  Search,
} from "lucide-react";

import { BetaBadge } from "@/components/tome/BetaBadge";
import { PanelShell } from "@/components/tome/PanelHeader";
import { LabelComboBox } from "@/components/projects/LabelComboBox";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  TOME_TRACKED_ISSUE_LABELS,
  type TomeTrackedIssueLabel,
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
    .trim();
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

function issueKey(
  issue: Pick<GitHubIssue, "repo" | "number" | "contentType">,
): string {
  const type = issue.contentType === "discussion"
    ? "discussion"
    : "issue";
  return `${issue.repo.toLowerCase()}:${type}#${issue.number}`;
}

export function GithubIssuesPanel({
  slug,
  canEdit,
  initialLabel,
  title,
  trackedLabels = TOME_TRACKED_ISSUE_LABELS,
}: {
  slug: string;
  canEdit: boolean;
  initialLabel?: string;
  title?: string;
  trackedLabels?: readonly TomeTrackedIssueLabel[];
}) {
  const trackedLabel = initialLabel?.trim().toLowerCase();
  const [payload, setPayload] = useState<IssuesPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [warningCode, setWarningCode] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [trackingDialogOpen, setTrackingDialogOpen] = useState(false);
  const [issueRepository, setIssueRepository] = useState("");
  const [issueNumber, setIssueNumber] = useState("");
  const [trackingLabels, setTrackingLabels] = useState<string[]>([]);
  const [trackingError, setTrackingError] = useState<string | null>(null);
  const [trackingIssue, setTrackingIssue] = useState(false);
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
        setLoading(true);
        setRefreshing(Boolean(options?.refresh));
        setError(null);
        setErrorCode(null);
        setWarning(null);
        setWarningCode(null);
      }
      try {
        const params = new URLSearchParams();
        if (trackedLabel) params.set("label", trackedLabel);
        if (options?.refresh) params.set("refresh", "1");
        const suffix = params.size ? `?${params}` : "";
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
    [slug, trackedLabel],
  );

  useEffect(() => {
    void load();
  }, [load]);

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
    setQuery("");
  }, [trackedLabel]);

  const issues = useMemo(() => payload?.issues ?? [], [payload?.issues]);
  const filteredIssues = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return issues.filter((issue) => {
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
  }, [issues, query]);

  const canMoveIssues =
    canEdit && payload?.writeCredentialConfigured !== false;

  const openTrackingDialog = useCallback(() => {
    setIssueRepository(payload?.repos.length === 1 ? payload.repos[0] : "");
    setIssueNumber("");
    setTrackingLabels(
      trackedLabel && trackedLabels.some(({ label }) => label === trackedLabel)
        ? [trackedLabel]
        : [trackedLabels[0]?.label ?? TOME_TRACKED_ISSUE_LABELS[0].label],
    );
    setTrackingError(null);
    setTrackingDialogOpen(true);
  }, [payload?.repos, trackedLabel, trackedLabels]);

  const toggleTrackingLabel = useCallback((label: string) => {
    setTrackingLabels((current) => current.includes(label)
      ? current.filter((candidate) => candidate !== label)
      : [...current, label]);
  }, []);

  const upsertTrackedIssue = useCallback((issue: GitHubIssue) => {
    const key = issueKey(issue);
    setPayload((current) => {
      if (!current) return current;
      const exists = current.issues.some((candidate) => issueKey(candidate) === key);
      if (trackedLabel && !issue.labels.some((label) => label.toLowerCase() === trackedLabel)) {
        return exists
          ? {
              ...current,
              issues: current.issues.filter((candidate) => issueKey(candidate) !== key),
            }
          : current;
      }
      return {
        ...current,
        issues: exists
          ? current.issues.map((candidate) => issueKey(candidate) === key ? issue : candidate)
          : [issue, ...current.issues],
      };
    });
  }, [trackedLabel]);

  const trackIssue = useCallback(async () => {
    const repository = payload?.repos.find(
      (candidate) => candidate.toLowerCase() === issueRepository.trim().toLowerCase(),
    );
    const number = Number(issueNumber);
    if (!repository) {
      setTrackingError("Choose a repository attached to this TOME project.");
      return;
    }
    if (!Number.isSafeInteger(number) || number <= 0) {
      setTrackingError("Enter a positive GitHub issue number.");
      return;
    }
    if (!trackingLabels.length) {
      setTrackingError("Choose at least one TOME label.");
      return;
    }

    setTrackingIssue(true);
    setTrackingError(null);
    try {
      for (const label of trackingLabels) {
        const result = await fetchJson<IssueMutationPayload>(
          `/api/tome/projects/${encodeURIComponent(slug)}/github-issues`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              repo: repository,
              number,
              label,
              operation: "add",
            }),
          },
        );
        upsertTrackedIssue(result.issue);
      }
      setTrackingDialogOpen(false);
    } catch (err) {
      setTrackingError(
        err instanceof Error ? err.message : "Could not add this issue to TOME.",
      );
    } finally {
      setTrackingIssue(false);
    }
  }, [issueNumber, issueRepository, payload?.repos, slug, trackingLabels, upsertTrackedIssue]);

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
      title={title ? `${title} issues` : "Tracked issues"}
      titleAccessory={<BetaBadge />}
      description={trackedLabel ? (
        <>
          Tracked by the GitHub label <code>{trackedLabel}</code>.
        </>
      ) : (
        "Issues with a TOME tracking label from your connected GitHub repositories."
      )}
      action={
        <div className="flex items-center gap-1">
          <Popover>
            <Tooltip>
              <TooltipTrigger asChild>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 text-muted-foreground"
                    aria-label="About GitHub issues"
                  >
                    <HelpCircle className="h-4 w-4" />
                  </Button>
                </PopoverTrigger>
              </TooltipTrigger>
              <TooltipContent>About GitHub issues</TooltipContent>
            </Tooltip>
            <PopoverContent align="end" className="w-80 space-y-2 p-3 text-xs">
              <p className="text-sm font-medium">GitHub issues and discussions</p>
              <p className="text-muted-foreground">
                {issues.length} tracked items from{" "}
                {payload?.repos.length === 1
                  ? payload.repos[0]
                  : `${payload?.repos.length ?? 0} repositories`}.
              </p>
              {query.trim() && (
                <p className="text-muted-foreground">
                  {filteredIssues.length} items match your search.
                </p>
              )}
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
          {canEdit && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={openTrackingDialog}
                disabled={!canMoveIssues}
              >
                <Plus className="h-4 w-4" />
                <span className="hidden sm:inline">Add issue</span>
              </Button>
              <Dialog
                open={trackingDialogOpen}
                onOpenChange={(open) => {
                  if (!trackingIssue) setTrackingDialogOpen(open);
                }}
              >
                <DialogContent className="sm:max-w-lg">
                  <DialogHeader>
                    <DialogTitle>Track GitHub issue</DialogTitle>
                    <DialogDescription>
                      Choose an attached repository and issue number. TOME adds the
                      selected labels in GitHub and immediately includes the issue here.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_9rem]">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Repository</label>
                      <LabelComboBox
                        value={issueRepository}
                        onChange={setIssueRepository}
                        options={(payload?.repos ?? []).map((repo) => ({
                          value: repo,
                          label: repo,
                        }))}
                        placeholder="Type to find a repository"
                        ariaLabel="Repository"
                        inputClassName="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                      />
                    </div>
                    <div className="space-y-2">
                      <label htmlFor="tome-github-issue-number" className="text-sm font-medium">
                        Issue number
                      </label>
                      <Input
                        id="tome-github-issue-number"
                        value={issueNumber}
                        onChange={(event) => setIssueNumber(event.target.value)}
                        placeholder="123"
                        inputMode="numeric"
                        autoFocus
                      />
                    </div>
                  </div>
                  <fieldset className="space-y-2">
                    <legend className="text-sm font-medium">TOME labels</legend>
                    <p className="text-xs text-muted-foreground">
                      The selected labels determine where this issue appears in TOME.
                    </p>
                    <div className="grid gap-2 sm:grid-cols-3">
                      {trackedLabels.map((tracked) => (
                        <label
                          key={tracked.id}
                          className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted"
                        >
                          <input
                            type="checkbox"
                            checked={trackingLabels.includes(tracked.label)}
                            onChange={() => toggleTrackingLabel(tracked.label)}
                            disabled={trackingIssue}
                          />
                          {tracked.title}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  {trackingError && (
                    <p className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">
                      {trackingError}
                    </p>
                  )}
                  <DialogFooter>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setTrackingDialogOpen(false)}
                      disabled={trackingIssue}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      onClick={() => void trackIssue()}
                      disabled={
                        trackingIssue ||
                        !issueRepository.trim() ||
                        !issueNumber.trim() ||
                        !trackingLabels.length
                      }
                    >
                      {trackingIssue && <Loader2 className="h-4 w-4 animate-spin" />}
                      Add to TOME
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void load({ refresh: true })}
                disabled={refreshing}
                aria-label="Refresh from GitHub"
              >
                {refreshing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                <span className="hidden sm:inline">Refresh</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Refresh from GitHub</TooltipContent>
          </Tooltip>
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
        <div className="relative min-w-0">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search tracked issues…"
            className="h-9 pl-8"
            aria-label="Search tracked issues"
          />
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
                ? "No tracked issues yet"
                : "No tracked issues match your search"}
          </p>
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
                    const availableTrackedLabels = trackedLabels.filter(
                      (tracked) => !issue.labels.some(
                        (candidate) => candidate.toLowerCase() === tracked.label,
                      ),
                    );
                    const removableTrackedLabels = issue.labels.filter((label) =>
                      trackedLabels.some(
                        (tracked) => tracked.label === label.toLowerCase(),
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
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div
                                role="button"
                                tabIndex={0}
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
                            </TooltipTrigger>
                            <TooltipContent>
                              Drag to move, or use left and right arrow keys.
                            </TooltipContent>
                          </Tooltip>
                        )}
                        <Link
                          href={issue.url}
                          target="_blank"
                          rel="noreferrer"
                          className="block line-clamp-2 text-sm font-semibold hover:underline"
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
                          <p className="mt-2 line-clamp-3 text-xs leading-5 text-muted-foreground">
                            {summary}
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
                              (removableTrackedLabels.length > 0 ||
                                availableTrackedLabels.length > 0) && (
                              <Popover>
                                <PopoverTrigger asChild>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    disabled={labelUpdatePending}
                                    aria-label={`Manage tracking labels for ${issue.title}`}
                                    className="h-6 px-2 text-[10px]"
                                  >
                                    {labelUpdatePending && <Loader2 className="h-3 w-3 animate-spin" />}
                                    Manage tracking
                                  </Button>
                                </PopoverTrigger>
                                <PopoverContent align="start" className="w-56 space-y-3 p-2">
                                  {removableTrackedLabels.length > 0 && (
                                    <div className="space-y-1">
                                      <p className="px-2 text-[11px] font-medium text-muted-foreground">
                                        Remove tracker
                                      </p>
                                      {removableTrackedLabels.map((label) => (
                                        <button
                                          key={label}
                                          type="button"
                                          onClick={() => void updateIssueLabel(issue, label, "remove")}
                                          className="flex w-full items-center rounded px-2 py-1.5 text-left text-xs hover:bg-muted"
                                        >
                                          Remove <code className="ml-1">{label}</code>
                                        </button>
                                      ))}
                                    </div>
                                  )}
                                  {availableTrackedLabels.length > 0 && (
                                    <div className="space-y-1">
                                      <p className="px-2 text-[11px] font-medium text-muted-foreground">
                                        Add tracker
                                      </p>
                                      {availableTrackedLabels.map((tracked) => (
                                        <button
                                          key={tracked.id}
                                          type="button"
                                          onClick={() => void updateIssueLabel(issue, tracked.label, "add")}
                                          className="flex w-full items-center rounded px-2 py-1.5 text-left text-xs hover:bg-muted"
                                        >
                                          Add <code className="ml-1">{tracked.label}</code>
                                        </button>
                                      ))}
                                    </div>
                                  )}
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
