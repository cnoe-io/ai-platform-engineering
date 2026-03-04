// GET /api/nps/active - Check for an active NPS campaign for the current user

import { NextRequest, NextResponse } from 'next/server';
import { getCollection, isMongoDBConfigured } from '@/lib/mongodb';
import { getConfig } from '@/lib/config';
import {
  withAuth,
  withErrorHandler,
  successResponse,
} from '@/lib/api-middleware';

export const GET = withErrorHandler(async (request: NextRequest) => {
  if (!getConfig('npsEnabled')) {
    return NextResponse.json(
      { success: false, data: { active: false } },
      { status: 200 }
    );
  }

  if (!isMongoDBConfigured) {
    return NextResponse.json(
      { success: false, error: 'MongoDB not configured', code: 'MONGODB_NOT_CONFIGURED' },
      { status: 503 }
    );
  }

  return withAuth(request, async (req, user) => {
    const campaigns = await getCollection('nps_campaigns');
    const now = new Date();

    const activeCampaign = await campaigns.findOne({
      starts_at: { $lte: now },
      ends_at: { $gte: now },
    });

    if (!activeCampaign) {
      return successResponse({ active: false });
    }

    return successResponse({
      active: true,
      campaign: {
        id: activeCampaign._id.toString(),
        name: activeCampaign.name,
        ends_at: activeCampaign.ends_at,
      },
    });
  });
});
