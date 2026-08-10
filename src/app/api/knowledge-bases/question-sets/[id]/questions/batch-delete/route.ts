// POST /api/knowledge-bases/question-sets/[id]/questions/batch-delete
//
// POST rather than DELETE because the id list travels in a request body, which
// DELETE cannot carry portably.

import {
  ApiError,
  getAuthFromBearerOrSession,
  successResponse,
  withErrorHandler,
} from '@/lib/api-middleware';
import { NextRequest } from 'next/server';
import { parseNumericId, requireQuestionSetWriteAccess } from '../../../_lib/shared';
import { batchDeleteQuestions } from '../../../_lib/upstream';

export const POST = withErrorHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const { session } = await getAuthFromBearerOrSession(request);
    await requireQuestionSetWriteAccess(session);

    const { id } = await context.params;
    const setId = parseNumericId(id, 'question set');

    const body: { ids?: unknown } = await request.json();
    if (!Array.isArray(body.ids) || body.ids.length === 0) {
      throw new ApiError('ids must be a non-empty array', 400, 'VALIDATION_ERROR');
    }
    const ids = body.ids.map((raw) => parseNumericId(String(raw), 'question'));

    return successResponse(await batchDeleteQuestions(setId, ids));
  },
);
