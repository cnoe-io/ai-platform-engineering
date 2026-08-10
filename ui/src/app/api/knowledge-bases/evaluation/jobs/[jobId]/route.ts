// GET /api/knowledge-bases/evaluation/jobs/[jobId] - poll a Run Experiment
// job's status; once completed, includes the aggregated metric summary.

import { ApiError, getAuthFromBearerOrSession, successResponse, withErrorHandler } from '@/lib/api-middleware';
import { NextRequest } from 'next/server';
import { getJobStatus, getJobSummary } from '../../_lib/deepeval-client';

export const GET = withErrorHandler(
  async (request: NextRequest, context: { params: Promise<{ jobId: string }> }) => {
    const { session } = await getAuthFromBearerOrSession(request);
    if (!session) {
      throw new ApiError('Unauthorized', 401);
    }

    const params = await context.params;
    const jobId = params.jobId;

    const status = await getJobStatus(jobId);
    if (status.status !== 'completed') {
      return successResponse(status);
    }

    const withSummary = await getJobSummary(jobId);
    return successResponse(withSummary);
  },
);
