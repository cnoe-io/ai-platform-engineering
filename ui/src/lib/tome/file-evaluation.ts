import type {
  ClaimFinding,
  EvaluatorModelProfile,
  EvidenceItem,
} from "@/types/tome-evaluation";

import type { EvaluatorSignals } from "./rubric-evaluator";

const MAX_EVALUATION_OUTPUT_TOKENS = 32_000;
const OUTPUT_EXPANSION_FACTOR = 4;
const CHARS_PER_TOKEN = 3;
const MIN_CHUNK_CHARACTERS = 2_000;
const MAX_CHUNK_CHARACTERS = 8_000;
const REQUEST_OVERHEAD_TOKENS = 8_000;

export interface MarkdownChunk {
  index: number;
  startOffset: number;
  markdown: string;
}

export interface NormalizedEvaluationResponse {
  claims: ClaimFinding[];
  signals: EvaluatorSignals;
  tokens: { input: number; output: number };
  turns: number;
  costUsd?: number;
  batches: number;
  attempts: number;
  inputBudgetTokens?: number;
  outputBudgetTokens?: number;
  peakEstimatedInputTokens?: number;
}

const CLASSIFICATIONS = new Set([
  "supported",
  "partially_supported",
  "unsupported",
  "contradicted",
  "unverifiable",
]);
const CRITICAL_KINDS = new Set([
  "ownership",
  "partner_or_customer",
  "quantitative",
  "date_or_deadline",
  "commitment",
  "project_status",
  "security_or_compliance",
  "financial",
]);
const SIGNAL_NAMES = new Set([
  "semantic_fidelity",
  "conflict_disclosure",
  "source_freshness",
  "material_coverage",
  "scope_fidelity",
  "stable_page_preservation",
  "explicit_gaps",
]);

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Evaluator returned a non-object structured response.");
  }
  return value as Record<string, unknown>;
}

function nonNegativeInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : fallback;
}

function optionalPositiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.trunc(value)
    : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function normalizeClaim(value: unknown, page: string, chunk: MarkdownChunk): ClaimFinding {
  const claim = record(value);
  const exactText = typeof claim.exact_text === "string" ? claim.exact_text : "";
  if (!exactText) throw new Error("Evaluator claim is missing exact_text.");
  if (typeof claim.classification !== "string" || !CLASSIFICATIONS.has(claim.classification)) {
    throw new Error("Evaluator claim has an invalid classification.");
  }
  let start = nonNegativeInteger(claim.start_offset, -1);
  let end = nonNegativeInteger(claim.end_offset, -1);
  if (start < 0 || end < start || chunk.markdown.slice(start, end) !== exactText) {
    const first = chunk.markdown.indexOf(exactText);
    const second = first < 0 ? -1 : chunk.markdown.indexOf(exactText, first + 1);
    if (first < 0 || second >= 0) {
      throw new Error("Evaluator claim offsets do not identify unique exact text.");
    }
    start = first;
    end = first + exactText.length;
  }
  const rawCriticalKind = claim.critical_kind === "null" ? null : claim.critical_kind;
  if (rawCriticalKind !== null && rawCriticalKind !== undefined
    && (typeof rawCriticalKind !== "string" || !CRITICAL_KINDS.has(rawCriticalKind))) {
    throw new Error("Evaluator claim has an invalid critical_kind.");
  }
  const evidence = Array.isArray(claim.evidence)
    ? claim.evidence.map((item) => {
      const source = record(item);
      if (typeof source.evidence_item_id !== "string"
        || typeof source.canonical_uri !== "string"
        || typeof source.content_hash !== "string") {
        throw new Error("Evaluator claim has an invalid evidence reference.");
      }
      return {
        evidence_item_id: source.evidence_item_id,
        canonical_uri: source.canonical_uri,
        content_hash: source.content_hash,
        ...(typeof source.quote === "string" ? { quote: source.quote } : {}),
      };
    })
    : [];
  const confidence = typeof claim.confidence === "number" && Number.isFinite(claim.confidence)
    ? Math.max(0, Math.min(1, claim.confidence))
    : 0;
  return {
    id: `${page}:${chunk.index}:${typeof claim.id === "string" ? claim.id : start}`,
    page,
    section: typeof claim.section === "string" ? claim.section : null,
    exact_text: exactText,
    start_offset: start + chunk.startOffset,
    end_offset: end + chunk.startOffset,
    classification: claim.classification as ClaimFinding["classification"],
    reason: typeof claim.reason === "string" ? claim.reason : "No evaluator reason supplied.",
    confidence,
    abstained: claim.abstained === true,
    citations: stringArray(claim.citations),
    evidence,
    critical_kind: rawCriticalKind as ClaimFinding["critical_kind"],
    fabricated_entities: stringArray(claim.fabricated_entities),
    fabricated_quantitative_details: stringArray(claim.fabricated_quantitative_details),
  };
}

