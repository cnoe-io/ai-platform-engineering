import { ApiError } from '@/lib/api-error';

/**
 * Thin server-side client for the standalone DeepEval evaluation service
 * (../CaipeDeepevalEvaluation, not part of this repo). Runs independently —
 * not wired into this repo's docker-compose — reachable at
 * DEEPEVAL_SERVICE_URL with a static DEEPEVAL_API_KEY. Never call this from
 * client components: the API key must stay server-side.
 */

export interface DeepEvalConfig {
  baseUrl: string;
  apiKey: string;
}

export function getDeepEvalConfig(): DeepEvalConfig {
  const baseUrl = (process.env.DEEPEVAL_SERVICE_URL || '').trim().replace(/\/$/, '');
  const apiKey = (process.env.DEEPEVAL_API_KEY || '').trim();
  if (!baseUrl || !apiKey) {
    throw new ApiError(
      'DeepEval evaluation service is not configured (DEEPEVAL_SERVICE_URL / DEEPEVAL_API_KEY)',
      503,
      'DEEPEVAL_NOT_CONFIGURED',
    );
  }
  return { baseUrl, apiKey };
}

async function deepEvalError(res: Response, label: string): Promise<ApiError> {
  const detail = await res.text().catch(() => '');
  return new ApiError(
    `DeepEval service ${label} failed: HTTP ${res.status} ${detail.slice(0, 300)}`,
    502,
    'DEEPEVAL_UPSTREAM_ERROR',
  );
}

export type JobStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface JobResponse {
  job_id: string;
  status: JobStatus;
  created_at: number;
  completed_at: number | null;
  cached: boolean;
  eval_hash: string;
  error: string | null;
}

export interface EvaluationSummary {
  total_items: number;
  evaluation_time_seconds: number;
  p50_latency: number;
  p95_latency: number;
  total_tokens: number;
  metrics: Record<string, number>;
  failure_causes: Record<string, number>;
}

export interface JobSummaryResponse extends JobResponse {
  evaluation_time: number;
  config_args: Record<string, unknown>;
  summary: EvaluationSummary;
  saved_to_db: boolean;
}

/**
 * Queue a background evaluation of a question set the service already stores.
 * It reads the questions out of its own database, so no corpus is uploaded
 * from here; the job's `config_args` echo back both the set id and its name.
 */
export async function submitQuestionSetJob(
  questionSetId: number,
  params: {
    /** Omit/empty to search across all datasources (no datasource filter applied). */
    datasourceId?: string;
    topK: number;
    maxItems: number;
    /** Omit for no per-category cap. */
    limitPerCategory?: number;
    saveToDb?: boolean;
    forceRerun?: boolean;
  },
): Promise<JobResponse> {
  const { baseUrl, apiKey } = getDeepEvalConfig();

  const res = await fetch(`${baseUrl}/eval/jobs/question-sets/${questionSetId}`, {
    method: 'POST',
    headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      answer_mode: 'generate',
      top_k: params.topK,
      max_items: params.maxItems,
      save_to_db: params.saveToDb ?? false,
      force_rerun: params.forceRerun ?? false,
      ...(params.datasourceId ? { datasource_id: params.datasourceId } : {}),
      ...(params.limitPerCategory ? { limit_per_category: params.limitPerCategory } : {}),
    }),
  });
  if (!res.ok) throw await deepEvalError(res, 'job submission');
  return res.json();
}

/**
 * List all jobs the service knows about (in-memory on the service process —
 * lost if that process restarts, but otherwise survives our own frontend
 * unmounting/remounting the Run Experiment tab). Backs the "Recent Runs"
 * list so switching tabs never loses track of an in-flight or past job.
 */
export async function listJobs(): Promise<JobResponse[]> {
  const { baseUrl, apiKey } = getDeepEvalConfig();
  const res = await fetch(`${baseUrl}/jobs`, {
    headers: { 'X-API-Key': apiKey },
  });
  if (!res.ok) throw await deepEvalError(res, 'job list lookup');
  return res.json();
}

export async function getJobStatus(jobId: string): Promise<JobResponse> {
  const { baseUrl, apiKey } = getDeepEvalConfig();
  const res = await fetch(`${baseUrl}/jobs/${encodeURIComponent(jobId)}`, {
    headers: { 'X-API-Key': apiKey },
  });
  if (!res.ok) throw await deepEvalError(res, 'job status lookup');
  return res.json();
}

/**
 * Fetch the per-question detail export (json or csv) for a completed job.
 * Returns the raw upstream Response so the caller can forward its body and
 * headers (Content-Type, Content-Disposition) straight through without
 * re-parsing — this is a file download, not data we need to inspect.
 */
export async function fetchJobResults(jobId: string, format: 'json' | 'csv'): Promise<Response> {
  const { baseUrl, apiKey } = getDeepEvalConfig();
  const res = await fetch(`${baseUrl}/jobs/${encodeURIComponent(jobId)}/results?format=${format}`, {
    headers: { 'X-API-Key': apiKey },
  });
  if (!res.ok) throw await deepEvalError(res, 'job results download');
  return res;
}

export async function getJobSummary(jobId: string): Promise<JobSummaryResponse> {
  const { baseUrl, apiKey } = getDeepEvalConfig();
  const res = await fetch(`${baseUrl}/jobs/${encodeURIComponent(jobId)}/summary`, {
    headers: { 'X-API-Key': apiKey },
  });
  if (!res.ok) throw await deepEvalError(res, 'job summary lookup');
  return res.json();
}

/**
 * `/health` needs no auth and just confirms the service is reachable — used
 * for the small status dot in the Run Experiment config panel. Never throws:
 * an unreachable/misconfigured service is a valid "unhealthy" state, not an
 * error the caller needs to handle specially.
 */
export async function checkDeepEvalHealth(): Promise<boolean> {
  const baseUrl = (process.env.DEEPEVAL_SERVICE_URL || '').trim().replace(/\/$/, '');
  if (!baseUrl) return false;
  try {
    const res = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}
