"use client";

/**
 * useAiReview — orchestrator hook for the AI Review feature.
 *
 * Owns:
 *   - Loading the per-target review config from `/api/review-configs/{target}`.
 *   - Running `POST /api/ai/review` with a hashed content payload.
 *   - Tracking the hash of the last-passing run so the UI can flip
 *     `isPassed` to false the moment content changes.
 *   - Apply / dismiss state for individual criteria.
 *
 * Deliberate non-behaviours:
 *   - We do NOT auto-rerun the review after `applyFix`. Applying a fix
 *     mutates `content` upstream → the `currentHash` effect recomputes →
 *     `isPassed` becomes false → the next Next/Save click triggers
 *     `ensurePassedOrRun`, which re-runs the review on the new content.
 *     This avoids tight feedback loops, keeps LLM cost predictable, and
 *     lets users batch multiple fixes before a single re-review.
 */

import type {
LastReview,
ReviewConfig,
ReviewContext,
ReviewEnforcement,
ReviewRequest,
ReviewResult,
} from "@/types/ai-review";
import { useCallback,useEffect,useMemo,useRef,useState } from "react";
import { applyFix as applyFixToContent } from "./apply-fix";
import { sha256Hex } from "./hash";

export type AiReviewStatus = "idle" | "running" | "ready" | "error";

/** Transient feedback flag the panel can render. `cached` means the most
 *  recent `run()` short-circuited because the content hash hadn't changed. */
export type AiReviewNotice = "cached" | null;

/**
 * Build the persistable `LastReview` summary from a `ReviewResult`. Returns
 * null when the result is missing — callers should omit the `last_review`
 * field entirely in that case rather than overwriting an existing one.
 */
export function buildLastReview(
  result: ReviewResult | null | undefined,
  target: string,
): LastReview | null {
  if (!result) return null;
  return {
    grade: result.grade,
    score: result.score,
    hash: result.hash,
    target,
    reviewed_at: new Date().toISOString(),
    passed: result.passed,
  };
}

export interface UseAiReviewArgs {
  target: string;
  content: string;
  context?: ReviewContext;
  onApplyFix: (newContent: string) => void;
}

export interface UseAiReviewResult {
  status: AiReviewStatus;
  result: ReviewResult | null;
  /** Hash of the content that produced the last passing review, or null. */
  passingHash: string | null;
  /** True iff `passingHash` matches the current content's hash. */
  isPassed: boolean;
  enforcement: ReviewEnforcement | null;
  /** Mirrors `ReviewConfig.enabled`. False when no config exists. */
  enabled: boolean;
  /** True when `enabled && enforcement === "blocking"`. */
  isBlocking: boolean;
  config: ReviewConfig | null;
  error: string | null;
  /** Criteria whose suggested fix has been applied this session. */
  appliedFixIds: Set<string>;
  /** Criteria the user has dismissed from the panel this session. */
  dismissedIds: Set<string>;
  /** Transient one-shot signal — `"cached"` after a no-op run; null otherwise. */
  notice: AiReviewNotice;
  /** Clear the current notice (panels call this after acknowledging the flag). */
  clearNotice: () => void;
  run: () => Promise<void>;
  ensurePassedOrRun: () => Promise<boolean>;
  applyFix: (criterionId: string) => void;
  applyAllFixes: () => void;
  dismiss: (criterionId: string) => void;
  /** Compute the before/after pair for a criterion's suggested fix without
   *  mutating content. Returns null when the criterion has no fix. */
  previewFix: (criterionId: string) => { before: string; after: string } | null;
}

const RATE_LIMIT_MESSAGE = (retryAfter?: string) =>
  retryAfter
    ? `Too many review requests — please retry in ${retryAfter}s.`
    : "Too many review requests — please wait a moment and try again.";