export function pageChunkCharacterLimit(profile: EvaluatorModelProfile): number {
  const outputTokens = Math.min(profile.max_output_tokens, MAX_EVALUATION_OUTPUT_TOKENS);
  return Math.max(
    MIN_CHUNK_CHARACTERS,
    Math.min(
      MAX_CHUNK_CHARACTERS,
      Math.floor((outputTokens / OUTPUT_EXPANSION_FACTOR) * CHARS_PER_TOKEN),
    ),
  );
}

export function evaluationChunkCharacterLimit(
  requestBodyWithoutCandidate: unknown,
  profile: EvaluatorModelProfile,
): number {
  const outputBudget = Math.min(profile.max_output_tokens, MAX_EVALUATION_OUTPUT_TOKENS);
  const inputBudget = Math.floor(profile.context_window_tokens * 0.85) - outputBudget;
  const fixedInput = Math.ceil(
    JSON.stringify(requestBodyWithoutCandidate).length / CHARS_PER_TOKEN,
  ) + REQUEST_OVERHEAD_TOKENS;
  const remainingCharacters = (inputBudget - fixedInput - 1) * CHARS_PER_TOKEN;
  if (remainingCharacters < 1) {
    throw new Error(
      "Frozen evidence exceeds the evaluator input upper bound; evidence was not truncated.",
    );
  }
  return Math.max(1, Math.min(pageChunkCharacterLimit(profile), remainingCharacters));
}

export function assertEvaluationRequestFits(
  requestBody: unknown,
  profile: EvaluatorModelProfile,
): void {
  const outputBudget = Math.min(profile.max_output_tokens, MAX_EVALUATION_OUTPUT_TOKENS);
  const inputBudget = Math.floor(profile.context_window_tokens * 0.85) - outputBudget;
  const estimatedInput = Math.ceil(JSON.stringify(requestBody).length / CHARS_PER_TOKEN)
    + REQUEST_OVERHEAD_TOKENS;
  if (estimatedInput >= inputBudget) {
    throw new Error(
      `Evaluation request exceeds the model input upper bound (${estimatedInput}/${inputBudget} estimated tokens).`,
    );
  }
}

export function splitMarkdown(markdown: string, maxCharacters: number): MarkdownChunk[] {
  const limit = Math.max(1, Math.trunc(maxCharacters));
  if (markdown.length <= limit) return [{ index: 0, startOffset: 0, markdown }];
  const chunks: MarkdownChunk[] = [];
  let start = 0;
  while (start < markdown.length) {
    const hardEnd = Math.min(markdown.length, start + limit);
    let end = hardEnd;
    if (hardEnd < markdown.length) {
      const paragraph = markdown.lastIndexOf("\n\n", hardEnd);
      const line = markdown.lastIndexOf("\n", hardEnd);
      const boundary = paragraph > start + limit / 2 ? paragraph + 2 : line;
      if (boundary > start + limit / 2) end = boundary;
    }
    chunks.push({ index: chunks.length, startOffset: start, markdown: markdown.slice(start, end) });
    start = end;
  }
  return chunks;
}

export function splitMarkdownChunk(chunk: MarkdownChunk): MarkdownChunk[] {
  return splitMarkdown(chunk.markdown, Math.ceil(chunk.markdown.length / 2)).map((child) => ({
    ...child,
    index: ((chunk.index + 1) * 1_000) + child.index,
    startOffset: chunk.startOffset + child.startOffset,
  }));
}

export function abortSignalWithTimeout(
  parent: AbortSignal | undefined,
  timeoutMs: number,
): AbortSignal {
  const timeout = AbortSignal.timeout(Math.max(1, timeoutMs));
  return parent ? AbortSignal.any([parent, timeout]) : timeout;
}

