// POST  /api/admin/nps/campaigns - Create a new NPS campaign
// GET   /api/admin/nps/campaigns - List all campaigns
// PATCH /api/admin/nps/campaigns - Stop (end early) a campaign

import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getCollection, isMongoDBConfigured } from '@/lib/mongodb';
import { getConfig } from '@/lib/config';
import {
  withAuth,
  withErrorHandler,
  successResponse,
  requireAdmin,
  requireAdminView,
  ApiError,
} from '@/lib/api-middleware';

function npsDisabledResponse() {
  return NextResponse.json(
    { success: false, error: 'NPS feature is not enabled', code: 'NPS_DISABLED' },
    { status: 404 }
  );
}

export const POST = withErrorHandler(async (request: NextRequest) => {
  if (!getConfig('npsEnabled')) return npsDisabledResponse();

  if (!isMongoDBConfigured) {
    return NextResponse.json(
      { success: false, error: 'MongoDB not configured', code: 'MONGODB_NOT_CONFIGURED' },
      { status: 503 }
    );
  }

  return withAuth(request, async (req, user, session) => {
    requireAdmin(session);

    const body = await request.json();

    const { name, starts_at, ends_at } = body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      throw new ApiError('name is required', 400);
    }
    if (!starts_at || !ends_at) {
      throw new ApiError('starts_at and ends_at are required', 400);
    }

    const startDate = new Date(starts_at);
    const endDate = new Date(ends_at);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      throw new ApiError('starts_at and ends_at must be valid dates', 400);
    }
    if (endDate <= startDate) {
      throw new ApiError('ends_at must be after starts_at', 400);
    }

    const campaigns = await getCollection('nps_campaigns');

    // Prevent overlapping active campaigns
    const overlapping = await campaigns.findOne({
      $or: [
        { starts_at: { $lte: endDate }, ends_at: { $gte: startDate } },
      ],
    });

    if (overlapping) {
      throw new ApiError(
        `Campaign "${overlapping.name}" overlaps with the requested date range`,
        409
      );
    }

    const doc = {
      name: name.trim(),
      starts_at: startDate,
      ends_at: endDate,
      created_by: user.email,
      created_at: new Date(),
    };

    const result = await campaigns.insertOne(doc);

    return successResponse({ ...doc, _id: result.insertedId }, 201);
  });
});

export const GET = withErrorHandler(async (request: NextRequest) => {
  if (!getConfig('npsEnabled')) return npsDisabledResponse();

  if (!isMongoDBConfigured) {
    return NextResponse.json(
      { success: false, error: 'MongoDB not configured', code: 'MONGODB_NOT_CONFIGURED' },
      { status: 503 }
    );
  }

  return withAuth(request, async (req, user, session) => {
    requireAdminView(session);

    const campaigns = await getCollection('nps_campaigns');
    const npsResponses = await getCollection('nps_responses');

    const allCampaigns = await campaigns.find({}).sort({ created_at: -1 }).toArray();

    const now = new Date();
    const enriched = await Promise.all(
      allCampaigns.map(async (c: any) => {
        const responseCount = await npsResponses.countDocuments({ campaign_id: c._id.toString() });
        const isActive = new Date(c.starts_at) <= now && new Date(c.ends_at) >= now;
        return {
          ...c,
          response_count: responseCount,
          status: isActive ? 'active' : new Date(c.ends_at) < now ? 'ended' : 'scheduled',
        };
      })
    );

    return successResponse({ campaigns: enriched });
  });
});

export const PATCH = withErrorHandler(async (request: NextRequest) => {
  if (!getConfig('npsEnabled')) return npsDisabledResponse();

  if (!isMongoDBConfigured) {
    return NextResponse.json(
      { success: false, error: 'MongoDB not configured', code: 'MONGODB_NOT_CONFIGURED' },
      { status: 503 }
    );
  }

  return withAuth(request, async (req, user, session) => {
    requireAdmin(session);

    const body = await request.json();
    const { campaign_id } = body;

    if (!campaign_id || typeof campaign_id !== 'string') {
      throw new ApiError('campaign_id is required', 400);
    }

    const campaigns = await getCollection('nps_campaigns');

    let objectId: ObjectId;
    try {
      objectId = new ObjectId(campaign_id);
    } catch {
      throw new ApiError('Invalid campaign_id format', 400);
    }

    const campaign = await campaigns.findOne({ _id: objectId });
    if (!campaign) {
      throw new ApiError('Campaign not found', 404);
    }

    const now = new Date();
    if (new Date(campaign.ends_at) < now) {
      throw new ApiError('Campaign has already ended', 400);
    }

    await campaigns.updateOne(
      { _id: objectId },
      { $set: { ends_at: now, stopped_by: user.email, stopped_at: now } }
    );

    return successResponse({ stopped: true, ended_at: now });
  });
});