export function useAiReview({
  target,
  content,
  context,
  onApplyFix,
}: UseAiReviewArgs): UseAiReviewResult {
  const [config, setConfig] = useState<ReviewConfig | null>(null);
  const [status, setStatus] = useState<AiReviewStatus>("idle");
  const [result, setResult] = useState<ReviewResult | null>(null);
  const [passingHash, setPassingHash] = useState<string | null>(null);
  const [currentHash, setCurrentHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [appliedFixIds, setAppliedFixIds] = useState<Set<string>>(new Set());
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<AiReviewNotice>(null);

  // Latest content ref so async run() always sends fresh content.
  const contentRef = useRef(content);
  useEffect(() => {
    contentRef.current = content;
  }, [content]);

  // Latest result ref so runInternal can read the cached result without
  // forcing the callback to re-create on every result change.
  const resultRef = useRef<ReviewResult | null>(result);
  useEffect(() => {
    resultRef.current = result;
  }, [result]);

  // Keep currentHash in sync with content. Async, so isPassed lags by a tick
  // immediately after a content change — that's acceptable; the cache flips
  // before the next user interaction.
  useEffect(() => {
    let cancelled = false;
    sha256Hex(content)
      .then((h) => {
        if (!cancelled) setCurrentHash(h);
      })
      .catch(() => {
        if (!cancelled) setCurrentHash(null);
      });
    return () => {
      cancelled = true;
    };
  }, [content]);

  // Drop a stale "cached" notice the moment content changes — otherwise the
  // panel would keep showing "no changes" against fresh, unreviewed content.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: reset notice state whenever content changes
    setNotice(null);
  }, [content]);

  // Load config on mount / when target changes. 404 / network error → treat
  // as "not configured": disabled, no enforcement, button hidden in UI.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/review-configs/${encodeURIComponent(target)}`,
        );
        if (!res.ok) {
          if (!cancelled) setConfig(null);
          return;
        }
        const body = (await res.json()) as
          | ReviewConfig
          | { success: boolean; data: ReviewConfig };
        if (cancelled) return;
        // Accept either bare doc or {success, data} envelope.
        const cfg =
          typeof (body as { data?: unknown }).data === "object" &&
          (body as { data?: unknown }).data !== null
            ? ((body as { data: ReviewConfig }).data)
            : (body as ReviewConfig);
        setConfig(cfg);
      } catch {
        if (!cancelled) setConfig(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [target]);

  const enabled = !!config?.enabled;
  const enforcement: ReviewEnforcement | null = config?.enforcement ?? null;
  const isBlocking = enabled && enforcement === "blocking";
  const isPassed = passingHash !== null && passingHash === currentHash;

  /**
   * Internal worker that performs the request and returns the parsed
   * `ReviewResult` (or null on error). Splitting this out from the public
   * `run()` lets `ensurePassedOrRun` consume the result directly without
   * depending on the React state setter cycle.
   */
  const runInternal = useCallback(async (): Promise<ReviewResult | null> => {
    const liveContent = contentRef.current;
    const content_hash = await sha256Hex(liveContent);

    // Cache hit — content hasn't changed since the last review. Skip the
    // network/LLM call and return the existing result. Preserves applied
    // and dismissed sets so the panel state doesn't churn on re-clicks.
    if (resultRef.current && resultRef.current.hash === content_hash) {
      setStatus("ready");
      setError(null);
      setNotice("cached");
      return resultRef.current;
    }

    setStatus("running");
    setError(null);
    setNotice(null);
    setAppliedFixIds(new Set());
    setDismissedIds(new Set());

    try {
      const body: ReviewRequest = {
        target,
        content: liveContent,
        content_hash,
        ...(context ? { context } : {}),
      };

      const res = await fetch("/api/ai/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.status === 429) {
        const retryAfter = res.headers.get("Retry-After") ?? undefined;
        setError(RATE_LIMIT_MESSAGE(retryAfter));
        setStatus("error");
        return null;
      }

      if (!res.ok) {
        let message = `Review failed: ${res.status} ${res.statusText}`;
        try {
          const data = (await res.json()) as { error?: string };
          if (data.error) message = data.error;
        } catch {
          /* ignore parse error, keep default message */
        }
        setError(message);
        setStatus("error");
        return null;
      }

      const responseBody = (await res.json()) as
        | ReviewResult
        | { success: boolean; data: ReviewResult };
      // Backend wraps in {success, data}; accept bare too for resilience.
      const data: ReviewResult =
        typeof (responseBody as { data?: unknown }).data === "object" &&
        (responseBody as { data?: unknown }).data !== null
          ? (responseBody as { data: ReviewResult }).data
          : (responseBody as ReviewResult);
      setResult(data);
      if (data.passed) {
        setPassingHash(content_hash);
      } else {
        setPassingHash(null);
      }
      setStatus("ready");
      return data;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("error");
      return null;
    }
  }, [target, context]);

  const run = useCallback(async (): Promise<void> => {
    await runInternal();
  }, [runInternal]);

  const ensurePassedOrRun = useCallback(async (): Promise<boolean> => {
    if (!enabled || enforcement === "informational") return true;
    if (isPassed) return true;
    const fresh = await runInternal();
    return fresh?.passed ?? false;
  }, [enabled, enforcement, isPassed, runInternal]);

  const applyFix = useCallback(
    (criterionId: string) => {
      const verdict = result?.criteria.find((c) => c.id === criterionId);
      if (!verdict?.suggested_fix) return;
      const next = applyFixToContent(contentRef.current, verdict.suggested_fix);
      onApplyFix(next);
      setAppliedFixIds((prev) => {
        if (prev.has(criterionId)) return prev;
        const out = new Set(prev);
        out.add(criterionId);
        return out;
      });
    },
    [result, onApplyFix],
  );

  const applyAllFixes = useCallback(() => {
    if (!result) return;
    let working = contentRef.current;
    const newlyApplied: string[] = [];
    for (const verdict of result.criteria) {
      if (!verdict.suggested_fix) continue;
      if (appliedFixIds.has(verdict.id)) continue;
      working = applyFixToContent(working, verdict.suggested_fix);
      newlyApplied.push(verdict.id);
    }
    if (newlyApplied.length === 0) return;
    onApplyFix(working);
    setAppliedFixIds((prev) => {
      const out = new Set(prev);
      for (const id of newlyApplied) out.add(id);
      return out;
    });
  }, [result, appliedFixIds, onApplyFix]);

  const previewFix = useCallback(
    (criterionId: string): { before: string; after: string } | null => {
      const verdict = result?.criteria.find((c) => c.id === criterionId);
      if (!verdict?.suggested_fix) return null;
      const before = contentRef.current;
      const after = applyFixToContent(before, verdict.suggested_fix);
      return { before, after };
    },
    [result],
  );

  const dismiss = useCallback((criterionId: string) => {
    setDismissedIds((prev) => {
      if (prev.has(criterionId)) return prev;
      const out = new Set(prev);
      out.add(criterionId);
      return out;
    });
  }, []);

  const clearNotice = useCallback(() => {
    setNotice(null);
  }, []);

  return useMemo<UseAiReviewResult>(
    () => ({
      status,
      result,
      passingHash,
      isPassed,
      enforcement,
      enabled,
      isBlocking,
      config,
      error,
      appliedFixIds,
      dismissedIds,
      notice,
      clearNotice,
      run,
      ensurePassedOrRun,
      applyFix,
      applyAllFixes,
      dismiss,
      previewFix,
    }),
    [
      status,
      result,
      passingHash,
      isPassed,
      enforcement,
      enabled,
      isBlocking,
      config,
      error,
      appliedFixIds,
      dismissedIds,
      notice,
      clearNotice,
      run,
      ensurePassedOrRun,
      applyFix,
      applyAllFixes,
      dismiss,
      previewFix,
    ],
  );
}
