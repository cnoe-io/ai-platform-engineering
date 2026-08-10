// GET /api/knowledge-bases/evaluation/health - connectivity check for the
// DeepEval evaluation service, backing the status dot in Run Experiment.

import { getAuthFromBearerOrSession, successResponse, withErrorHandler } from '@/lib/api-middleware';
import { ApiError } from '@/lib/api-error';
import { NextRequest } from 'next/server';
import { checkDeepEvalHealth } from '../_lib/deepeval-client';

export const GET = withErrorHandler(async (request: NextRequest) => {
  const { session } = await getAuthFromBearerOrSession(request);
  if (!session) {
    throw new ApiError('Unauthorized', 401);
  }

  const healthy = await checkDeepEvalHealth();
  return successResponse({ healthy });
});
