"use client";

// assisted-by Codex Codex-sonnet-4-6

import { useCallback,useEffect,useMemo,useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Copy,
  Database,
  ListChecks,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Stethoscope,
  Trash2,
  Wrench,
  XCircle,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CAIPESpinner } from "@/components/ui/caipe-spinner";
import { Card,CardContent,CardHeader,CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  RBAC_SELF_CHECK_IDS,
  RBAC_SELF_CHECKS,
  type RbacSelfCheckId,
} from "@/lib/rbac/self-check-catalog";
import { cn } from "@/lib/utils";
import type {
  RbacSelfCheckBulkRevokeResult,
  RbacSelfCheckCleanupResult,
  RbacSelfCheckFinding,
  RbacSelfCheckFindingSeverity,
  RbacSelfCheckReport,
  RbacSelfCheckRepairResult,
  RbacSelfCheckRevokeResult,
  RbacSelfCheckTestCheck,
  RbacSelfCheckTestCaseStatus,
  RbacSelfCheckTestReport,
  RbacSelfCheckTestSuite,
  RbacSelfCheckTuple,
} from "@/types/rbac-self-check";

interface RbacSelfCheckTabProps {
  isAdmin: boolean;
}

type ApiEnvelope<T> = T & { data?: T };

function apiData<T>(payload: ApiEnvelope<T>): T {
  return (payload.data ?? payload) as T;
}

function selfCheckUrl(checks: RbacSelfCheckId[]): string {
  if (checks.length === 0 || checks.length === RBAC_SELF_CHECK_IDS.length) {
    return "/api/admin/rebac/self-check";
  }
  const params = new URLSearchParams();
  for (const check of checks) {
    params.append("checks", check);
  }
  return `/api/admin/rebac/self-check?${params.toString()}`;
}

function requestBodyForChecks(checks: RbacSelfCheckId[], extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    ...extra,
    ...(checks.length === RBAC_SELF_CHECK_IDS.length ? {} : { checks }),
  });
}

const MATRIX_SUITE_BY_SELF_CHECK: Partial<Record<RbacSelfCheckId, string[]>> = {
  team_memberships: ["team_memberships"],
  agent_access: ["agents"],
  agent_tools: ["agent_tools"],
  mcp_servers: ["mcp_servers"],
  llm_models: ["llm_models"],
  service_accounts: ["service_accounts"],
  slack: ["slack"],
  webex: ["webex"],
  credentials: ["credentials"],
};

function matrixSuitesForChecks(checks: RbacSelfCheckId[]): string[] | undefined {
  if (checks.length === RBAC_SELF_CHECK_IDS.length) return undefined;
  const suites = checks.flatMap((check) => MATRIX_SUITE_BY_SELF_CHECK[check] ?? []);
  return suites.length > 0 ? Array.from(new Set(suites)) : undefined;
}

function statusMeta(status: RbacSelfCheckReport["status"]) {
  if (status === "pass") {
    return {
      label: "Healthy",
      icon: CheckCircle2,
      className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
    };
  }
  if (status === "warn") {
    return {
      label: "Needs review",
      icon: AlertTriangle,
      className: "border-amber-500/40 bg-amber-500/10 text-amber-300",
    };
  }
  return {
    label: "Drift detected",
    icon: XCircle,
    className: "border-red-500/40 bg-red-500/10 text-red-300",
  };
}

function severityMeta(severity: RbacSelfCheckFindingSeverity) {
  if (severity === "missing") {
    return {
      label: "Missing",
      className: "border-red-500/40 bg-red-500/10 text-red-300",
    };
  }
  if (severity === "stale_reference") {
    return {
      label: "Stale",
      className: "border-amber-500/40 bg-amber-500/10 text-amber-300",
    };
  }
  return {
    label: "Unowned",
    className: "border-sky-500/40 bg-sky-500/10 text-sky-300",
  };
}

function testStatusMeta(status: RbacSelfCheckTestCaseStatus | RbacSelfCheckReport["status"]) {
  if (status === "pass") {
    return {
      label: "Passed",
      className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
    };
  }
  if (status === "fail") {
    return {
      label: "Failed",
      className: "border-red-500/40 bg-red-500/10 text-red-300",
    };
  }
  if (status === "blocked") {
    return {
      label: "Blocked",
      className: "border-amber-500/40 bg-amber-500/10 text-amber-300",
    };
  }
  if (status === "skip") {
    return {
      label: "Skipped",
      className: "border-border/80 bg-muted/30 text-muted-foreground",
    };
  }
  return {
    label: "Review",
    className: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  };
}

