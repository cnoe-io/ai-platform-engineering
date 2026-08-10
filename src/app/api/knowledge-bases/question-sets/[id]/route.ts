// GET    /api/knowledge-bases/question-sets/[id] - get one question set
// PATCH  /api/knowledge-bases/question-sets/[id] - rename / edit description
// DELETE /api/knowledge-bases/question-sets/[id] - delete a set + its questions

import {
  ApiError,
  getAuthFromBearerOrSession,
  successResponse,
  withErrorHandler,
} from '@/lib/api-middleware';
import { NextRequest } from 'next/server';
import {
  parseNumericId,
  requireQuestionSetDeleteAccess,
  requireQuestionSetWriteAccess,
} from '../_lib/shared';
import { deleteQuestionSet, getQuestionSet, updateQuestionSet } from '../_lib/upstream';

type Context = { params: Promise<{ id: string }> };

interface UpdateBody {
  name?: string;
  description?: string | null;
}

export const GET = withErrorHandler(async (request: NextRequest, context: Context) => {
  const { session } = await getAuthFromBearerOrSession(request);
  if (!session) {
    throw new ApiError('Unauthorized', 401);
  }

  const { id } = await context.params;
  return successResponse(await getQuestionSet(parseNumericId(id, 'question set')));
});

export const PATCH = withErrorHandler(async (request: NextRequest, context: Context) => {
  const { session } = await getAuthFromBearerOrSession(request);
  await requireQuestionSetWriteAccess(session);

  const { id } = await context.params;
  const setId = parseNumericId(id, 'question set');
  const body: UpdateBody = await request.json();

  const patch: UpdateBody = {};
  if (body.name !== undefined) {
    const name = body.name.trim();
    if (!name) throw new ApiError('name cannot be empty', 400, 'VALIDATION_ERROR');
    patch.name = name;
  }
  if (body.description !== undefined) patch.description = body.description;

  if (Object.keys(patch).length === 0) {
    throw new ApiError('Nothing to update', 400, 'VALIDATION_ERROR');
  }

  return successResponse(await updateQuestionSet(setId, patch));
});

export const DELETE = withErrorHandler(async (request: NextRequest, context: Context) => {
  const { session } = await getAuthFromBearerOrSession(request);
  await requireQuestionSetDeleteAccess(session);

  const { id } = await context.params;
  const setId = parseNumericId(id, 'question set');
  await deleteQuestionSet(setId);

  // Upstream answers 204; the browser client expects our usual JSON envelope.
  return successResponse({ deleted: true, question_set_id: setId });
});