export function isTransientEvaluatorFailure(error: unknown, status?: number): boolean {
  if (status && [408, 425, 429, 500, 502, 503, 504, 529].includes(status)) return true;
  const message = String((error as Error)?.message ?? error).toLowerCase();
  return [
    "408",
    "425",
    "429",
    "500",
    "502",
    "503",
    "504",
    "529",
    "rate limit",
    "temporar",
    "timeout",
    "network",
    "fetch failed",
  ].some((marker) => message.includes(marker));
}

export function isTransientPersistenceFailure(error: unknown): boolean {
  const candidate = error as {
    name?: unknown;
    message?: unknown;
    errorLabelSet?: unknown;
    hasErrorLabel?: (label: string) => boolean;
  };
  if (candidate?.hasErrorLabel?.("RetryableError")
    || candidate?.hasErrorLabel?.("SystemOverloadedError")) {
    return true;
  }
  const labels = candidate?.errorLabelSet instanceof Set
    ? [...candidate.errorLabelSet]
    : Array.isArray(candidate?.errorLabelSet)
      ? candidate.errorLabelSet
      : [];
  if (labels.some((label) => ["RetryableError", "SystemOverloadedError"].includes(String(label)))) {
    return true;
  }
  const message = `${String(candidate?.name ?? "")} ${String(candidate?.message ?? error)}`
    .toLowerCase();
  return [
    "mongonetwork",
    "mongoserverselection",
    "mongotopology",
    "mongonotconnected",
    "socket 'connect' timed out",
    "server selection timed out",
    "connection pool cleared",
    "connection closed",
    "econnreset",
    "etimedout",
  ].some((marker) => message.includes(marker));
}

export function isEvaluatorCapacityFailure(error: unknown): boolean {
  const message = String((error as Error)?.message ?? error).toLowerCase();
  return message.includes("bounded turn budget")
    || message.includes("error_max_turns")
    || message.includes("output upper bound");
}

export function isEvaluatorBudgetFailure(error: unknown): boolean {
  const message = String((error as Error)?.message ?? error).toLowerCase();
  return message.includes("cost ceiling")
    || message.includes("max budget")
    || message.includes("error_max_budget");
}

/**
 * Keep evidence that can directly support the file under review. Repeating the
 * entire frozen wiki for every file made evaluator calls slow and expensive,
 * while also increasing turn-exhaustion failures.
 */
export function evidenceForFile(
  items: EvidenceItem[],
  path: string,
  markdown: string,
  options: { includeUnreferencedScaffolding?: boolean } = {},
): EvidenceItem[] {
  const referenced = (item: EvidenceItem): boolean => {
    if (item.page_path === path) return true;
    if (markdown.includes(item.canonical_uri)) return true;
    if (!item.page_path) return false;
    return markdown.includes(item.page_path)
      || markdown.includes(`tome://${item.page_path}`)
      || markdown.includes(`](${item.page_path})`);
  };
  return items.filter((item) => {
    if (item.kind === "project_snapshot") return true;
    if (["template", "seed"].includes(item.kind)) {
      return options.includeUnreferencedScaffolding !== false || referenced(item);
    }
    return referenced(item);
  });
}

export class EvaluationBudget {
  private spent: number;
  private reserved = 0;

  constructor(
    readonly ceilingUsd: number,
    spentUsd = 0,
  ) {
    this.spent = Math.max(0, spentUsd);
  }

  get spentUsd(): number {
    return this.spent;
  }

  get reservedUsd(): number {
    return this.reserved;
  }

  get availableUsd(): number {
    return Math.max(0, this.ceilingUsd - this.spent - this.reserved);
  }

  reserve(limitUsd: number): { limitUsd: number; settle: (actualUsd?: number) => number } | null {
    const limit = Math.max(0.01, limitUsd);
    if (this.spent + this.reserved + limit > this.ceilingUsd) return null;
    this.reserved += limit;
    let settled = false;
    return {
      limitUsd: limit,
      settle: (actualUsd?: number): number => {
        if (settled) return 0;
        settled = true;
        this.reserved = Math.max(0, this.reserved - limit);
        // Failed calls often omit usage. Conservatively consume the full
        // reservation so retries and concurrent calls cannot cross the cap.
        const consumed = typeof actualUsd === "number" && Number.isFinite(actualUsd)
          ? Math.max(0, Math.min(actualUsd, limit))
          : limit;
        this.spent += consumed;
        return consumed;
      },
    };
  }

