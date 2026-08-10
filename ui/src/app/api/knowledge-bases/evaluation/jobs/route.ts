// GET /api/knowledge-bases/evaluation/jobs - list recent Run Experiment jobs
// (backs the "Recent Runs" list so switching tabs doesn't lose track of a job)

import { ApiError, getAuthFromBearerOrSession, successResponse, withErrorHandler } from '@/lib/api-middleware';
import { NextRequest } from 'next/server';
import { listJobs } from '../_lib/deepeval-client';

export const GET = withErrorHandler(async (request: NextRequest) => {
  const { session } = await getAuthFromBearerOrSession(request);
  if (!session) {
    throw new ApiError('Unauthorized', 401);
  }

  const jobs = await listJobs();
  return successResponse({ jobs });
});
