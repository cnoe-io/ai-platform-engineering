// PATCH  /api/knowledge-bases/question-sets/[id]/questions/[questionId] - edit one question
// DELETE /api/knowledge-bases/question-sets/[id]/questions/[questionId] - delete one question

import {
  ApiError,
  getAuthFromBearerOrSession,
  successResponse,
  withErrorHandler,
} from '@/lib/api-middleware';
import { NextRequest } from 'next/server';
import { parseNumericId, requireQuestionSetWriteAccess } from '../../../_lib/shared';
import { deleteQuestion, updateQuestion, type QuestionPatch } from '../../../_lib/upstream';

type Context = { params: Promise<{ id: string; questionId: string }> };

async function resolveIds(context: Context) {
  const { id, questionId } = await context.params;
  return {
    setId: parseNumericId(id, 'question set'),
    questionDbId: parseNumericId(questionId, 'question'),
  };
}

export const PATCH = withErrorHandler(async (request: NextRequest, context: Context) => {
  const { session } = await getAuthFromBearerOrSession(request);
  await requireQuestionSetWriteAccess(session);

  const { setId, questionDbId } = await resolveIds(context);
  const body: QuestionPatch = await request.json();

  // Only forward keys the caller actually sent — upstream does a partial
  // update, so including an absent field as null would wipe it.
  const patch: QuestionPatch = {};
  if (body.input !== undefined) {
    const input = body.input.trim();
    if (!input) throw new ApiError('input cannot be empty', 400, 'VALIDATION_ERROR');
    patch.input = input;
  }
  if (body.expected_output !== undefined) patch.expected_output = body.expected_output;
  if (body.category !== undefined) patch.category = body.category || null;
  if (body.level !== undefined) patch.level = body.level || null;
  if (body.question_id !== undefined) patch.question_id = body.question_id || null;
  if (body.expected_doc_ids !== undefined) {
    if (
      !Array.isArray(body.expected_doc_ids) ||
      !body.expected_doc_ids.every((v) => typeof v === 'string')
    ) {
      throw new ApiError('expected_doc_ids must be an array of strings', 400, 'VALIDATION_ERROR');
    }
    patch.expected_doc_ids = body.expected_doc_ids;
  }

  if (Object.keys(patch).length === 0) {
    throw new ApiError('Nothing to update', 400, 'VALIDATION_ERROR');
  }

  return successResponse(await updateQuestion(setId, questionDbId, patch));
});

export const DELETE = withErrorHandler(async (request: NextRequest, context: Context) => {
  const { session } = await getAuthFromBearerOrSession(request);
  await requireQuestionSetWriteAccess(session);

  const { setId, questionDbId } = await resolveIds(context);
  await deleteQuestion(setId, questionDbId);

  return successResponse({ deleted: true, question_id: questionDbId });
});