  async reserveWhenAvailable(
    limitUsd: number,
    signal?: AbortSignal,
  ): Promise<{ limitUsd: number; settle: (actualUsd?: number) => number } | null> {
    const limit = Math.max(0.01, limitUsd);
    const minimumUsefulLimit = Math.min(limit, 0.25);
    for (;;) {
      signal?.throwIfAborted();
      // A reservation can fail while another worker merely holds the funds.
      // Wait for that worker to settle instead of recording a false ceiling
      // failure. Once no worker holds funds, use the safe remaining allowance
      // for the tail call rather than requiring the default per-call maximum.
      if (this.reserved === 0) {
        const remaining = this.ceilingUsd - this.spent;
        if (remaining < minimumUsefulLimit) return null;
        const lease = this.reserve(Math.min(limit, remaining));
        if (lease) return lease;
      }
      await new Promise<void>((resolve, reject) => {
        const id = setTimeout(resolve, 50);
        signal?.addEventListener("abort", () => {
          clearTimeout(id);
          reject(new DOMException("Aborted", "AbortError"));
        }, { once: true });
      });
    }
  }
}

export async function retryWithBackoff<T>(input: {
  attempts: number;
  signal?: AbortSignal;
  action: (attempt: number) => Promise<T>;
  onAttempt?: (attempt: number) => void;
  shouldRetry?: (error: unknown) => boolean;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}): Promise<{ value: T; attempts: number }> {
  const sleep = input.sleep ?? ((milliseconds: number, signal?: AbortSignal) => new Promise<void>(
    (resolve, reject) => {
      const id = setTimeout(resolve, milliseconds);
      signal?.addEventListener("abort", () => {
        clearTimeout(id);
        reject(new DOMException("Aborted", "AbortError"));
      }, { once: true });
    },
  ));
  let lastError: unknown;
  const attempts = Math.max(1, Math.min(5, Math.trunc(input.attempts)));
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    input.signal?.throwIfAborted();
    input.onAttempt?.(attempt);
    try {
      return { value: await input.action(attempt), attempts: attempt };
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !(input.shouldRetry ?? isTransientEvaluatorFailure)(error)) {
        throw error;
      }
      await sleep(500 * (2 ** (attempt - 1)), input.signal);
    }
  }
  throw lastError;
}

export async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  worker: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let next = 0;
  const count = Math.max(1, Math.min(values.length || 1, Math.trunc(concurrency)));
  await Promise.all(Array.from({ length: count }, async () => {
    while (next < values.length) {
      const index = next;
      next += 1;
      results[index] = await worker(values[index], index);
    }
  }));
  return results;
}

export function normalizeEvaluationResponse(
  value: unknown,
  page: string,
  chunk: MarkdownChunk,
): NormalizedEvaluationResponse {
  const response = record(value);
  if (!Array.isArray(response.claims)) throw new Error("Evaluator response is missing claims.");
  const signals: EvaluatorSignals = {};
  if (response.signals !== undefined) {
    const rawSignals = record(response.signals);
    for (const [name, value] of Object.entries(rawSignals)) {
      if (!SIGNAL_NAMES.has(name)) continue;
      const signal = record(value);
      const passed = nonNegativeInteger(signal.passed, -1);
      const total = nonNegativeInteger(signal.total, -1);
      if (passed < 0 || total < 0 || passed > total) {
        throw new Error(`Evaluator response has an invalid ${name} signal.`);
      }
      signals[name as keyof EvaluatorSignals] = {
        passed,
        total,
        findings: stringArray(signal.findings),
      };
    }
  }
  const tokens = response.tokens && typeof response.tokens === "object"
    ? response.tokens as Record<string, unknown>
    : {};
  return {
    claims: response.claims.map((claim) => normalizeClaim(claim, page, chunk)),
    signals,
    tokens: {
      input: nonNegativeInteger(tokens.input, 0),
      output: nonNegativeInteger(tokens.output, 0),
    },
    turns: Math.max(1, nonNegativeInteger(response.turns, 1)),
    ...(typeof response.cost_usd === "number" && response.cost_usd >= 0
      ? { costUsd: response.cost_usd }
      : {}),
    batches: Math.max(1, nonNegativeInteger(response.batches, 1)),
    attempts: Math.max(1, nonNegativeInteger(response.attempts, 1)),
    inputBudgetTokens: optionalPositiveInteger(response.input_budget_tokens),
    outputBudgetTokens: optionalPositiveInteger(response.output_budget_tokens),
    peakEstimatedInputTokens: optionalPositiveInteger(response.peak_estimated_input_tokens),
  };
}
