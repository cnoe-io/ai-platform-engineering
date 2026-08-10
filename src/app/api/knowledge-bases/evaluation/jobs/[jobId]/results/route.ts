// GET /api/knowledge-bases/evaluation/jobs/[jobId]/results?format=csv|json
// Streams the per-question detail export for a completed job straight
// through from the DeepEval service — backs the Leaderboard's "CSV" download
// button. The browser is pointed at this URL directly (window.open), so the
// session cookie carries auth; the DeepEval API key stays server-side here.

import { ApiError, getAuthFromBearerOrSession, withErrorHandler } from '@/lib/api-middleware';
import { NextRequest, NextResponse } from 'next/server';
import { fetchJobResults } from '../../../_lib/deepeval-client';

export const GET = withErrorHandler(
  async (request: NextRequest, context: { params: Promise<{ jobId: string }> }) => {
    const { session } = await getAuthFromBearerOrSession(request);
    if (!session) {
      throw new ApiError('Unauthorized', 401);
    }

    const params = await context.params;
    const url = new URL(request.url);
    const format = url.searchParams.get('format') === 'json' ? 'json' : 'csv';

    const upstream = await fetchJobResults(params.jobId, format);
    const body = await upstream.arrayBuffer();

    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': upstream.headers.get('content-type') || (format === 'csv' ? 'text/csv' : 'application/json'),
        'Content-Disposition':
          upstream.headers.get('content-disposition') ||
          `attachment; filename="job_${params.jobId}_results.${format}"`,
      },
    });
  },
);
