// Server-only client for the DeepEval evaluation service's Question Set
// Manager (`/api/v1/question-sets`). CAIPE no longer stores question sets
// itself — these routes are a thin authorizing proxy: our BFF checks the
// session + OpenFGA capability, then forwards with the service API key that
// must never reach the browser.
//
// Field names are passed through unchanged (`input`/`expected_output`/`level`
// /`question_id`) rather than translated back to CAIPE's old Mongo names —
// a translation layer here would only have to be undone in the UI.

import { getDeepEvalConfig } from '../../evaluation/_lib/deepeval-client';
import { ApiError } from '@/lib/api-error';

const QUESTION_SETS_PATH = '/api/v1/question-sets';

export interface UpstreamQuestionSet {
  id: number;
  name: string;
  description: string | null;
  source_format: string | null;
  created_at: string | null;
  updated_at: string | null;
  question_count: number;
  /** Category name -> number of questions in it. */
  categories: Record<string, number> | null;
}

export interface UpstreamQuestion {
  id: number;
  question_set_id: number;
  question_id: string | null;
  input: string;
  expected_output: string | null;
  category: string | null;
  level: string | null;
  expected_doc_ids: string[];
  context: unknown;
  extra: unknown;
  created_at: string | null;
  updated_at: string | null;
}

export interface UpstreamPage<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  total_pages: number;
}

export interface QuestionPatch {
  question_id?: string | null;
  input?: string;
  expected_output?: string | null;
  category?: string | null;
  level?: string | null;
  expected_doc_ids?: string[];
}

export interface QuestionListParams {
  page?: number;
  limit?: number;
  category?: string;
  level?: string;
  query?: string;
}

/**
 * Surface the upstream status code rather than collapsing everything to 502:
 * a 404 for a missing set and a 413 for an oversized upload are both things
 * the caller should see verbatim.
 */
async function upstreamError(res: Response, label: string): Promise<ApiError> {
  const text = await res.text().catch(() => '');
  let detail = text.slice(0, 300);
  try {
    const parsed = JSON.parse(text);
    if (parsed?.detail) detail = String(parsed.detail);
  } catch {
    // Not JSON — keep the raw excerpt.
  }
  return new ApiError(
    detail || `Question set service ${label} failed (HTTP ${res.status})`,
    res.status >= 400 && res.status < 500 ? res.status : 502,
    'QUESTION_SET_UPSTREAM_ERROR',
  );
}

async function request<T>(
  path: string,
  label: string,
  init?: RequestInit & { expectNoContent?: boolean },
): Promise<T> {
  const { baseUrl, apiKey } = getDeepEvalConfig();
  const { expectNoContent, headers, ...rest } = init ?? {};

  const res = await fetch(`${baseUrl}${QUESTION_SETS_PATH}${path}`, {
    ...rest,
    headers: { 'X-API-Key': apiKey, ...(headers as Record<string, string> | undefined) },
  });
  if (!res.ok) throw await upstreamError(res, label);
  if (expectNoContent || res.status === 204) return undefined as T;
  return res.json();
}

export async function listQuestionSets(params: {
  page?: number;
  limit?: number;
  query?: string;
}): Promise<UpstreamPage<UpstreamQuestionSet>> {
  const search = new URLSearchParams();
  if (params.page) search.set('page', String(params.page));
  if (params.limit) search.set('limit', String(params.limit));
  if (params.query) search.set('query', params.query);
  const qs = search.toString();
  return request(qs ? `?${qs}` : '', 'list');
}

export async function getQuestionSet(setId: number): Promise<UpstreamQuestionSet> {
  return request(`/${setId}`, 'lookup');
}

/**
 * Create a set, optionally seeding it from an uploaded file. The upstream
 * parses `.jsonl` / `.csv` / `.json` itself, so the file is forwarded as-is
 * instead of being parsed here.
 */
export async function createQuestionSet(params: {
  name: string;
  description?: string;
  file?: File;
}): Promise<UpstreamQuestionSet> {
  const form = new FormData();
  form.append('name', params.name);
  if (params.description) form.append('description', params.description);
  if (params.file) form.append('file', params.file, params.file.name);
  return request('', 'creation', { method: 'POST', body: form });
}

export async function updateQuestionSet(
  setId: number,
  patch: { name?: string; description?: string | null; source_format?: string | null },
): Promise<UpstreamQuestionSet> {
  return request(`/${setId}`, 'update', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
}

export async function deleteQuestionSet(setId: number): Promise<void> {
  return request(`/${setId}`, 'delete', { method: 'DELETE', expectNoContent: true });
}

export async function listQuestions(
  setId: number,
  params: QuestionListParams,
): Promise<UpstreamPage<UpstreamQuestion>> {
  const search = new URLSearchParams();
  if (params.page) search.set('page', String(params.page));
  if (params.limit) search.set('limit', String(params.limit));
  if (params.category) search.set('category', params.category);
  if (params.level) search.set('level', params.level);
  if (params.query) search.set('query', params.query);
  const qs = search.toString();
  return request(`/${setId}/questions${qs ? `?${qs}` : ''}`, 'question list');
}

export async function updateQuestion(
  setId: number,
  questionId: number,
  patch: QuestionPatch,
): Promise<UpstreamQuestion> {
  return request(`/${setId}/questions/${questionId}`, 'question update', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
}

export async function deleteQuestion(setId: number, questionId: number): Promise<void> {
  return request(`/${setId}/questions/${questionId}`, 'question delete', {
    method: 'DELETE',
    expectNoContent: true,
  });
}

export async function uploadQuestions(setId: number, file: File): Promise<UpstreamQuestion[]> {
  const form = new FormData();
  form.append('file', file, file.name);
  return request(`/${setId}/questions/upload`, 'question upload', {
    method: 'POST',
    body: form,
  });
}

/** Add question(s) to a set via JSON body — the service accepts a single object or a list. */
export async function addQuestions(
  setId: number,
  questions: QuestionPatch | QuestionPatch[],
): Promise<UpstreamQuestion[]> {
  return request(`/${setId}/questions`, 'question add', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(questions),
  });
}

export async function batchDeleteQuestions(
  setId: number,
  ids: number[],
): Promise<{ deleted_count: number }> {
  return request(`/${setId}/questions/batch-delete`, 'batch delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
}

/**
 * Returns the raw upstream Response so the caller can stream the body and
 * forward `Content-Type` / `Content-Disposition` through untouched — this is
 * a file download, not data we need to inspect.
 */
export async function exportQuestionSet(setId: number, format: 'jsonl' | 'csv'): Promise<Response> {
  const { baseUrl, apiKey } = getDeepEvalConfig();
  const res = await fetch(`${baseUrl}${QUESTION_SETS_PATH}/${setId}/export?format=${format}`, {
    headers: { 'X-API-Key': apiKey },
  });
  if (!res.ok) throw await upstreamError(res, 'export');
  return res;
}
