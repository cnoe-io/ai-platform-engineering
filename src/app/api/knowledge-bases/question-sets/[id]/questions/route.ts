// GET /api/knowledge-bases/question-sets/[id]/questions - paginated questions
//
// Filtering (category / level) and full-text search (query) are done upstream,
// so a search covers the whole set rather than just the loaded page.

import {
  ApiError,
  getAuthFromBearerOrSession,
  successResponse,
  withErrorHandler,
} from '@/lib/api-middleware';
import { NextRequest } from 'next/server';
import { parseNumericId, requireQuestionSetWriteAccess } from '../../_lib/shared';
import { addQuestions, listQuestions, type QuestionPatch } from '../../_lib/upstream';

export const GET = withErrorHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const { session } = await getAuthFromBearerOrSession(request);
    if (!session) {
      throw new ApiError('Unauthorized', 401);
    }

    const { id } = await context.params;
    const setId = parseNumericId(id, 'question set');

    const url = new URL(request.url);
    return successResponse(
      await listQuestions(setId, {
        page: Number(url.searchParams.get('page')) || undefined,
        limit: Number(url.searchParams.get('limit')) || undefined,
        category: url.searchParams.get('category')?.trim() || undefined,
        level: url.searchParams.get('level')?.trim() || undefined,
        query: url.searchParams.get('query')?.trim() || undefined,
      }),
    );
  },
);

// POST /api/knowledge-bases/question-sets/[id]/questions - add one question (JSON)
const EDITABLE_FIELDS = ['question_id', 'input', 'expected_output', 'category', 'level', 'expected_doc_ids'] as const;

export const POST = withErrorHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const { session } = await getAuthFromBearerOrSession(request);
    await requireQuestionSetWriteAccess(session);

    const { id } = await context.params;
    const setId = parseNumericId(id, 'question set');

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      throw new ApiError('Invalid JSON body', 400, 'VALIDATION_ERROR');
    }

    // Forward only the whitelisted fields; the set/question ids are path-derived.
    const question: Record<string, unknown> = {};
    for (const key of EDITABLE_FIELDS) {
      if (body[key] !== undefined) question[key] = body[key];
    }
    if (typeof question.input !== 'string' || !question.input.trim()) {
      throw new ApiError('A question ("input") is required', 400, 'VALIDATION_ERROR');
    }

    return successResponse(await addQuestions(setId, question as QuestionPatch), 201);
  },
);
