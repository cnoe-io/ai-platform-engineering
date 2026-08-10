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
import { parseNumericId } from '../../_lib/shared';
import { listQuestions } from '../../_lib/upstream';

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
