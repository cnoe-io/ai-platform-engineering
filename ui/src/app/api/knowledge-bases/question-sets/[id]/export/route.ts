// GET /api/knowledge-bases/question-sets/[id]/export?format=jsonl|csv
//
// Streams the upstream export straight through. The browser is pointed at this
// URL directly (window.open), so the session cookie carries auth while the
// service API key stays server-side.

import { ApiError, getAuthFromBearerOrSession, withErrorHandler } from '@/lib/api-middleware';
import { NextRequest, NextResponse } from 'next/server';
import { parseNumericId } from '../../_lib/shared';
import { exportQuestionSet } from '../../_lib/upstream';

export const GET = withErrorHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const { session } = await getAuthFromBearerOrSession(request);
    if (!session) {
      throw new ApiError('Unauthorized', 401);
    }

    const { id } = await context.params;
    const setId = parseNumericId(id, 'question set');
    const format = new URL(request.url).searchParams.get('format') === 'csv' ? 'csv' : 'jsonl';

    const upstream = await exportQuestionSet(setId, format);
    const body = await upstream.arrayBuffer();

    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type':
          upstream.headers.get('content-type') ||
          (format === 'csv' ? 'text/csv' : 'application/x-ndjson'),
        'Content-Disposition':
          upstream.headers.get('content-disposition') ||
          `attachment; filename="question_set_${setId}.${format}"`,
      },
    });
  },
);
