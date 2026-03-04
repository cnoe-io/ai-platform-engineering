// POST /api/nps - Submit NPS (Net Promoter Score) response

import { NextRequest, NextResponse } from 'next/server';
import { getCollection, isMongoDBConfigured } from '@/lib/mongodb';
import { getConfig } from '@/lib/config';
import {
  withAuth,
  withErrorHandler,
  successResponse,
  ApiError,
} from '@/lib/api-middleware';

export const POST = withErrorHandler(async (request: NextRequest) => {
  if (!getConfig('npsEnabled')) {
    return NextResponse.json(
      { success: false, error: 'NPS feature is not enabled', code: 'NPS_DISABLED' },
      { status: 404 }
    );
  }

  if (!isMongoDBConfigured) {
    return NextResponse.json(
      {
        success: false,
        error: 'MongoDB not configured',
        code: 'MONGODB_NOT_CONFIGURED',
      },
      { status: 503 }
    );
  }

  return withAuth(request, async (req, user) => {
    const body = await request.json();

    const score = body.score;
    if (typeof score !== 'number' || score < 0 || score > 10 || !Number.isInteger(score)) {
      throw new ApiError('score must be an integer between 0 and 10', 400);
    }

    const comment = typeof body.comment === 'string' ? body.comment.trim().slice(0, 1000) : undefined;
    const campaign_id = typeof body.campaign_id === 'string' ? body.campaign_id : undefined;

    const npsResponses = await getCollection('nps_responses');

    await npsResponses.insertOne({
      user_email: user.email,
      score,
      comment: comment || undefined,
      ...(campaign_id && { campaign_id }),
      created_at: new Date(),
    });

    return successResponse({ submitted: true });
  });
});
