"use client";

/**
 * EvaluationView — RAG evaluation section.
 *
 * Split into three tabbed pages that follow the eval workflow:
 *   1. Question Sets   — upload + browse/edit the question dataset
 *   2. Run Experiment  — configure + submit a run, watch it finish
 *   3. Leaderboard     — compare finished runs and their metric scores
 *
 * Everything here is served by the separate DeepEval evaluation service,
 * reached through our own /api/knowledge-bases/* routes so the session and
 * OpenFGA checks happen on our side and its API key stays server-side.
 *
 * Metric scores live only on the Leaderboard: Run Experiment shows a run's
 * configuration and status, not its results.
 */

import {
  addQuestionToSet,
  batchDeleteQuestionSetItems,
  createQuestionSet,
  deleteQuestionSet,
  type DocumentInfo,
  type EvaluationJob,
  getDataSources,
  getDatasourceDocuments,
  getEvaluationJobStatus,
  getEvaluationServiceHealth,
  listEvaluationJobs,
  listQuestionSetItems,
  listQuestionSets,
  type QuestionSet,
  type QuestionSetItem,
  questionSetExportUrl,
  renameQuestionSet,
  runEvaluationExperiment,
  updateQuestionSetItem,
  uploadQuestionSet,
} from "@/components/rag/api";
import type { DataSourceInfo } from "@/components/rag/Models";
import { Badge } from "@/components/ui/badge";
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
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { Permission, useRagPermissions } from "@/hooks/useRagPermissions";
import {
  BarChart3,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Download,
  FlaskConical,
  ListChecks,
  Pencil,
  Play,
  Plus,
  Search,
  Trash2,
  Trophy,
  Upload,
  X,
} from "lucide-react";
import {
  type ChangeEvent,
  // Aliased so the native MouseEvent stays available for the document-level
  // drag listeners in the column resizer.
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

const PLACEHOLDER = "—";

// Every metric key the DeepEval service can return in `summary.metrics` —
// see engine/metrics.py:build_metrics() + get_metric_column_name() (class
// name, "Metric" suffix stripped, snake_cased) plus the two doc-id-based
// retrieval_recall/retrieval_precision keys appended in
// compute_all_metric_averages(). Shared by both Run Experiment's results
// table and the Leaderboard's columns so the two never drift out of sync
// again.
const METRIC_FIELDS: { label: string; key: string }[] = [
  { label: "Contextual Precision", key: "contextual_precision" },
  { label: "Contextual Recall", key: "contextual_recall" },
  { label: "Contextual Relevancy", key: "contextual_relevancy" },
  { label: "Answer Relevancy", key: "answer_relevancy" },
  { label: "Answer Correctness", key: "answer_correctness" },
  { label: "Faithfulness", key: "faithfulness" },
  { label: "MRR", key: "mrr" },
  { label: "nDCG@k", key: "ndcg_at_k" },
  { label: "Recall@k", key: "retrieval_recall" },
  { label: "Precision@k", key: "retrieval_precision" },
  { label: "Exact Match", key: "normalized_exact_match" },
  { label: "Contains Reference", key: "contains_reference" },
];

type TabId = "questions" | "run" | "leaderboard";

const TABS: { id: TabId; label: string; sublabel: string; icon: typeof ListChecks }[] = [
  { id: "questions", label: "Question Sets", sublabel: "Upload & manage", icon: ListChecks },
  { id: "run", label: "Run Experiment", sublabel: "Configure & run", icon: FlaskConical },
  { id: "leaderboard", label: "Leaderboard", sublabel: "Compare results", icon: Trophy },
];

export default function EvaluationView() {
  const [activeTab, setActiveTab] = useState<TabId>("questions");

  return (
    <div className="h-full flex flex-col bg-background overflow-hidden">
      {/* Header */}
      <div className="relative overflow-hidden border-b border-border shrink-0">
        <div
          className="absolute inset-0"
          style={{
            background: `linear-gradient(to bottom right, color-mix(in srgb, var(--gradient-from) 15%, transparent) 0%, color-mix(in srgb, var(--gradient-to) 8%, transparent) 50%, transparent 100%)`,
          }}
        />
        <div className="relative px-6 py-3 flex items-center gap-3">
          <div className="p-2 rounded-lg gradient-primary-br shadow-md shadow-primary/20">
            <BarChart3 className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold gradient-text">Evaluation</h1>
            <p className="text-muted-foreground text-xs">
              Upload question sets, run experiments, and compare results
            </p>
          </div>
        </div>
      </div>

      {/* Tab bar — larger than the Ingest source-type pills */}
      <div className="shrink-0 border-b border-border bg-card/30 px-6 py-3">
        <div className="flex gap-2 flex-wrap">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <Button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                variant={isActive ? "default" : "outline"}
                className={`h-12 rounded-lg px-5 gap-2.5 ${isActive ? "shadow-sm" : ""}`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="flex flex-col items-start leading-tight">
                  <span className="text-sm font-semibold">{tab.label}</span>
                  <span className={`text-[11px] font-normal ${isActive ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                    {tab.sublabel}
                  </span>
                </span>
              </Button>
            );
          })}
        </div>
      </div>

      {/* Active page */}
      {activeTab === "questions" && <QuestionSetsPage />}
      {activeTab === "run" && <RunExperimentPage />}
      {activeTab === "leaderboard" && <LeaderboardPage />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page 1 — Question Sets                                              */
/* ------------------------------------------------------------------ */

const ITEMS_PAGE_SIZE = 50;
// The set list loads in one request and is filtered in the browser, so pull
// enough that the left-hand search never silently misses one.
const QUESTION_SETS_PAGE_SIZE = 200;
// Question search runs server-side across the whole set; debounce so typing
// doesn't fire a request per keystroke.
const SEARCH_DEBOUNCE_MS = 300;
// `level` is free text upstream. These are the values our own uploads use,
// offered as a starting point alongside whatever the question already has.
const KNOWN_LEVELS = ["easy", "medium", "hard"];

// Questions table. Widths are in px and resizable by dragging the header
// dividers; the leading select column and trailing edit column are fixed.
const QUESTION_COLS: { key: keyof QuestionSetItem; label: string }[] = [
  { key: "input", label: "Question" },
  { key: "expected_output", label: "Expected answer" },
  { key: "category", label: "Category" },
  { key: "level", label: "Level" },
  { key: "expected_doc_ids", label: "Expected doc IDs" },
];
const QUESTION_COL_DEFAULT_WIDTHS = [360, 200, 130, 100, 220];
const SELECT_COL_WIDTH = 44;
const EDIT_COL_WIDTH = 90;

function questionCellText(q: QuestionSetItem, key: keyof QuestionSetItem): string {
  if (key === "expected_doc_ids") return q.expected_doc_ids.join(", ") || PLACEHOLDER;
  const value = q[key];
  return value === null || value === undefined || value === "" ? PLACEHOLDER : String(value);
}

/** Snap a typed category onto an existing one when it differs only by case
 *  (so "BrIDge" becomes "bridge"); otherwise keep what was typed. */
function normalizeCategory(value: string, existing: string[]): string {
  const trimmed = value.trim();
  return existing.find((c) => c.toLowerCase() === trimmed.toLowerCase()) ?? trimmed;
}

function QuestionSetsPage() {
  const { toast } = useToast();
  const { hasPermission } = useRagPermissions();
  const canWrite = hasPermission(Permission.INGEST);
  const canDelete = hasPermission(Permission.DELETE);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [sets, setSets] = useState<QuestionSet[]>([]);
  const [loadingSets, setLoadingSets] = useState(true);
  const [setsError, setSetsError] = useState<string | null>(null);
  const [setsSearch, setSetsSearch] = useState("");
  const [uploading, setUploading] = useState(false);

  const [selectedSetId, setSelectedSetId] = useState<number | null>(null);
  const [questions, setQuestions] = useState<QuestionSetItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loadingQuestions, setLoadingQuestions] = useState(false);
  const [questionsError, setQuestionsError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [colWidths, setColWidths] = useState<number[]>(QUESTION_COL_DEFAULT_WIDTHS);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  const [editing, setEditing] = useState<QuestionSetItem | null>(null);
  const [renaming, setRenaming] = useState<QuestionSet | null>(null);
  const [creatingSet, setCreatingSet] = useState(false);
  const [addingQuestion, setAddingQuestion] = useState(false);

  const fetchSets = useCallback(async (preferId?: number) => {
    setLoadingSets(true);
    setSetsError(null);
    try {
      const res = await listQuestionSets({ limit: QUESTION_SETS_PAGE_SIZE });
      setSets(res.items);
      setSelectedSetId((prev) => {
        const candidate = preferId ?? prev;
        if (candidate && res.items.some((s) => s.id === candidate)) return candidate;
        return res.items[0]?.id ?? null;
      });
    } catch (err) {
      setSetsError(err instanceof Error ? err.message : "Failed to load question sets");
    } finally {
      setLoadingSets(false);
    }
  }, []);

  useEffect(() => {
    fetchSets();
  }, [fetchSets]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  const fetchQuestions = useCallback(async (setId: number, p: number, query: string) => {
    setLoadingQuestions(true);
    setQuestionsError(null);
    try {
      const res = await listQuestionSetItems(setId, {
        page: p,
        limit: ITEMS_PAGE_SIZE,
        query: query || undefined,
      });
      setQuestions(res.items);
      setTotal(res.total);
      setPage(res.page);
    } catch (err) {
      setQuestionsError(err instanceof Error ? err.message : "Failed to load questions");
    } finally {
      setLoadingQuestions(false);
    }
  }, []);

  // Selecting a different set, or changing the search, always restarts at
  // page 1 — the old page number rarely exists in the new result set.
  useEffect(() => {
    setSelectedIds([]);
    if (selectedSetId == null) {
      setQuestions([]);
      setTotal(0);
      return;
    }
    fetchQuestions(selectedSetId, 1, debouncedSearch);
  }, [selectedSetId, debouncedSearch, fetchQuestions]);

  const reloadQuestions = () => {
    if (selectedSetId != null) fetchQuestions(selectedSetId, page, debouncedSearch);
  };

  const goToPage = (p: number) => {
    if (selectedSetId != null) fetchQuestions(selectedSetId, p, debouncedSearch);
  };

  const onFilesSelected = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;

    setUploading(true);
    let created = 0;
    let lastId: number | undefined;
    try {
      // One set per file, named after the file. A failure on one file should
      // not abandon the rest of the selection.
      for (const file of files) {
        try {
          const set = await uploadQuestionSet(file, {
            name: file.name.replace(/\.[^.]+$/, ""),
          });
          created += 1;
          lastId = set.id;
        } catch (err) {
          toast(err instanceof Error ? err.message : `Upload failed for "${file.name}"`, "error");
        }
      }
      if (created > 0) {
        toast(`Uploaded ${created} question set${created === 1 ? "" : "s"}`, "success");
        await fetchSets(lastId);
      }
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDeleteSet = async (set: QuestionSet) => {
    const confirmed = window.confirm(
      `Delete question set "${set.name}" and all ${set.question_count} of its questions? This cannot be undone.`,
    );
    if (!confirmed) return;
    try {
      await deleteQuestionSet(set.id);
      toast("Question set deleted", "success");
      if (selectedSetId === set.id) {
        setSelectedSetId(null);
        setQuestions([]);
        setTotal(0);
      }
      await fetchSets();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Delete failed", "error");
    }
  };

  const handleSaveItem = async (patch: {
    question_id?: string | null;
    input: string;
    expected_output?: string | null;
    category?: string | null;
    level?: string | null;
    expected_doc_ids?: string[];
  }) => {
    if (!editing || selectedSetId == null) return;
    await updateQuestionSetItem(selectedSetId, editing.id, patch);
    setEditing(null);
    toast("Question updated", "success");
    reloadQuestions();
    // The set carries the category breakdown, so it goes stale on every edit.
    fetchSets(selectedSetId);
  };

  const handleBatchDelete = async () => {
    if (selectedSetId == null || selectedIds.length === 0) return;
    const confirmed = window.confirm(
      `Delete ${selectedIds.length} selected question${selectedIds.length === 1 ? "" : "s"}? This cannot be undone.`,
    );
    if (!confirmed) return;
    try {
      const res = await batchDeleteQuestionSetItems(selectedSetId, selectedIds);
      toast(`Deleted ${res.deleted_count} question${res.deleted_count === 1 ? "" : "s"}`, "success");
      setSelectedIds([]);
      reloadQuestions();
      fetchSets(selectedSetId);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Delete failed", "error");
    }
  };

  const handleRenamed = async (updated: QuestionSet) => {
    setRenaming(null);
    toast("Question set updated", "success");
    await fetchSets(updated.id);
  };

  const handleCreatedSet = async (created: QuestionSet) => {
    setCreatingSet(false);
    toast("Question set created", "success");
    await fetchSets(created.id);
  };

  const handleAddQuestion = async (q: {
    question_id?: string | null;
    input: string;
    expected_output?: string | null;
    category?: string | null;
    level?: string | null;
    expected_doc_ids?: string[];
  }) => {
    if (selectedSetId == null) return;
    await addQuestionToSet(selectedSetId, q);
    setAddingQuestion(false);
    toast("Question added", "success");
    reloadQuestions();
    // The set carries the count + category breakdown, so it goes stale.
    fetchSets(selectedSetId);
  };

  const selectedSet = sets.find((s) => s.id === selectedSetId) ?? null;
  const pageCount = Math.max(1, Math.ceil(total / ITEMS_PAGE_SIZE));
  const visibleSets = sets.filter((s) =>
    s.name.toLowerCase().includes(setsSearch.trim().toLowerCase()),
  );
  const categoryOptions = selectedSet?.categories ? Object.keys(selectedSet.categories).sort() : [];
  const tableWidth =
    SELECT_COL_WIDTH + colWidths.reduce((a, b) => a + b, 0) + EDIT_COL_WIDTH;
  const allOnPageSelected =
    questions.length > 0 && questions.every((q) => selectedIds.includes(q.id));

  const toggleAllOnPage = () => {
    setSelectedIds((prev) =>
      allOnPageSelected
        ? prev.filter((id) => !questions.some((q) => q.id === id))
        : [...new Set([...prev, ...questions.map((q) => q.id)])],
    );
  };

  const toggleOne = (id: number) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]));
  };

  // Drag a header divider to resize that column.
  const startResize = (index: number, e: ReactMouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = colWidths[index];
    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      setColWidths((prev) => {
        const next = [...prev];
        next[index] = Math.max(60, startWidth + dx);
        return next;
      });
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  const emptyMessage = loadingQuestions
    ? "Loading…"
    : questionsError
      ? questionsError
      : selectedSetId == null
        ? "Select a question set to view its questions."
        : debouncedSearch
          ? "No questions match your search."
          : "No questions.";

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Top bar */}
      <div className="px-6 py-3 border-b border-border flex items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-foreground">Question sets</h3>
          <p className="text-xs text-muted-foreground">
            Click a set on the left to view and edit its questions.
          </p>
        </div>
        {canWrite ? (
          <div className="flex items-center gap-2">
            <Button onClick={() => setCreatingSet(true)} className="gap-1.5">
              <Plus className="h-4 w-4" />
              Add question set
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".jsonl,.csv,.json"
              multiple
              onChange={onFilesSelected}
              className="hidden"
            />
            <Button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="gap-1.5"
            >
              <Upload className="h-4 w-4" />
              {uploading ? "Uploading…" : "Upload"}
            </Button>
          </div>
        ) : (
          <Badge variant="outline">Read-only</Badge>
        )}
      </div>

      {/* 25 / 75 split — both tables visible, no page scroll */}
      <div className="flex-1 flex min-h-0">
        {/* Left — Question Sets */}
        <aside className="w-1/4 shrink-0 border-r border-border overflow-y-auto p-4 space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              value={setsSearch}
              onChange={(e) => setSetsSearch(e.target.value)}
              placeholder="Search question sets…"
              className="pl-9"
            />
          </div>
          <div className="rounded-xl border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/40 text-left text-muted-foreground">
                  <th className="py-2.5 px-3 font-medium">Name</th>
                  <th className="py-2.5 px-2 font-medium text-right">#</th>
                  <th className="py-2.5 px-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {visibleSets.length === 0 && (
                  <tr>
                    <td colSpan={3} className="py-6 px-3 text-center text-muted-foreground">
                      {loadingSets
                        ? "Loading…"
                        : setsError
                          ? setsError
                          : setsSearch.trim()
                            ? "No matches."
                            : "No question sets yet."}
                    </td>
                  </tr>
                )}
                {visibleSets.map((s) => (
                  <tr
                    key={s.id}
                    onClick={() => setSelectedSetId(s.id)}
                    className={`border-t border-border/50 cursor-pointer hover:bg-muted/30 ${
                      selectedSetId === s.id ? "bg-muted/50" : ""
                    }`}
                  >
                    {/* `truncate` lives on an inner <span>, not the <td>: a global
                        rule in globals.css forces `display: block !important` on
                        `.truncate`, which clobbers a cell's `table-cell` display
                        and breaks the row layout. */}
                    <td className="py-2.5 px-3 text-foreground font-medium">
                      <span className="block truncate max-w-[10rem]" title={s.name}>
                        {s.name}
                      </span>
                    </td>
                    <td className="py-2.5 px-2 tabular-nums text-muted-foreground text-right">
                      {s.question_count}
                    </td>
                    <td className="py-1 px-1 text-right whitespace-nowrap">
                      {canWrite && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          onClick={(e) => {
                            e.stopPropagation();
                            setRenaming(s);
                          }}
                          title="Rename"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          window.open(questionSetExportUrl(s.id, "jsonl"), "_blank");
                        }}
                        title="Export as .jsonl"
                      >
                        <Download className="h-3.5 w-3.5" />
                      </Button>
                      {canDelete && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteSet(s);
                          }}
                          title="Delete set"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </aside>

        {/* Right — Questions */}
        <div className="w-3/4 flex flex-col min-h-0 p-4">
          <div className="flex items-center justify-between gap-3 mb-3">
            <h3 className="text-base font-semibold text-foreground">
              Questions <span className="text-muted-foreground font-normal">({total})</span>
            </h3>
            <div className="flex items-center gap-2">
              {canWrite && (
                <Button
                  size="sm"
                  className="gap-1.5"
                  onClick={() => setAddingQuestion(true)}
                  disabled={selectedSetId == null}
                  title={selectedSetId == null ? "Select a question set first" : undefined}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add question
                </Button>
              )}
              {canWrite && selectedIds.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="text-destructive gap-1.5"
                  onClick={handleBatchDelete}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete {selectedIds.length}
                </Button>
              )}
              <div className="relative w-64 max-w-full">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search questions…"
                  className="pl-9"
                  disabled={selectedSetId == null}
                />
              </div>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-auto rounded-xl border border-border">
            <table className="table-fixed text-sm" style={{ width: tableWidth }}>
              <thead>
                <tr className="bg-muted/40 text-left text-muted-foreground">
                  <th style={{ width: SELECT_COL_WIDTH }} className="py-2.5 px-3">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-border align-middle"
                      checked={allOnPageSelected}
                      onChange={toggleAllOnPage}
                      disabled={!canWrite || questions.length === 0}
                      aria-label="Select all on this page"
                    />
                  </th>
                  {QUESTION_COLS.map((c, i) => (
                    <th
                      key={c.key}
                      style={{ width: colWidths[i] }}
                      className="relative py-2.5 px-4 font-medium select-none"
                    >
                      <span className="block truncate">{c.label}</span>
                      <div
                        onMouseDown={(e) => startResize(i, e)}
                        className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-primary/40"
                        title="Drag to resize"
                      />
                    </th>
                  ))}
                  <th style={{ width: EDIT_COL_WIDTH }} className="py-2.5 px-4 font-medium" />
                </tr>
              </thead>
              <tbody>
                {questions.length === 0 && (
                  <tr>
                    <td
                      colSpan={QUESTION_COLS.length + 2}
                      className="py-10 px-4 text-center text-muted-foreground"
                    >
                      {emptyMessage}
                    </td>
                  </tr>
                )}
                {questions.map((q) => (
                  <tr key={q.id} className="border-t border-border/50">
                    <td className="py-2.5 px-3 align-middle">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-border align-middle"
                        checked={selectedIds.includes(q.id)}
                        onChange={() => toggleOne(q.id)}
                        disabled={!canWrite}
                        aria-label={`Select question ${q.id}`}
                      />
                    </td>
                    {QUESTION_COLS.map((c) => (
                      <td key={c.key} className="py-2.5 px-4 overflow-hidden align-middle">
                        <div
                          className={`truncate ${c.key === "input" ? "text-foreground" : "text-muted-foreground"} ${
                            c.key === "expected_doc_ids" ? "tabular-nums" : ""
                          }`}
                          title={questionCellText(q, c.key)}
                        >
                          {questionCellText(q, c.key)}
                        </div>
                      </td>
                    ))}
                    <td className="py-2.5 px-4 text-right whitespace-nowrap align-middle">
                      {canWrite && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditing(q)}
                          className="gap-1"
                        >
                          <Pencil className="h-3.5 w-3.5" /> Edit
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pager — bottom right: [←] [page] [→] */}
          <div className="shrink-0 pt-3 flex items-center justify-end gap-1">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1 || loadingQuestions}
              onClick={() => goToPage(page - 1)}
              aria-label="Previous page"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span
              className="h-9 min-w-9 px-3 inline-flex items-center justify-center rounded-md border border-input text-sm tabular-nums"
              title={`Page ${page} of ${pageCount}`}
            >
              {page}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= pageCount || loadingQuestions}
              onClick={() => goToPage(page + 1)}
              aria-label="Next page"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {editing && (
        <EditQuestionDialog
          item={editing}
          categoryOptions={categoryOptions}
          onClose={() => setEditing(null)}
          onSave={handleSaveItem}
        />
      )}

      {renaming && (
        <RenameSetDialog
          set={renaming}
          onClose={() => setRenaming(null)}
          onSaved={handleRenamed}
        />
      )}

      {creatingSet && (
        <NewQuestionSetDialog
          onClose={() => setCreatingSet(false)}
          onCreated={handleCreatedSet}
        />
      )}

      {addingQuestion && selectedSet && (
        <AddQuestionDialog
          setName={selectedSet.name}
          categoryOptions={categoryOptions}
          onClose={() => setAddingQuestion(false)}
          onAdd={handleAddQuestion}
        />
      )}
    </div>
  );
}

interface QuestionFormValue {
  question_id: string;
  input: string;
  expected_output: string;
  category: string;
  level: string;
  expected_doc_ids: string[];
}

/** Repeatable list of text inputs (add / remove rows). Empty rows are dropped
 *  by the caller before saving. */
function StringListEditor({
  values,
  onChange,
  placeholder,
  addLabel,
  trailing,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  addLabel: string;
  /** Optional control rendered to the right of the "Add" button. */
  trailing?: ReactNode;
}) {
  return (
    <div className="space-y-2">
      {values.map((v, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input
            value={v}
            onChange={(e) => {
              const next = [...values];
              next[i] = e.target.value;
              onChange(next);
            }}
            placeholder={placeholder}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-9 w-9 p-0 text-destructive shrink-0"
            onClick={() => onChange(values.filter((_, idx) => idx !== i))}
            aria-label="Remove"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          className="gap-1.5"
          onClick={() => onChange([...values, ""])}
        >
          <Plus className="h-3.5 w-3.5" />
          {addLabel}
        </Button>
        {trailing}
      </div>
    </div>
  );
}

/** Browse an ingested corpus (datasource) and pick document IDs, instead of
 *  typing them by hand. Reuses the existing datasource + documents APIs. */
function DocumentPicker({
  existing,
  onClose,
  onConfirm,
}: {
  existing: string[];
  onClose: () => void;
  onConfirm: (docIds: string[]) => void;
}) {
  const [datasources, setDatasources] = useState<DataSourceInfo[]>([]);
  const [datasourceId, setDatasourceId] = useState("");
  const [docs, setDocs] = useState<DocumentInfo[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());

  useEffect(() => {
    getDataSources()
      .then((res) => {
        setDatasources(res.datasources);
        setDatasourceId(res.datasources[0]?.datasource_id ?? "");
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Failed to load knowledge bases"),
      );
  }, []);

  useEffect(() => {
    if (!datasourceId) {
      setDocs([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    getDatasourceDocuments(datasourceId, 0, 500)
      .then((res) => {
        if (cancelled) return;
        setDocs(res.documents);
        setHasMore(res.has_more);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load documents");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [datasourceId]);

  const q = search.trim().toLowerCase();
  const visible = q
    ? docs.filter(
        (d) => d.document_id.toLowerCase().includes(q) || (d.title || "").toLowerCase().includes(q),
      )
    : docs;

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Pick documents from a corpus</DialogTitle>
          <DialogDescription>
            Choose an ingested knowledge base, then check the documents this question should retrieve.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <select
              value={datasourceId}
              onChange={(e) => setDatasourceId(e.target.value)}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm min-w-[200px]"
            >
              {datasources.length === 0 ? (
                <option value="">No knowledge bases</option>
              ) : (
                datasources.map((ds) => (
                  <option key={ds.datasource_id} value={ds.datasource_id}>
                    {ds.name || ds.datasource_id}
                  </option>
                ))
              )}
            </select>
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search title or document ID…"
                className="pl-9"
              />
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
          {hasMore && (
            <p className="text-[11px] text-muted-foreground">
              Showing the first 500 documents — use search to narrow down.
            </p>
          )}

          <div className="max-h-80 overflow-auto rounded-xl border border-border divide-y divide-border/50">
            {loading ? (
              <p className="py-6 px-4 text-center text-sm text-muted-foreground">
                Loading documents…
              </p>
            ) : visible.length === 0 ? (
              <p className="py-6 px-4 text-center text-sm text-muted-foreground">
                {docs.length === 0 ? "No documents in this knowledge base." : "No matches."}
              </p>
            ) : (
              visible.map((d) => {
                const already = existing.includes(d.document_id);
                return (
                  <label
                    key={d.document_id}
                    className="flex items-start gap-3 px-4 py-2.5 cursor-pointer hover:bg-muted/30"
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 rounded border-border shrink-0"
                      checked={already || picked.has(d.document_id)}
                      disabled={already}
                      onChange={() => toggle(d.document_id)}
                    />
                    <span className="min-w-0">
                      <span className="block text-sm text-foreground truncate">
                        {d.title || "(untitled)"}
                      </span>
                      <span className="block text-[11px] text-muted-foreground font-mono truncate">
                        {d.document_id}
                        {already ? " · already added" : ""}
                      </span>
                    </span>
                  </label>
                );
              })
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onConfirm(Array.from(picked))} disabled={picked.size === 0}>
            Add {picked.size || ""} document{picked.size === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Shared field set used by both the Add and Edit question dialogs. */
function QuestionFields({
  value,
  onChange,
  categoryOptions,
  datalistId,
}: {
  value: QuestionFormValue;
  onChange: (patch: Partial<QuestionFormValue>) => void;
  categoryOptions: string[];
  datalistId: string;
}) {
  const levelOptions = Array.from(
    new Set([...KNOWN_LEVELS, ...(value.level ? [value.level] : [])]),
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-muted-foreground mb-1">Question ID</label>
        <Input
          value={value.question_id}
          onChange={(e) => onChange({ question_id: e.target.value })}
          placeholder="Leave blank to auto-generate"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-muted-foreground mb-1">Question</label>
        <Textarea value={value.input} onChange={(e) => onChange({ input: e.target.value })} rows={3} />
      </div>
      <div>
        <label className="block text-xs font-medium text-muted-foreground mb-1">
          Expected answer
        </label>
        <Textarea
          value={value.expected_output}
          onChange={(e) => onChange({ expected_output: e.target.value })}
          rows={2}
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Category</label>
          <Input
            list={datalistId}
            value={value.category}
            onChange={(e) => onChange({ category: e.target.value })}
            placeholder="e.g. bridge"
          />
          <datalist id={datalistId}>
            {categoryOptions.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Level</label>
          <select
            value={value.level}
            onChange={(e) => onChange({ level: e.target.value })}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="">{PLACEHOLDER}</option>
            {levelOptions.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-muted-foreground mb-1">
          Expected doc IDs
        </label>
        <StringListEditor
          values={value.expected_doc_ids}
          onChange={(next) => onChange({ expected_doc_ids: next })}
          placeholder="e.g. hotpotqa_d3a4c096a4b780ac"
          addLabel="Add doc ID manually"
          trailing={
            <Button
              type="button"
              size="sm"
              className="gap-1.5"
              onClick={() => setPickerOpen(true)}
            >
              <Search className="h-3.5 w-3.5" />
              Pick from corpus
            </Button>
          }
        />
        <p className="mt-1 text-[11px] text-muted-foreground">
          Corpus document IDs this question should retrieve — used for retrieval scoring. Leave empty
          if not applicable.
        </p>
      </div>

      {pickerOpen && (
        <DocumentPicker
          existing={value.expected_doc_ids.map((s) => s.trim()).filter(Boolean)}
          onClose={() => setPickerOpen(false)}
          onConfirm={(ids) => {
            const merged = Array.from(
              new Set([...value.expected_doc_ids.map((s) => s.trim()).filter(Boolean), ...ids]),
            );
            onChange({ expected_doc_ids: merged });
            setPickerOpen(false);
          }}
        />
      )}
    </div>
  );
}

function EditQuestionDialog({
  item,
  categoryOptions,
  onClose,
  onSave,
}: {
  item: QuestionSetItem;
  categoryOptions: string[];
  onClose: () => void;
  onSave: (patch: {
    question_id?: string | null;
    input: string;
    expected_output?: string | null;
    category?: string | null;
    level?: string | null;
    expected_doc_ids?: string[];
  }) => Promise<void>;
}) {
  const [value, setValue] = useState<QuestionFormValue>({
    question_id: item.question_id ?? "",
    input: item.input,
    expected_output: item.expected_output ?? "",
    category: item.category ?? "",
    level: item.level ?? "",
    expected_doc_ids: item.expected_doc_ids ?? [],
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const update = (patch: Partial<QuestionFormValue>) => setValue((v) => ({ ...v, ...patch }));

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave({
        question_id: value.question_id.trim() || null,
        input: value.input,
        expected_output: value.expected_output || null,
        category: value.category ? normalizeCategory(value.category, categoryOptions) : null,
        level: value.level || null,
        expected_doc_ids: value.expected_doc_ids.map((s) => s.trim()).filter(Boolean),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit question</DialogTitle>
          <DialogDescription>
            Blank Question ID auto-fills; empty Expected doc IDs disables retrieval scoring for this
            question.
          </DialogDescription>
        </DialogHeader>

        <QuestionFields
          value={value}
          onChange={update}
          categoryOptions={categoryOptions}
          datalistId="qs-edit-categories"
        />
        {error && <p className="text-sm text-destructive mt-3">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || !value.input.trim()}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RenameSetDialog({
  set,
  onClose,
  onSaved,
}: {
  set: QuestionSet;
  onClose: () => void;
  onSaved: (updated: QuestionSet) => void;
}) {
  const [name, setName] = useState(set.name);
  const [description, setDescription] = useState(set.description ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      onSaved(await renameQuestionSet(set.id, { name: name.trim(), description: description || null }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename question set</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="qs-rename">Name</Label>
            <Input id="qs-rename" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="qs-description">Description</Label>
            <Input
              id="qs-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || !name.trim()}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NewQuestionSetDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (created: QuestionSet) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      onCreated(
        await createQuestionSet({ name: name.trim(), description: description.trim() || undefined }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New question set</DialogTitle>
          <DialogDescription>
            Creates an empty set. Add questions to it with &ldquo;Add question&rdquo;.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="qs-new-name">Name</Label>
            <Input
              id="qs-new-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. hotpotqa manual set"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="qs-new-description">Description</Label>
            <Input
              id="qs-new-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || !name.trim()}>
            {saving ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddQuestionDialog({
  setName,
  categoryOptions,
  onClose,
  onAdd,
}: {
  setName: string;
  categoryOptions: string[];
  onClose: () => void;
  onAdd: (q: {
    question_id?: string | null;
    input: string;
    expected_output?: string | null;
    category?: string | null;
    level?: string | null;
    expected_doc_ids?: string[];
  }) => Promise<void>;
}) {
  const [value, setValue] = useState<QuestionFormValue>({
    question_id: "",
    input: "",
    expected_output: "",
    category: "",
    level: "",
    expected_doc_ids: [],
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const update = (patch: Partial<QuestionFormValue>) => setValue((v) => ({ ...v, ...patch }));

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await onAdd({
        question_id: value.question_id.trim() || null,
        input: value.input,
        expected_output: value.expected_output || null,
        category: value.category ? normalizeCategory(value.category, categoryOptions) : null,
        level: value.level || null,
        expected_doc_ids: value.expected_doc_ids.map((s) => s.trim()).filter(Boolean),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Add failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add question</DialogTitle>
          <DialogDescription>Add a question to &ldquo;{setName}&rdquo;.</DialogDescription>
        </DialogHeader>

        <QuestionFields
          value={value}
          onChange={update}
          categoryOptions={categoryOptions}
          datalistId="qs-add-categories"
        />
        {error && <p className="text-sm text-destructive mt-3">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || !value.input.trim()}>
            {saving ? "Adding…" : "Add question"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Page 2 — Run Experiment                                             */
/* ------------------------------------------------------------------ */

const POLL_INTERVAL_MS = 2000;
const RUNS_PAGE_SIZE = 8;

// Experiments table columns — widths are in px and resizable by dragging the
// header dividers (same behaviour as the Question Sets table). These are the
// natural widths; when the container is too narrow for all of them, the
// flexible text columns below are shrunk in order — each only down to a
// comfortable minimum — so nothing overflows and no single column is crushed.
// The last column (Details button) has no label.
const RUN_FLEX_COLS: { i: number; min: number }[] = [
  { i: 2, min: 120 }, // Knowledge base — shrinks first, but only to "just right"
  { i: 3, min: 110 }, // Question set — takes the next share
  { i: 1, min: 80 }, // Experiment — last
];
const RUN_COLS: { label: string }[] = [
  { label: "Job" },
  { label: "Experiment" },
  { label: "Knowledge base" },
  { label: "Question set" },
  { label: "Top-K" },
  { label: "Max items" },
  { label: "Limit/cat" },
  { label: "Semantic weight" },
  { label: "Status" },
  { label: "" },
];
const RUN_COL_DEFAULT_WIDTHS = [80, 95, 170, 150, 65, 85, 80, 115, 115, 80];

/** Page numbers to render, with "…" gaps once there are too many to list. */
function pageWindow(current: number, count: number): (number | "…")[] {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i + 1);
  const out: (number | "…")[] = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(count - 1, current + 1);
  if (start > 2) out.push("…");
  for (let p = start; p <= end; p++) out.push(p);
  if (end < count - 1) out.push("…");
  out.push(count);
  return out;
}

type ExperimentStatus = "running" | "finished" | "failed";

/**
 * A job that errors still reports `status: "completed"` with the reason in
 * `error` and an empty summary — reading `status` alone would paint a failed
 * run green.
 */
function experimentStatus(job: EvaluationJob): ExperimentStatus {
  if (job.status === "failed") return "failed";
  if (job.status === "completed") return job.error ? "failed" : "finished";
  return "running";
}

function ExperimentStatusBadge({ status }: { status: ExperimentStatus }) {
  if (status === "finished") {
    return (
      <Badge variant="outline" className="border-green-500/40 text-green-500">
        finished
      </Badge>
    );
  }
  if (status === "failed") {
    return <Badge variant="destructive">failed</Badge>;
  }
  return (
    <Badge variant="default" className="animate-pulse">
      running
    </Badge>
  );
}

/** Run details for any row — success shows "no issues", failures show the stored
 *  error (or explain a silent 0-item failure). Refetches on open for freshness. */
function RunDetailsDialog({ job, onClose }: { job: EvaluationJob; onClose: () => void }) {
  const [detail, setDetail] = useState<EvaluationJob>(job);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getEvaluationJobStatus(job.job_id)
      .then((j) => {
        if (!cancelled) setDetail(j);
      })
      .catch(() => {
        // Fall back to the row's job — it already carries status + error.
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [job.job_id]);

  // Trust the failure signal from either source: the refetch can come back
  // without the error the list row already carried (which drew the red badge),
  // and dropping it would mislabel a failed run as "No issues".
  const errorText = detail.error ?? job.error ?? null;
  const failed =
    experimentStatus(detail) === "failed" || experimentStatus(job) === "failed";
  const status: ExperimentStatus = failed
    ? "failed"
    : experimentStatus(detail);
  const items = detail.summary?.total_items ?? job.summary?.total_items ?? 0;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Run details</DialogTitle>
          <DialogDescription>
            Job <span className="font-mono">{job.job_id.slice(0, 8)}</span> · {status}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : status === "finished" ? (
          <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-3">
            <p className="text-sm font-medium text-green-600 dark:text-green-500">No issues</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              This run completed successfully
              {items ? ` — ${items} question${items === 1 ? "" : "s"} evaluated` : ""}. Metric scores
              are on the Leaderboard tab.
            </p>
          </div>
        ) : status === "running" ? (
          <p className="text-sm text-muted-foreground">This run is still in progress.</p>
        ) : errorText ? (
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Error</label>
            <pre className="max-h-72 overflow-auto rounded-lg border border-border bg-muted/30 p-3 text-xs whitespace-pre-wrap break-words text-destructive">
              {errorText}
            </pre>
          </div>
        ) : items === 0 ? (
          <p className="text-xs text-amber-500">
            Completed with 0 evaluated questions — the run finished without scoring anything, so no
            error was stored on the job. The cause (an empty or filtered question set, or every
            question failing retrieval) is in the DeepEval service logs.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            This run failed, but no error message was stored. Check the DeepEval service logs for the
            cause.
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RunExperimentPage() {
  const [questionSets, setQuestionSets] = useState<QuestionSet[]>([]);
  const [questionSetId, setQuestionSetId] = useState<number | null>(null);
  const [datasources, setDatasources] = useState<DataSourceInfo[]>([]);
  const [datasourceId, setDatasourceId] = useState("");
  const [topK, setTopK] = useState(3);
  const [maxItems, setMaxItems] = useState(5);
  const [limitPerCategory, setLimitPerCategory] = useState(1);

  const [runs, setRuns] = useState<EvaluationJob[]>([]);
  // GET /jobs answers with status only — the config a run used comes from the
  // per-job detail endpoint, so rows are enriched a page at a time.
  const [details, setDetails] = useState<Record<string, EvaluationJob>>({});
  const [page, setPage] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  // null = still checking; drives the dot next to the panel heading.
  const [serviceHealthy, setServiceHealthy] = useState<boolean | null>(null);
  const [detailsJob, setDetailsJob] = useState<EvaluationJob | null>(null);

  // Fill the visible area with as many rows as fit rather than a fixed page size:
  // measure where the table starts and divide the remaining viewport height by a
  // row's height. Recomputed on resize.
  const tableRef = useRef<HTMLDivElement | null>(null);
  const [rowsPerPage, setRowsPerPage] = useState(RUNS_PAGE_SIZE);
  useEffect(() => {
    const measure = () => {
      const el = tableRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      const ROW_H = 44; // approx height of one row
      const HEADER_H = 42; // thead row
      // Space kept clear below the table so the note + pager buttons stay on
      // screen and the page never has to scroll vertically.
      const RESERVED = 150;
      const avail = window.innerHeight - top - HEADER_H - RESERVED;
      setRowsPerPage(Math.min(100, Math.max(5, Math.floor(avail / ROW_H))));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // Drag a header divider to resize that column (same as the Question Sets table).
  const [runColWidths, setRunColWidths] = useState<number[]>(RUN_COL_DEFAULT_WIDTHS);
  const runTableWidth = runColWidths.reduce((a, b) => a + b, 0);
  // Keep the natural widths when they fit; only when the container is too narrow
  // shrink "Knowledge base" (to a floor) so the columns don't force a horizontal
  // scroll. Skipped once the user has dragged a divider themselves.
  const userSizedCols = useRef(false);
  useEffect(() => {
    const fit = () => {
      if (userSizedCols.current) return;
      const el = tableRef.current;
      if (!el) return;
      const avail = el.clientWidth;
      const widths = [...RUN_COL_DEFAULT_WIDTHS];
      let overflow = widths.reduce((a, b) => a + b, 0) - avail;
      for (const f of RUN_FLEX_COLS) {
        if (overflow <= 0) break;
        const take = Math.min(widths[f.i] - f.min, overflow);
        if (take > 0) {
          widths[f.i] -= take;
          overflow -= take;
        }
      }
      setRunColWidths(widths);
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);
  const startRunResize = (index: number, e: ReactMouseEvent) => {
    e.preventDefault();
    userSizedCols.current = true; // stop auto-fitting once the user takes over
    const startX = e.clientX;
    const startWidth = runColWidths[index];
    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      setRunColWidths((prev) => {
        const next = [...prev];
        next[index] = Math.max(50, startWidth + dx);
        return next;
      });
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  const loadRuns = useCallback(async () => {
    try {
      const { jobs } = await listEvaluationJobs();
      setRuns(jobs);
    } catch {
      // Leave the last known list on screen — a transient list failure
      // shouldn't blank out runs the user is watching.
    }
  }, []);

  useEffect(() => {
    listQuestionSets({ limit: QUESTION_SETS_PAGE_SIZE })
      .then((res) => {
        setQuestionSets(res.items);
        setQuestionSetId(res.items[0]?.id ?? null);
      })
      .catch(() => setQuestionSets([]));

    getDataSources()
      .then((res) => setDatasources(res.datasources))
      .catch(() => setDatasources([]));

    const checkHealth = () => {
      getEvaluationServiceHealth()
        .then((res) => setServiceHealthy(res.healthy))
        .catch(() => setServiceHealthy(false));
    };
    checkHealth();
    loadRuns();

    const healthInterval = setInterval(checkHealth, 30000);
    return () => clearInterval(healthInterval);
  }, [loadRuns]);

  // Only poll while something is actually in flight, so an idle tab is quiet.
  const hasRunning = runs.some((j) => experimentStatus(j) === "running");
  useEffect(() => {
    if (!hasRunning) return;
    const timer = setInterval(loadRuns, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [hasRunning, loadRuns]);

  const runExperiment = async () => {
    if (questionSetId == null) return;
    setSubmitting(true);
    setRunError(null);
    try {
      const submitted = await runEvaluationExperiment({
        question_set_id: questionSetId,
        datasource_id: datasourceId,
        top_k: topK,
        max_items: maxItems,
        limit_per_category: limitPerCategory,
      });
      // The service only reveals a job's config once it finishes, so seed the
      // new row from what we just sent rather than leaving it blank until then.
      setDetails((prev) => ({
        ...prev,
        [submitted.job_id]: {
          ...submitted,
          config_args: {
            question_set_id: questionSetId,
            top_k: topK,
            max_items: maxItems,
            limit_per_category: limitPerCategory,
            ...(datasourceId ? { datasource_id: datasourceId } : {}),
          },
        },
      }));
      setPage(1);
      await loadRuns();
    } catch (err) {
      setRunError(err instanceof Error ? err.message : "Failed to submit experiment");
    } finally {
      setSubmitting(false);
    }
  };

  const questionSetName = (job: EvaluationJob): string => {
    const setId = job.config_args?.question_set_id;
    if (typeof setId === "number") {
      const match = questionSets.find((qs) => qs.id === setId);
      if (match) return match.name;
    }
    const recorded = job.config_args?.dataset_name;
    return typeof recorded === "string" && recorded ? recorded : PLACEHOLDER;
  };

  const knowledgeBaseName = (job: EvaluationJob): string => {
    const id = job.config_args?.datasource_id;
    if (typeof id !== "string" || !id) return "All";
    return datasources.find((ds) => ds.datasource_id === id)?.name || id;
  };

  const configNumber = (job: EvaluationJob, key: string): string => {
    const value = job.config_args?.[key];
    return typeof value === "number" ? String(value) : PLACEHOLDER;
  };

  const pageCount = Math.max(1, Math.ceil(runs.length / rowsPerPage));
  const pageRuns = runs.slice((page - 1) * rowsPerPage, page * rowsPerPage);
  // A resize can shrink the page count below the current page — snap back.
  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  // Re-fetch details only when the visible rows change or one of them changes
  // status — a job sitting at "running" keeps the same signature, so polling
  // the list doesn't drag a detail request along with every tick.
  const pageSignature = pageRuns.map((j) => `${j.job_id}:${j.status}`).join("|");
  useEffect(() => {
    if (!pageSignature) return;
    const ids = pageSignature.split("|").map((entry) => entry.split(":")[0]);
    let cancelled = false;
    Promise.all(ids.map((id) => getEvaluationJobStatus(id).catch(() => null))).then((results) => {
      if (cancelled) return;
      setDetails((prev) => {
        const next = { ...prev };
        for (const detail of results) {
          if (detail) next[detail.job_id] = detail;
        }
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [pageSignature]);

  return (
    <div className="flex-1 flex min-h-0">
      {/* Config panel */}
      <aside className="w-72 shrink-0 border-r border-border bg-card/40 p-5 space-y-4 overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Configuration</h2>
          <span
            className="flex items-center gap-1.5 text-xs text-muted-foreground"
            title={
              serviceHealthy === null
                ? "Checking evaluation service…"
                : serviceHealthy
                  ? "Evaluation service is reachable"
                  : "Evaluation service is unreachable"
            }
          >
            <span
              className={`h-2 w-2 rounded-full ${
                serviceHealthy === null
                  ? "bg-muted-foreground/50 animate-pulse"
                  : serviceHealthy
                    ? "bg-green-500"
                    : "bg-destructive"
              }`}
            />
            {serviceHealthy === null ? "Checking" : serviceHealthy ? "Online" : "Offline"}
          </span>
        </div>

        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            Experiment name
          </label>
          <Input placeholder="Not yet supported" disabled />
        </div>

        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            Knowledge base
          </label>
          <select
            value={datasourceId}
            onChange={(e) => setDatasourceId(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="">All datasources</option>
            {datasources.map((ds) => (
              <option key={ds.datasource_id} value={ds.datasource_id}>
                {ds.name || ds.datasource_id}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            Question set
          </label>
          <select
            value={questionSetId ?? ""}
            onChange={(e) => setQuestionSetId(Number(e.target.value) || null)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            disabled={questionSets.length === 0}
          >
            {questionSets.length === 0 ? (
              <option value="">No question sets uploaded yet</option>
            ) : (
              questionSets.map((qs) => (
                <option key={qs.id} value={qs.id}>
                  {qs.name} ({qs.question_count})
                </option>
              ))
            )}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Top-K</label>
          <Input
            type="number"
            min={1}
            max={20}
            value={topK}
            onChange={(e) => setTopK(Math.max(1, Number(e.target.value) || 1))}
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Max items</label>
          <Input
            type="number"
            min={1}
            max={200}
            value={maxItems}
            onChange={(e) => setMaxItems(Math.max(1, Number(e.target.value) || 1))}
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            Limit per category
          </label>
          <Input
            type="number"
            min={1}
            value={limitPerCategory}
            onChange={(e) => setLimitPerCategory(Math.max(1, Number(e.target.value) || 1))}
          />
        </div>

        {/* Retrieval weighting is not a parameter the evaluation service accepts;
            shown as a placeholder so the control has a home once it is. */}
        <div className="space-y-1.5 opacity-50">
          <div className="flex items-center justify-between">
            <label className="block text-xs font-medium text-muted-foreground">
              Semantic weight: <span className="font-mono text-foreground">0.50</span>
            </label>
            <span className="text-[11px] text-muted-foreground">Keyword: 0.50</span>
          </div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            defaultValue={0.5}
            disabled
            className="w-full accent-primary"
            title="Not yet supported by the evaluation service"
          />
          <div className="flex justify-between text-[11px] text-muted-foreground">
            <span>Keyword (0.0)</span>
            <span>Balanced (0.5)</span>
            <span>Semantic (1.0)</span>
          </div>
        </div>

        <Button
          className="w-full"
          onClick={runExperiment}
          disabled={submitting || questionSetId == null}
        >
          <Play className="h-4 w-4 mr-1" />
          {submitting ? "Submitting…" : "Run"}
        </Button>

        {runError && <p className="text-sm text-destructive">{runError}</p>}
      </aside>

      {/* Experiments table */}
      <ScrollArea className="flex-1">
        <div className="p-6 space-y-3">
          <h3 className="text-base font-semibold text-foreground">
            Experiments <span className="text-muted-foreground font-normal">({runs.length})</span>
          </h3>
          <div ref={tableRef} className="rounded-xl border border-border overflow-x-auto">
            <table className="table-fixed text-sm" style={{ width: runTableWidth }}>
              <thead>
                <tr className="bg-muted/40 text-left text-muted-foreground">
                  {RUN_COLS.map((c, i) => (
                    <th
                      key={i}
                      style={{ width: runColWidths[i] }}
                      className="relative py-2.5 px-4 font-medium select-none"
                    >
                      <span className="block truncate">{c.label}</span>
                      <div
                        onMouseDown={(e) => startRunResize(i, e)}
                        className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-primary/40"
                        title="Drag to resize"
                      />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageRuns.length === 0 && (
                  <tr>
                    <td colSpan={10} className="py-10 px-4 text-center text-muted-foreground">
                      No experiments yet — configure one on the left and hit Run.
                    </td>
                  </tr>
                )}
                {pageRuns.map((row) => {
                  // Status comes from the list (it is the freshest), config
                  // from the detail fetch that filled it in.
                  const job = { ...(details[row.job_id] ?? row), ...row };
                  return (
                    <tr key={job.job_id} className="border-t border-border/50">
                      <td className="py-2.5 px-4 overflow-hidden">
                        <div
                          className="truncate text-muted-foreground font-mono"
                          title={job.job_id}
                        >
                          {job.job_id.slice(0, 8)}
                        </div>
                      </td>
                      <td className="py-2.5 px-4 overflow-hidden">
                        <div className="truncate text-muted-foreground">{PLACEHOLDER}</div>
                      </td>
                      <td className="py-2.5 px-4 overflow-hidden">
                        <div className="truncate text-muted-foreground" title={knowledgeBaseName(job)}>
                          {knowledgeBaseName(job)}
                        </div>
                      </td>
                      <td className="py-2.5 px-4 overflow-hidden">
                        <div className="truncate text-foreground" title={questionSetName(job)}>
                          {questionSetName(job)}
                        </div>
                      </td>
                      <td className="py-2.5 px-4 overflow-hidden">
                        <div className="truncate text-muted-foreground tabular-nums">
                          {configNumber(job, "top_k")}
                        </div>
                      </td>
                      <td className="py-2.5 px-4 overflow-hidden">
                        <div className="truncate text-muted-foreground tabular-nums">
                          {configNumber(job, "max_items")}
                        </div>
                      </td>
                      <td className="py-2.5 px-4 overflow-hidden">
                        <div className="truncate text-muted-foreground tabular-nums">
                          {configNumber(job, "limit_per_category")}
                        </div>
                      </td>
                      <td className="py-2.5 px-4 overflow-hidden">
                        <div className="truncate text-muted-foreground tabular-nums">{PLACEHOLDER}</div>
                      </td>
                      <td className="py-2.5 px-4 overflow-hidden whitespace-nowrap">
                        <ExperimentStatusBadge status={experimentStatus(job)} />
                        {job.cached && (
                          <span
                            className="ml-1.5 text-[11px] text-muted-foreground"
                            title="Returned from the service's 24h cache — not a fresh run"
                          >
                            cached
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-right whitespace-nowrap">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7"
                          onClick={() => setDetailsJob(job)}
                        >
                          Details
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-muted-foreground">
            Metric scores for finished runs are on the Leaderboard tab.
          </p>

          {/* Pagination — same page-flipping as the Question Sets table */}
          {pageCount > 1 && (
            <div className="flex items-center justify-center gap-1 flex-wrap">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(1)}>
                <ChevronsLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              {pageWindow(page, pageCount).map((p, i) =>
                p === "…" ? (
                  <span key={`gap-${i}`} className="px-2 text-muted-foreground">
                    …
                  </span>
                ) : (
                  <Button
                    key={p}
                    variant={p === page ? "default" : "outline"}
                    size="sm"
                    onClick={() => setPage(p)}
                    className="min-w-9"
                  >
                    {p}
                  </Button>
                ),
              )}
              <Button
                variant="outline"
                size="sm"
                disabled={page >= pageCount}
                onClick={() => setPage(page + 1)}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= pageCount}
                onClick={() => setPage(pageCount)}
              >
                <ChevronsRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      </ScrollArea>

      {detailsJob && (
        <RunDetailsDialog job={detailsJob} onClose={() => setDetailsJob(null)} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page 3 — Leaderboard                                                 */
/* ------------------------------------------------------------------ */

// Browse/compare all runs — backed by the same GET /jobs the Run Experiment
// tab used to show inline as "Recent Runs" (moved here, since "compare past
// runs" fits this tab's name/purpose better). Unlike Run Experiment, this
// view doesn't auto-poll: it's for browsing history, not watching a live
// run, so a manual Refresh is enough.
// "Job" rather than "Run name": runs have no name until the evaluation
// service can store one, so this is the job id truncated for width.
//
// Columns are grouped: identity, configuration, scale, quality scores,
// diagnosis, cost/latency, action. `Items` sits before the metrics because
// it is what makes them readable — an average over 5 questions and one over
// 200 are not the same claim.
const LEADERBOARD_BASE_COLUMNS = [
  "Job",
  "Submitted",
  "Question set",
  "Knowledge base",
  "Top-k",
  "Agent",
  "Status",
  "Items",
];
const LEADERBOARD_TRAILING_COLUMNS = [
  "Failure cause",
  "P50 latency",
  "P95 latency",
  "Tokens",
  "Eval time",
  "Results",
];
const LEADERBOARD_COLUMNS = [
  ...LEADERBOARD_BASE_COLUMNS,
  ...METRIC_FIELDS.map((m) => m.label),
  ...LEADERBOARD_TRAILING_COLUMNS,
];
const ALL_FILTER = "__all__";

/**
 * `failure_causes` is a breakdown ({none: 3, hallucination: 1}), not a scalar.
 * The cell shows the most common actual failure — "none" is the healthy case
 * and never the headline — with the full breakdown on hover.
 */
function dominantFailureCause(
  causes: Record<string, number> | undefined,
): { label: string; detail: string } {
  if (!causes || Object.keys(causes).length === 0) {
    return { label: PLACEHOLDER, detail: "" };
  }
  const detail = Object.entries(causes)
    .map(([cause, count]) => `${cause}: ${count}`)
    .join(", ");
  const failures = Object.entries(causes).filter(([cause]) => cause !== "none");
  if (failures.length === 0) return { label: "none", detail };
  const [cause, count] = failures.sort((a, b) => b[1] - a[1])[0];
  return { label: `${cause} (${count})`, detail };
}

function LeaderboardPage() {
  const [jobs, setJobs] = useState<EvaluationJob[]>([]);
  const [questionSets, setQuestionSets] = useState<QuestionSet[]>([]);
  const [datasources, setDatasources] = useState<DataSourceInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [kbFilter, setKbFilter] = useState(ALL_FILTER);
  const [agentFilter, setAgentFilter] = useState(ALL_FILTER);
  const [sortBy, setSortBy] = useState<string>("retrieval_recall");

  // Knowledge bases come from the RAG server rather than from whatever the
  // loaded runs happen to mention, so the filter offers every datasource by
  // its human-readable name — including ones nothing has been run against.
  useEffect(() => {
    getDataSources()
      .then((res) => setDatasources(res.datasources))
      .catch(() => setDatasources([]));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [{ jobs: jobList }, { items: sets }] = await Promise.all([
        listEvaluationJobs(),
        listQuestionSets({ limit: QUESTION_SETS_PAGE_SIZE }),
      ]);
      setQuestionSets(sets);
      // GET /jobs only returns lightweight status — config_args/summary
      // live on the per-job detail endpoint, so enrich each row with one
      // extra fetch. Fine at the scale this in-memory job list runs at;
      // revisit with pagination if that stops being true.
      const enriched = await Promise.all(
        jobList.map((j) => getEvaluationJobStatus(j.job_id).catch(() => j)),
      );
      setJobs(enriched);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load runs");
      setJobs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Jobs submitted against a stored set carry both its numeric id and its name
  // at submit time. Prefer the live name (it tracks renames), fall back to the
  // recorded one, which is all a deleted set leaves behind.
  const questionSetName = (job: EvaluationJob): string => {
    const setId = job.config_args?.question_set_id;
    if (typeof setId === "number") {
      const match = questionSets.find((qs) => qs.id === setId);
      if (match) return match.name;
    }
    const recorded = job.config_args?.dataset_name;
    return typeof recorded === "string" && recorded ? recorded : PLACEHOLDER;
  };

  const metricValue = (job: EvaluationJob, key: string): string => {
    const value = job.summary?.metrics?.[key];
    return typeof value === "number" ? value.toFixed(3) : PLACEHOLDER;
  };

  const seconds = (value: number | undefined): string =>
    typeof value === "number" ? `${value.toFixed(2)}s` : PLACEHOLDER;

  const count = (value: number | undefined): string =>
    typeof value === "number" ? value.toLocaleString() : PLACEHOLDER;

  const knowledgeBaseName = (id: string): string =>
    datasources.find((ds) => ds.datasource_id === id)?.name || id;

  // Agent has no catalogue to draw from — nothing this UI submits sets one —
  // so its options stay derived from whatever the loaded runs recorded.
  const agentOptions = Array.from(
    new Set(jobs.map((j) => (j.config_args?.agent_id as string) || "").filter(Boolean)),
  ).sort();

  const sortValue = (job: EvaluationJob): number => {
    if (sortBy === "created_at") return job.created_at;
    if (sortBy === "top_k") return typeof job.config_args?.top_k === "number" ? job.config_args.top_k : -Infinity;
    const v = job.summary?.metrics?.[sortBy];
    return typeof v === "number" ? v : -Infinity;
  };

  const displayedJobs = jobs
    .filter((j) => kbFilter === ALL_FILTER || (j.config_args?.datasource_id as string) === kbFilter)
    .filter((j) => agentFilter === ALL_FILTER || (j.config_args?.agent_id as string) === agentFilter)
    .sort((a, b) => sortValue(b) - sortValue(a));

  return (
    <ScrollArea className="flex-1">
      <div className="p-6 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-base font-semibold text-foreground">Experiment leaderboard</h3>
            <p className="text-xs text-muted-foreground">
              Every run this DeepEval service instance remembers — one row per run.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {error && (
              <Badge variant="destructive" className="whitespace-normal text-right">
                {error}
              </Badge>
            )}
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              Refresh
            </Button>
          </div>
        </div>

        <div className="flex gap-2 flex-wrap">
          <select
            value={kbFilter}
            onChange={(e) => setKbFilter(e.target.value)}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value={ALL_FILTER}>Knowledge base: all</option>
            {datasources.map((ds) => (
              <option key={ds.datasource_id} value={ds.datasource_id}>
                {ds.name || ds.datasource_id}
              </option>
            ))}
          </select>
          <select
            value={agentFilter}
            onChange={(e) => setAgentFilter(e.target.value)}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            disabled={agentOptions.length === 0}
          >
            <option value={ALL_FILTER}>Agent: all</option>
            {agentOptions.map((agent) => (
              <option key={agent} value={agent}>{agent}</option>
            ))}
          </select>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="created_at">Sort by: Submitted</option>
            <option value="top_k">Sort by: Top-k</option>
            {METRIC_FIELDS.map((m) => (
              <option key={m.key} value={m.key}>Sort by: {m.label}</option>
            ))}
          </select>
        </div>

        <div className="rounded-xl border border-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/40 text-left text-muted-foreground">
                {/* The Job column is frozen: with this many columns the row
                    identity would otherwise scroll out of sight long before
                    the metrics scroll in. Frozen cells need an opaque
                    background or the scrolled content shows through. */}
                {LEADERBOARD_COLUMNS.map((col, i) => (
                  <th
                    key={col}
                    className={`py-2.5 px-4 font-medium whitespace-nowrap ${
                      i === 0 ? "sticky left-0 z-20 bg-muted border-r border-border" : ""
                    }`}
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={LEADERBOARD_COLUMNS.length} className="py-6 px-4 text-center text-muted-foreground">
                    Loading…
                  </td>
                </tr>
              ) : displayedJobs.length === 0 ? (
                <tr>
                  <td colSpan={LEADERBOARD_COLUMNS.length} className="py-6 px-4 text-center text-muted-foreground">
                    {jobs.length === 0 ? "No runs yet — go run an experiment." : "No runs match the current filters."}
                  </td>
                </tr>
              ) : (
                displayedJobs.map((job) => (
                  <tr key={job.job_id} className="border-t border-border/50">
                    <td
                      className="sticky left-0 z-10 bg-background border-r border-border py-2.5 px-4 text-muted-foreground font-mono whitespace-nowrap"
                      title={job.job_id}
                    >
                      {job.job_id.slice(0, 8)}
                    </td>
                    <td className="py-2.5 px-4 text-muted-foreground tabular-nums whitespace-nowrap">
                      {new Date(job.created_at * 1000).toLocaleString()}
                    </td>
                    <td className="py-2.5 px-4 whitespace-nowrap" title={questionSetName(job)}>
                      <span className="block truncate max-w-[200px]">{questionSetName(job)}</span>
                    </td>
                    <td className="py-2.5 px-4 text-muted-foreground whitespace-nowrap">
                      {job.config_args?.datasource_id
                        ? knowledgeBaseName(job.config_args.datasource_id as string)
                        : "All"}
                    </td>
                    <td className="py-2.5 px-4 text-muted-foreground tabular-nums whitespace-nowrap">
                      {typeof job.config_args?.top_k === "number" ? job.config_args.top_k : PLACEHOLDER}
                    </td>
                    <td className="py-2.5 px-4 text-muted-foreground whitespace-nowrap">
                      {(job.config_args?.agent_id as string) || PLACEHOLDER}
                    </td>
                    <td className="py-2.5 px-4 whitespace-nowrap">
                      <ExperimentStatusBadge status={experimentStatus(job)} />
                      {job.cached && (
                        <span
                          className="ml-1.5 text-[11px] text-muted-foreground"
                          title="Returned from the service's 24h cache — not a fresh run"
                        >
                          cached
                        </span>
                      )}
                    </td>
                    <td
                      className="py-2.5 px-4 text-muted-foreground tabular-nums whitespace-nowrap"
                      title="Questions actually evaluated, after max_items / limit_per_category"
                    >
                      {count(job.summary?.total_items)}
                    </td>
                    {METRIC_FIELDS.map((m) => (
                      <td key={m.key} className="py-2.5 px-4 tabular-nums text-muted-foreground whitespace-nowrap">
                        {metricValue(job, m.key)}
                      </td>
                    ))}
                    {(() => {
                      const failure = dominantFailureCause(job.summary?.failure_causes);
                      return (
                        <td
                          className="py-2.5 px-4 text-muted-foreground whitespace-nowrap"
                          title={failure.detail}
                        >
                          {failure.label}
                        </td>
                      );
                    })()}
                    <td className="py-2.5 px-4 text-muted-foreground tabular-nums whitespace-nowrap">
                      {seconds(job.summary?.p50_latency)}
                    </td>
                    <td className="py-2.5 px-4 text-muted-foreground tabular-nums whitespace-nowrap">
                      {seconds(job.summary?.p95_latency)}
                    </td>
                    <td
                      className="py-2.5 px-4 text-muted-foreground tabular-nums whitespace-nowrap"
                      title="Tokens the RAG pipeline used answering — the judge's own usage is not included"
                    >
                      {count(job.summary?.total_tokens)}
                    </td>
                    <td className="py-2.5 px-4 text-muted-foreground tabular-nums whitespace-nowrap">
                      {seconds(job.summary?.evaluation_time_seconds)}
                    </td>
                    <td className="py-2.5 px-4 whitespace-nowrap">
                      <Button
                        variant="ghost"
                        size="sm"
                        // A job that errored still reports "completed" but has
                        // no per-question rows to export.
                        disabled={experimentStatus(job) !== "finished"}
                        onClick={() =>
                          window.open(
                            `/api/knowledge-bases/evaluation/jobs/${job.job_id}/results?format=csv`,
                            "_blank",
                          )
                        }
                      >
                        <Download className="h-3.5 w-3.5 mr-1" />
                        CSV
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </ScrollArea>
  );
}
