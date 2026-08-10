// POST /api/knowledge-bases/evaluation/run - submit a Run Experiment job to
// the DeepEval evaluation service against a stored question set + datasource.
//
// The question set already lives in the evaluation service, so we just name it
// by id: the service materializes the questions itself. Nothing is read out,
// converted to JSONL and re-uploaded from here.

import {
  ApiError,
  getAuthFromBearerOrSession,
  successResponse,
  withErrorHandler,
} from '@/lib/api-middleware';
import { NextRequest } from 'next/server';
import { parseNumericId, requireQuestionSetWriteAccess } from '../../question-sets/_lib/shared';
import { submitQuestionSetJob } from '../_lib/deepeval-client';

const MAX_TOP_K = 20;
const MAX_ITEMS_CAP = 200;

interface RunRequestBody {
  question_set_id?: number | string;
  datasource_id?: string;
  top_k?: number;
  max_items?: number;
  limit_per_category?: number;
  force_rerun?: boolean;
}

export const POST = withErrorHandler(async (request: NextRequest) => {
  const { session } = await getAuthFromBearerOrSession(request);
  await requireQuestionSetWriteAccess(session);

  const body: RunRequestBody = await request.json();

  if (body.question_set_id === undefined || body.question_set_id === null) {
    throw new ApiError('A question_set_id is required', 400, 'VALIDATION_ERROR');
  }
  const questionSetId = parseNumericId(String(body.question_set_id), 'question set');

  // Empty/omitted datasourceId means "search all datasources" — left undefined
  // so the service applies no datasource filter.
  const datasourceId = (body.datasource_id || '').trim() || undefined;

  const topK = Number(body.top_k ?? 3);
  if (!Number.isInteger(topK) || topK < 1 || topK > MAX_TOP_K) {
    throw new ApiError(`top_k must be an integer between 1 and ${MAX_TOP_K}`, 400, 'VALIDATION_ERROR');
  }
  const maxItems = Number(body.max_items ?? 5);
  if (!Number.isInteger(maxItems) || maxItems < 1 || maxItems > MAX_ITEMS_CAP) {
    throw new ApiError(`max_items must be an integer between 1 and ${MAX_ITEMS_CAP}`, 400, 'VALIDATION_ERROR');
  }

  // Omitted means "no per-category cap", which is also the service's default.
  let limitPerCategory: number | undefined;
  if (body.limit_per_category !== undefined && body.limit_per_category !== null) {
    limitPerCategory = Number(body.limit_per_category);
    if (!Number.isInteger(limitPerCategory) || limitPerCategory < 1) {
      throw new ApiError('limit_per_category must be a positive integer', 400, 'VALIDATION_ERROR');
    }
  }

  const job = await submitQuestionSetJob(questionSetId, {
    datasourceId,
    topK,
    maxItems,
    limitPerCategory,
    saveToDb: false,
    forceRerun: body.force_rerun ?? false,
  });

  return successResponse(job, 202);
});