function sourceLabel(source: string): string {
  return source
    .replace(/\./g, " / ")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function groupFindings(findings: RbacSelfCheckFinding[]): Array<[string, RbacSelfCheckFinding[]]> {
  const grouped = new Map<string, RbacSelfCheckFinding[]>();
  for (const finding of findings) {
    const rows = grouped.get(finding.source) ?? [];
    rows.push(finding);
    grouped.set(finding.source, rows);
  }
  return Array.from(grouped.entries()).sort(([left], [right]) => left.localeCompare(right));
}

function tupleText(tuple: RbacSelfCheckTuple): string {
  return `${tuple.user} ${tuple.relation} ${tuple.object}`;
}

function tupleKey(tuple: RbacSelfCheckTuple): string {
  return `${tuple.user}\n${tuple.relation}\n${tuple.object}`;
}

function unownedTupleMessage(count: number): string {
  const tupleWord = count === 1 ? "tuple" : "tuples";
  const grantWord = count === 1 ? "grant" : "grants";
  return `${count} unowned ${tupleWord}: live OpenFGA ${grantWord} that the selected source records do not explain. Review before revoking; bootstrap, migration, manual admin, or legacy flows can be intentional owners.`;
}

function FindingRow({
  finding,
  onRevoke,
  onToggleSelected,
  revokingKey,
  selected,
  selectionDisabled,
}: {
  finding: RbacSelfCheckFinding;
  onRevoke: (finding: RbacSelfCheckFinding) => void;
  onToggleSelected: (finding: RbacSelfCheckFinding) => void;
  revokingKey: string | null;
  selected: boolean;
  selectionDisabled: boolean;
}) {
  const meta = severityMeta(finding.severity);
  const canRevoke = finding.review_action?.type === "revoke_tuple" && Boolean(finding.tuple);
  const currentTupleKey = finding.tuple ? tupleKey(finding.tuple) : null;
  const revoking = Boolean(currentTupleKey && revokingKey === currentTupleKey);
  const copyTuple = () => {
    if (!finding.tuple) return;
    void navigator.clipboard?.writeText(tupleText(finding.tuple));
  };

  return (
    <div className="rounded-md border border-border/70 bg-background/40 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={cn("h-6", meta.className)}>
              {meta.label}
            </Badge>
            <p className="text-sm font-medium">{finding.title}</p>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{finding.detail}</p>
        </div>
        {finding.repairable && (
          <Badge variant="outline" className="border-teal-500/40 bg-teal-500/10 text-teal-200">
            Repairable
          </Badge>
        )}
      </div>
      {finding.tuple && (
        <code className="mt-2 block overflow-x-auto rounded border border-border/60 bg-muted/30 px-2 py-1 text-xs">
          {tupleText(finding.tuple)}
        </code>
      )}
      {finding.review_action && (
        <p className="mt-2 text-xs text-amber-200/90">{finding.review_action.reason}</p>
      )}
      <p className="mt-2 text-xs text-muted-foreground">{finding.fix}</p>
      {finding.tuple && (
        <div className="mt-3 flex flex-wrap gap-2">
          {canRevoke && (
            <label className="flex h-9 cursor-pointer items-center gap-2 rounded-md border border-border/70 bg-background/60 px-3 text-sm">
              <input
                type="checkbox"
                aria-label={`Select tuple ${tupleText(finding.tuple)}`}
                checked={selected}
                disabled={selectionDisabled}
                onChange={() => onToggleSelected(finding)}
                className="h-4 w-4 accent-teal-400"
              />
              Select
            </label>
          )}
          <Button type="button" variant="outline" size="sm" onClick={copyTuple}>
            <Copy className="h-3.5 w-3.5" />
            Copy tuple
          </Button>
          {canRevoke && (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => onRevoke(finding)}
              disabled={revoking}
            >
              {revoking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              {finding.review_action?.label ?? "Revoke tuple"}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function MetricTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "danger" | "warning" | "success";
}) {
  return (
    <div className="rounded-md border border-border/80 bg-card/50 px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-1 text-2xl font-semibold",
          tone === "danger" && "text-red-300",
          tone === "warning" && "text-amber-300",
          tone === "success" && "text-emerald-300",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function matrixActorText(check: RbacSelfCheckTestCheck): string | null {
  if (!check.actor) return null;
  const subject = check.actor.subject_id
    ? `${check.actor.subject_type}:${check.actor.subject_id}`
    : check.actor.subject_type;
  return `${check.actor.label} (${subject})`;
}

function matrixResourceText(check: RbacSelfCheckTestCheck): string | null {
  if (!check.resource) return null;
  const ref = `${check.resource.type}:${check.resource.id}`;
  return check.resource.label && check.resource.label !== check.resource.id
    ? `${check.resource.label} (${ref})`
    : ref;
}

function MatrixCheckRow({ check }: { check: RbacSelfCheckTestCheck }) {
  const meta = testStatusMeta(check.status);
  const actor = matrixActorText(check);
  const resource = matrixResourceText(check);
  const decisionText = check.expected
    ? `Expected ${check.expected}${check.actual ? `, got ${check.actual}` : ""}`
    : null;

  return (
    <div className="rounded border border-border/60 bg-background/45 px-3 py-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium">{check.title}</p>
          <p className="mt-1 text-xs text-muted-foreground">{check.detail}</p>
        </div>
        <Badge variant="outline" className={cn("shrink-0", meta.className)}>{meta.label}</Badge>
      </div>
      {(actor || resource || check.action || decisionText) && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {actor && <Badge variant="outline" className="max-w-full truncate border-sky-500/30 bg-sky-500/10 text-sky-200">{actor}</Badge>}
          {check.action && <Badge variant="outline">Action: {check.action}</Badge>}
          {resource && <Badge variant="outline" className="max-w-full truncate">{resource}</Badge>}
          {decisionText && (
            <Badge
              variant="outline"
              className={cn(
                check.status === "fail"
                  ? "border-red-500/40 bg-red-500/10 text-red-200"
                  : "border-emerald-500/40 bg-emerald-500/10 text-emerald-200",
              )}
            >
              {decisionText}
            </Badge>
          )}
        </div>
      )}
      {check.tuple && (
        <code className="mt-2 block overflow-x-auto rounded border border-border/60 bg-muted/30 px-2 py-1 text-xs">
          {tupleText(check.tuple)}
        </code>
      )}
      {check.fix && <p className="mt-2 text-xs text-amber-200/90">{check.fix}</p>}
    </div>
  );
}

function MatrixSuiteCard({ suite }: { suite: RbacSelfCheckTestSuite }) {
  const meta = testStatusMeta(suite.status);
  const checkCount = suite.cases.reduce((count, item) => count + item.checks.length, 0);
  const defaultOpen = suite.status === "fail" || suite.status === "blocked";

  return (
    <details className="group rounded-md border border-border/70 bg-background/35 p-3" open={defaultOpen}>
      <summary className="flex cursor-pointer list-none flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
          <div className="min-w-0">
            <p className="text-sm font-medium">{suite.label}</p>
            <p className="text-xs text-muted-foreground">
              {suite.cases.length} case{suite.cases.length === 1 ? "" : "s"} · {checkCount} check{checkCount === 1 ? "" : "s"}
            </p>
          </div>
        </div>
        <Badge variant="outline" className={meta.className}>{meta.label}</Badge>
      </summary>
      <div className="mt-3 space-y-3">
        {suite.cases.map((testCase) => {
          const caseMeta = testStatusMeta(testCase.status);
          const caseDefaultOpen = testCase.status === "fail" || testCase.status === "blocked";
          return (
            <details key={testCase.id} className="group/case rounded-md border border-border/60 bg-card/35 p-2" open={caseDefaultOpen}>
              <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-open/case:rotate-180" />
                  <p className="text-xs font-medium">{testCase.title}</p>
                </div>
                <Badge variant="outline" className={caseMeta.className}>{caseMeta.label}</Badge>
              </summary>
              <div className="mt-2 space-y-2">
                {testCase.checks.map((check) => (
                  <MatrixCheckRow key={check.id} check={check} />
                ))}
              </div>
            </details>
          );
        })}
      </div>
    </details>
  );
}

function MatrixTestsDialog({
  report,
  open,
  onOpenChange,
}: {
  report: RbacSelfCheckTestReport | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!report) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-6xl gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-border/70 px-6 py-5">
          <DialogTitle className="flex items-center gap-2">
            <ListChecks className="h-5 w-5 text-teal-300" />
            Matrix tests
          </DialogTitle>
          <DialogDescription>
            Read-only allow/deny checks for org admin, member user, service account, and unlinked service account.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[calc(88vh-108px)]">
          <div className="space-y-4 px-6 py-5">
            <div className="grid gap-2 md:grid-cols-4">
              <MetricTile label="Passed" value={report.summary.passed} tone="success" />
              <MetricTile label="Failed" value={report.summary.failed} tone={report.summary.failed > 0 ? "danger" : "success"} />
              <MetricTile label="Blocked" value={report.summary.blocked} tone={report.summary.blocked > 0 ? "warning" : "success"} />
              <MetricTile label="Skipped" value={report.summary.skipped} />
            </div>
            <div className="flex flex-wrap gap-2">
              {report.actors.map((actor) => (
                <Badge
                  key={actor.key}
                  variant="outline"
                  className={cn(
                    "max-w-full truncate",
                    actor.resolved
                      ? "border-teal-500/40 bg-teal-500/10 text-teal-200"
                      : "border-amber-500/40 bg-amber-500/10 text-amber-200",
                  )}
                >
                  {actor.label}: {actor.resolved ? `${actor.subject_type}:${actor.subject_id}` : "unresolved"}
                </Badge>
              ))}
            </div>
            <div className="space-y-2">
              {report.suites.map((suite) => (
                <MatrixSuiteCard key={suite.id} suite={suite} />
              ))}
            </div>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

export function RbacSelfCheckTab({ isAdmin }: RbacSelfCheckTabProps) {
  const [report, setReport] = useState<RbacSelfCheckReport | null>(null);
  const [repairResult, setRepairResult] = useState<RbacSelfCheckRepairResult | null>(null);
  const [revokeResult, setRevokeResult] = useState<RbacSelfCheckRevokeResult | null>(null);
  const [bulkRevokeResult, setBulkRevokeResult] = useState<RbacSelfCheckBulkRevokeResult | null>(null);
  const [cleanupResult, setCleanupResult] = useState<RbacSelfCheckCleanupResult | null>(null);
  const [testReport, setTestReport] = useState<RbacSelfCheckTestReport | null>(null);
  const [selectedTupleKeys, setSelectedTupleKeys] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [revokingKey, setRevokingKey] = useState<string | null>(null);
  const [bulkRevoking, setBulkRevoking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // How many missing tuples a single "Repair Missing Tuples" pass may write.
  // Empty string means "use the server default". Backfilling the member
  // baseline for a large directory-synced population can exceed the default
  // 500, so admins can raise this to repair everyone in one pass.
  const [repairLimit, setRepairLimit] = useState("");
  const [matrixDialogOpen, setMatrixDialogOpen] = useState(false);
  const [selectedCheckIds, setSelectedCheckIds] = useState<Set<RbacSelfCheckId>>(
    () => new Set(RBAC_SELF_CHECK_IDS),
  );

  const selectedChecks = useMemo(
    () => RBAC_SELF_CHECK_IDS.filter((check) => selectedCheckIds.has(check)),
    [selectedCheckIds],
  );
  const allChecksSelected = selectedChecks.length === RBAC_SELF_CHECK_IDS.length;
  const selectedCheckLabels = useMemo(
    () =>
      RBAC_SELF_CHECKS
        .filter((check) => selectedCheckIds.has(check.id))
        .map((check) => check.label),
    [selectedCheckIds],
  );

  const toggleSelfCheck = useCallback((id: RbacSelfCheckId) => {
    setSelectedCheckIds((current) => {
      if (current.size === RBAC_SELF_CHECK_IDS.length) {
        return new Set([id]);
      }
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      if (next.size === 0) {
        next.add(id);
      }
      return next;
    });
  }, []);

  const selectAllSelfChecks = useCallback(() => {
    setSelectedCheckIds(new Set(RBAC_SELF_CHECK_IDS));
  }, []);

  const loadReport = useCallback(async (checks: RbacSelfCheckId[] = RBAC_SELF_CHECK_IDS) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(selfCheckUrl(checks), { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Self-check failed with ${response.status}`);
      }
      const payload = apiData<RbacSelfCheckReport>((await response.json()) as ApiEnvelope<RbacSelfCheckReport>);
      setRepairResult(null);
      setRevokeResult(null);
      setBulkRevokeResult(null);
      setCleanupResult(null);
      setSelectedTupleKeys(new Set());
      setReport(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Self-check failed");
    } finally {
      setLoading(false);
    }
  }, []);

  const runApiMatrix = useCallback(async () => {
    setTesting(true);
    setError(null);
    try {
      const suites = matrixSuitesForChecks(selectedChecks);
      const response = await fetch("/api/admin/rebac/self-check/tests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(suites ? { suites } : {}),
      });
      if (!response.ok) {
        throw new Error(`API matrix failed with ${response.status}`);
      }
      const payload = apiData<RbacSelfCheckTestReport>((await response.json()) as ApiEnvelope<RbacSelfCheckTestReport>);
      setTestReport(payload);
      setMatrixDialogOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "API matrix failed");
    } finally {
      setTesting(false);
    }
  }, [selectedChecks]);

  useEffect(() => {
    if (isAdmin) {
      void loadReport(RBAC_SELF_CHECK_IDS);
    }
  }, [isAdmin, loadReport]);

  const repairMissing = useCallback(async () => {
    setRepairing(true);
    setError(null);
    try {
      const parsedLimit = Number(repairLimit);
      const limitExtra =
        repairLimit.trim() && Number.isFinite(parsedLimit) && parsedLimit > 0
          ? { maxFindings: Math.floor(parsedLimit) }
          : {};
      const response = await fetch("/api/admin/rebac/self-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: requestBodyForChecks(selectedChecks, limitExtra),
      });
      if (!response.ok) {
        throw new Error(`Repair failed with ${response.status}`);
      }
      const payload = apiData<{
        repair: RbacSelfCheckRepairResult;
        report: RbacSelfCheckReport;
      }>((await response.json()) as ApiEnvelope<{
        repair: RbacSelfCheckRepairResult;
        report: RbacSelfCheckReport;
      }>);
      setRepairResult(payload.repair);
      setRevokeResult(null);
      setBulkRevokeResult(null);
      setCleanupResult(null);
      setSelectedTupleKeys(new Set());
      setReport(payload.report);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Repair failed");
    } finally {
      setRepairing(false);
    }
  }, [selectedChecks, repairLimit]);

  const revokeTuple = useCallback(async (finding: RbacSelfCheckFinding) => {
    if (!finding.tuple) return;
    const text = tupleText(finding.tuple);
    const confirmed = window.confirm(
      `Revoke this OpenFGA tuple?\n\n${text}\n\nThis removes only this grant. The user or team may still see the resource if another grant path allows it.`,
    );
    if (!confirmed) return;
    setRevokingKey(tupleKey(finding.tuple));
    setError(null);
    try {
      const response = await fetch("/api/admin/rebac/self-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: requestBodyForChecks(selectedChecks, { action: "revoke_tuple", tuple: finding.tuple }),
      });
      if (!response.ok) {
        throw new Error(`Revoke failed with ${response.status}`);
      }
      const payload = apiData<{
        revoke: RbacSelfCheckRevokeResult;
        report: RbacSelfCheckReport;
      }>((await response.json()) as ApiEnvelope<{
        revoke: RbacSelfCheckRevokeResult;
        report: RbacSelfCheckReport;
      }>);
      setRevokeResult(payload.revoke);
      setRepairResult(null);
      setBulkRevokeResult(null);
      setCleanupResult(null);
      setSelectedTupleKeys(new Set());
      setReport(payload.report);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Revoke failed");
    } finally {
      setRevokingKey(null);
    }
  }, [selectedChecks]);

  const revokableFindings = useMemo(
    () =>
      (report?.findings ?? []).filter(
        (finding) => finding.review_action?.type === "revoke_tuple" && Boolean(finding.tuple),
      ),
    [report?.findings],
  );

  const selectedTuples = useMemo(
    () =>
      revokableFindings
        .map((finding) => finding.tuple)
        .filter((tuple): tuple is RbacSelfCheckTuple => Boolean(tuple))
        .filter((tuple) => selectedTupleKeys.has(tupleKey(tuple))),
    [revokableFindings, selectedTupleKeys],
  );

  const toggleTupleSelection = useCallback((finding: RbacSelfCheckFinding) => {
    if (!finding.tuple) return;
    const key = tupleKey(finding.tuple);
    setSelectedTupleKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const selectReviewableTuples = useCallback(() => {
    setSelectedTupleKeys(new Set(
      revokableFindings
        .map((finding) => finding.tuple)
        .filter((tuple): tuple is RbacSelfCheckTuple => Boolean(tuple))
        .map(tupleKey),
    ));
  }, [revokableFindings]);

  const revokeSelectedTuples = useCallback(async () => {
    if (selectedTuples.length === 0) return;
    const confirmed = window.confirm(
      `Revoke ${selectedTuples.length} selected OpenFGA tuple${selectedTuples.length === 1 ? "" : "s"}?\n\nThis removes only the selected grants. A resource may remain visible if another grant path allows it. The server will revalidate each tuple before deleting it.`,
    );
    if (!confirmed) return;
    setBulkRevoking(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/rebac/self-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: requestBodyForChecks(selectedChecks, { action: "revoke_tuples", tuples: selectedTuples }),
      });
      if (!response.ok) {
        throw new Error(`Bulk revoke failed with ${response.status}`);
      }
      const payload = apiData<{
        bulk_revoke: RbacSelfCheckBulkRevokeResult;
        report: RbacSelfCheckReport;
      }>((await response.json()) as ApiEnvelope<{
        bulk_revoke: RbacSelfCheckBulkRevokeResult;
        report: RbacSelfCheckReport;
      }>);
      setBulkRevokeResult(payload.bulk_revoke);
      setRevokeResult(null);
      setRepairResult(null);
      setCleanupResult(null);
      setSelectedTupleKeys(new Set());
      setReport(payload.report);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bulk revoke failed");
    } finally {
      setBulkRevoking(false);
    }
  }, [selectedChecks, selectedTuples]);

  const revokeDeletedTeamMemberships = useCallback(async () => {
    const confirmed = window.confirm(
      "Revoke all currently detected deleted-team membership tuples?\n\nThis removes dangling user memberships for teams that are no longer active in Mongo. The server will re-run the self-check and only delete tuples still classified as stale deleted-team memberships.",
    );
    if (!confirmed) return;
    setBulkRevoking(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/rebac/self-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: requestBodyForChecks(selectedChecks, { action: "revoke_deleted_team_memberships" }),
      });
      if (!response.ok) {
        throw new Error(`Deleted-team cleanup failed with ${response.status}`);
      }
      const payload = apiData<{
        bulk_revoke: RbacSelfCheckBulkRevokeResult;
        report: RbacSelfCheckReport;
      }>((await response.json()) as ApiEnvelope<{
        bulk_revoke: RbacSelfCheckBulkRevokeResult;
        report: RbacSelfCheckReport;
      }>);
      setBulkRevokeResult(payload.bulk_revoke);
      setRevokeResult(null);
      setRepairResult(null);
      setCleanupResult(null);
      setSelectedTupleKeys(new Set());
      setReport(payload.report);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Deleted-team cleanup failed");
    } finally {
      setBulkRevoking(false);
    }
  }, [selectedChecks]);

  const cleanupStaleTeamMembershipSources = useCallback(async () => {
    const confirmed = window.confirm(
      "Remove stale team membership source rows for deleted teams?\n\nThis marks the source rows as removed and revokes matching dangling user-to-team OpenFGA tuples when they still exist. Restore the team first if these memberships should remain.",
    );
    if (!confirmed) return;
    setBulkRevoking(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/rebac/self-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: requestBodyForChecks(selectedChecks, { action: "cleanup_stale_team_membership_sources" }),
      });
      if (!response.ok) {
        throw new Error(`Stale membership cleanup failed with ${response.status}`);
      }
      const payload = apiData<{
        cleanup: RbacSelfCheckCleanupResult;
        report: RbacSelfCheckReport;
      }>((await response.json()) as ApiEnvelope<{
        cleanup: RbacSelfCheckCleanupResult;
        report: RbacSelfCheckReport;
      }>);
      setCleanupResult(payload.cleanup);
      setBulkRevokeResult(null);
      setRevokeResult(null);
      setRepairResult(null);
      setSelectedTupleKeys(new Set());
      setReport(payload.report);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Stale membership cleanup failed");
    } finally {
      setBulkRevoking(false);
    }
  }, [selectedChecks]);

  const cleanupStaleResourceReferences = useCallback(async () => {
    const confirmed = window.confirm(
      "Remove stale resource references?\n\nThis removes service-account scopes and Slack/Webex grants that point at resources the self-check just proved are missing, then revokes matching OpenFGA tuples when they still exist. Restore the missing resource first if these grants should remain.",
    );
    if (!confirmed) return;
    setBulkRevoking(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/rebac/self-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: requestBodyForChecks(selectedChecks, { action: "cleanup_stale_resource_references" }),
      });
      if (!response.ok) {
        throw new Error(`Stale resource cleanup failed with ${response.status}`);
      }
      const payload = apiData<{
        cleanup: RbacSelfCheckCleanupResult;
        report: RbacSelfCheckReport;
      }>((await response.json()) as ApiEnvelope<{
        cleanup: RbacSelfCheckCleanupResult;
        report: RbacSelfCheckReport;
      }>);
      setCleanupResult(payload.cleanup);
      setBulkRevokeResult(null);
      setRevokeResult(null);
      setRepairResult(null);
      setSelectedTupleKeys(new Set());
      setReport(payload.report);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Stale resource cleanup failed");
    } finally {
      setBulkRevoking(false);
    }
  }, [selectedChecks]);

  const groupedFindings = useMemo(() => groupFindings(report?.findings ?? []), [report?.findings]);
  const repairableCount = report?.summary.repairable_findings ?? 0;
  const meta = report ? statusMeta(report.status) : null;
  const StatusIcon = meta?.icon ?? Stethoscope;
  const actionBusy = loading || repairing || testing || Boolean(revokingKey) || bulkRevoking;
  const displayedOrphanCount = report?.findings.filter((finding) => finding.severity === "orphan_candidate").length ?? 0;
  const hiddenOrphanCount = Math.max((report?.summary.orphan_candidates ?? 0) - displayedOrphanCount, 0);
  const staleMembershipSourceCount = report?.findings.filter(
    (finding) =>
      finding.severity === "stale_reference" &&
      finding.source === "team_membership_sources" &&
      finding.title.startsWith("Stale membership source for deleted team"),
  ).length ?? 0;
  const staleResourceReferenceCount = report?.findings.filter(
    (finding) =>
      finding.severity === "stale_reference" &&
      (
        finding.source === "service_accounts.scopes_snapshot" ||
        finding.source === "slack_channel_grants" ||
        finding.source === "webex_space_grants"
      ),
  ).length ?? 0;
  const deletedTeamMembershipCount = revokableFindings.filter(
    (finding) => finding.title === "Stale deleted-team membership tuple",
  ).length;

  if (!isAdmin) {
    return <div className="rounded-md border border-border p-4 text-sm text-muted-foreground">Admin access required.</div>;
  }

  return (
    <div className="space-y-4" data-testid="rbac-self-check-tab">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md border border-teal-500/30 bg-teal-500/10">
            <ShieldCheck className="h-5 w-5 text-teal-300" />
          </div>
          <div>
            <h2 className="text-xl font-semibold">RBAC Self Check</h2>
            <p className="text-sm text-muted-foreground">
              Compare source-of-truth records with live OpenFGA tuples. Repair missing grants and review unowned grants.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" onClick={() => loadReport(selectedChecks)} disabled={actionBusy}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Audit Selected
          </Button>
          <input
            type="number"
            min={1}
            inputMode="numeric"
            value={repairLimit}
            onChange={(event) => setRepairLimit(event.target.value)}
            placeholder="Max (500)"
            title="Max missing tuples to repair in one pass. Leave blank for the default of 500; raise it to backfill a large synced population in a single pass."
            disabled={actionBusy}
            className="h-9 w-32 rounded-md border border-border/80 bg-background px-2 text-sm"
          />
          <Button
            type="button"
            onClick={repairMissing}
            disabled={!report || repairableCount === 0 || actionBusy}
            className="bg-teal-500 text-teal-950 hover:bg-teal-400"
          >
            {repairing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wrench className="mr-2 h-4 w-4" />}
            Repair Missing Tuples
          </Button>
        </div>
      </div>

      <div className="rounded-md border border-border/80 bg-card/35 px-3 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <ListChecks className="h-4 w-4 text-teal-300" />
            <div>
              <p className="text-sm font-medium">Audit scope</p>
              <p className="text-xs text-muted-foreground">
                Choose which source-of-truth areas to compare with OpenFGA.
              </p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Selected audit: {allChecksSelected ? "All checks" : selectedCheckLabels.join(", ")}
          </p>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant={allChecksSelected ? "default" : "outline"}
            onClick={selectAllSelfChecks}
            disabled={actionBusy}
            className={allChecksSelected ? "bg-teal-500 text-teal-950 hover:bg-teal-400" : undefined}
          >
            All
          </Button>
          {RBAC_SELF_CHECKS.map((check) => {
            const active = selectedCheckIds.has(check.id) && !allChecksSelected;
            return (
              <Button
                key={check.id}
                type="button"
                size="sm"
                variant={active ? "default" : "outline"}
                title={check.description}
                onClick={() => toggleSelfCheck(check.id)}
                disabled={actionBusy}
                className={active ? "bg-teal-500 text-teal-950 hover:bg-teal-400" : undefined}
              >
                {check.label}
              </Button>
            );
          })}
        </div>
      </div>

      <div className="rounded-md border border-border/80 bg-card/35 px-3 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">API Access Matrix</p>
            <p className="text-xs text-muted-foreground">
              Optional read-only runtime probes for org admin, member user, service account, and unlinked service account.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {testReport && (
              <Badge variant="outline" className={cn("h-7", testStatusMeta(testReport.status).className)}>
                {testStatusMeta(testReport.status).label}
              </Badge>
            )}
            <Button type="button" variant="outline" size="sm" onClick={runApiMatrix} disabled={actionBusy}>
              {testing ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <ListChecks className="mr-2 h-3.5 w-3.5" />}
              Run Access Matrix
            </Button>
            {testReport && (
              <Button type="button" variant="outline" size="sm" onClick={() => setMatrixDialogOpen(true)}>
                View results
              </Button>
            )}
          </div>
        </div>
        {testing ? (
          <div className="mt-3 rounded-md border border-border/70 bg-background/40 p-4">
            <CAIPESpinner size="sm" message="Running RBAC API matrix" />
          </div>
        ) : testReport ? (
          <div className="mt-3 rounded-md border border-border/70 bg-background/35 px-3 py-2">
            <p className="text-xs text-muted-foreground">
              Latest matrix: {testReport.summary.passed} passed · {testReport.summary.failed} failed · {testReport.summary.blocked} blocked · {testReport.summary.skipped} skipped across {testReport.summary.suites} suites.
            </p>
          </div>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">
            Use this for the same allow/deny smoke check that CI can run. Detailed tests open in a collapsible modal.
          </p>
        )}
      </div>

      <MatrixTestsDialog
        report={testReport}
        open={matrixDialogOpen}
        onOpenChange={setMatrixDialogOpen}
      />

      {error && (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {error}
        </div>
      )}

      {loading && !report ? (
        <div className="flex min-h-[320px] items-center justify-center">
          <CAIPESpinner size="lg" message="Running RBAC self-check" />
        </div>
      ) : report ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={cn("h-8 px-3 text-sm", meta?.className)}>
              <StatusIcon className="mr-1.5 h-4 w-4" />
              {meta?.label}
            </Badge>
            <span className="text-xs text-muted-foreground">
              Generated {new Date(report.generated_at).toLocaleString()}
            </span>
            {report.scope && !report.scope.all && (
              <Badge variant="outline">
                Checked {report.scope.labels.join(", ")}
              </Badge>
            )}
            {repairResult && (
              <Badge variant="outline" className="border-teal-500/40 bg-teal-500/10 text-teal-200">
                repaired {repairResult.applied_writes}/{repairResult.attempted_writes}
              </Badge>
            )}
            {revokeResult && (
              <Badge variant="outline" className="border-red-500/40 bg-red-500/10 text-red-200">
                revoked {revokeResult.applied_deletes}/{revokeResult.attempted_deletes}
              </Badge>
            )}
            {bulkRevokeResult && (
              <Badge variant="outline" className="border-red-500/40 bg-red-500/10 text-red-200">
                revoked {bulkRevokeResult.applied_deletes}/{bulkRevokeResult.requested_deletes}
              </Badge>
            )}
            {cleanupResult && (
              <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-200">
                cleaned {cleanupResult.modified_rows}/{cleanupResult.matched_rows} source rows
              </Badge>
            )}
          </div>

          <div className="grid gap-3 md:grid-cols-5">
            <MetricTile label="Expected tuples" value={report.summary.expected_tuples} />
            <MetricTile label="Missing" value={report.summary.missing_tuples} tone={report.summary.missing_tuples > 0 ? "danger" : "success"} />
            <MetricTile label="Stale refs" value={report.summary.stale_references} tone={report.summary.stale_references > 0 ? "warning" : "success"} />
            <MetricTile label="Unowned tuples" value={report.summary.orphan_candidates} tone={report.summary.orphan_candidates > 0 ? "warning" : "success"} />
            <MetricTile label="Repairable" value={report.summary.repairable_findings} tone={report.summary.repairable_findings > 0 ? "danger" : "success"} />
          </div>

          {report.summary.orphan_candidates > 0 && (
            <div className="rounded-md border border-sky-500/35 bg-sky-500/10 px-3 py-2 text-sm text-sky-100">
              {unownedTupleMessage(report.summary.orphan_candidates)}
            </div>
          )}

          {hiddenOrphanCount > 0 && (
            <div className="rounded-md border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
              Showing {displayedOrphanCount} of {report.summary.orphan_candidates} unowned tuples. Cleaning the displayed rows can reveal the next batch.
            </div>
          )}

          {staleMembershipSourceCount > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-500/35 bg-amber-500/10 px-3 py-2">
              <div>
                <p className="text-sm font-medium text-amber-100">Stale membership source rows</p>
                <p className="text-xs text-amber-100/80">
                  {staleMembershipSourceCount} active membership source row{staleMembershipSourceCount === 1 ? " references" : "s reference"} deleted teams. Remove the source rows so they cannot recreate access drift.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={cleanupStaleTeamMembershipSources}
                disabled={actionBusy}
                className="border-amber-500/40 bg-amber-500/10 text-amber-100 hover:bg-amber-500/20"
              >
                {bulkRevoking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                Remove stale source rows
              </Button>
            </div>
          )}

          {staleResourceReferenceCount > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-500/35 bg-amber-500/10 px-3 py-2">
              <div>
                <p className="text-sm font-medium text-amber-100">Stale resource references</p>
                <p className="text-xs text-amber-100/80">
                  {staleResourceReferenceCount} service-account or messaging grant reference{staleResourceReferenceCount === 1 ? " points" : "s point"} at missing resources. Remove the source refs so they cannot recreate access drift.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={cleanupStaleResourceReferences}
                disabled={actionBusy}
                className="border-amber-500/40 bg-amber-500/10 text-amber-100 hover:bg-amber-500/20"
              >
                {bulkRevoking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                Remove stale resource refs
              </Button>
            </div>
          )}

          {revokableFindings.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border/80 bg-card/40 px-3 py-2">
              <div>
                <p className="text-sm font-medium">Unowned or stale grants to review</p>
                <p className="text-xs text-muted-foreground">
                  Select only grants you know should no longer exist, then revoke those exact OpenFGA tuples in one server-validated batch.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{selectedTuples.length}/{revokableFindings.length} selected</Badge>
                <Button type="button" variant="outline" size="sm" onClick={selectReviewableTuples} disabled={actionBusy}>
                  Select reviewable
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setSelectedTupleKeys(new Set())}
                  disabled={actionBusy || selectedTuples.length === 0}
                >
                  Clear
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={revokeSelectedTuples}
                  disabled={actionBusy || selectedTuples.length === 0}
                >
                  {bulkRevoking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  Revoke selected
                </Button>
                {deletedTeamMembershipCount > 0 && (
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={revokeDeletedTeamMemberships}
                    disabled={actionBusy}
                  >
                    {bulkRevoking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                    Revoke deleted-team memberships
                  </Button>
                )}
              </div>
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
            <div className="space-y-3">
              {groupedFindings.length === 0 ? (
                <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-200">
                  No RBAC/OpenFGA drift found in the audited source records.
                </div>
              ) : (
                groupedFindings.map(([source, findings]) => (
                  <Card key={source} className="border-border/80 bg-card/40">
                    <CardHeader className="pb-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <CardTitle className="text-base">{sourceLabel(source)}</CardTitle>
                        <Badge variant="outline">{findings.length}</Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {findings.map((finding) => (
                        <FindingRow
                          key={finding.id}
                          finding={finding}
                          onRevoke={revokeTuple}
                          onToggleSelected={toggleTupleSelection}
                          revokingKey={revokingKey}
                          selected={Boolean(finding.tuple && selectedTupleKeys.has(tupleKey(finding.tuple)))}
                          selectionDisabled={actionBusy}
                        />
                      ))}
                    </CardContent>
                  </Card>
                ))
              )}
            </div>

            <div className="space-y-3">
              <Card className="border-border/80 bg-card/40">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Database className="h-4 w-4" />
                    Inventory
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-xs">
                  {Object.entries(report.inventory.mongo).map(([key, value]) => (
                    <div key={key} className="flex justify-between gap-3">
                      <span className="truncate text-muted-foreground">{key.replace(/_/g, " ")}</span>
                      <span className="font-medium">{value}</span>
                    </div>
                  ))}
                  <div className="border-t border-border/70 pt-2">
                    <div className="flex justify-between gap-3">
                      <span className="text-muted-foreground">OpenFGA tuples</span>
                      <span className="font-medium">{report.inventory.openfga_tuple_count}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-border/80 bg-card/40">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Repair Plan</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {report.repair_batches.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No repairable missing tuples.</p>
                  ) : (
                    report.repair_batches.map((batch) => (
                      <div key={batch.source} className="rounded-md border border-border/70 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-medium">{sourceLabel(batch.source)}</p>
                          <Badge variant="outline">{batch.repairable_count}</Badge>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">{batch.guidance}</p>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>

              <Card className="border-border/80 bg-card/40">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Notes</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-xs text-muted-foreground">
                  {report.notes.map((note) => (
                    <p key={note}>{note}</p>
                  ))}
                </CardContent>
              </Card>
            </div>
          </div>
        </>
      ) : (
        <div className="rounded-md border border-border p-4 text-sm text-muted-foreground">
          Audit selected source records to inspect RBAC/OpenFGA drift.
        </div>
      )}
    </div>
  );
}
