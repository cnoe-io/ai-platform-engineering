// GET /api/admin/nps - Get NPS analytics for admin dashboard

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
      { success: false, error: 'NPS feature is not enabled', code: 'NPS_DISABLED' },
      { status: 404 }
    );
  }

  if (!isMongoDBConfigured) {
    return NextResponse.json(
      {
        success: false,
        error: 'MongoDB not configured - admin features require MongoDB',
        code: 'MONGODB_NOT_CONFIGURED',
      },
      { status: 503 }
    );
  }

  return withAuth(request, async (req, user, session) => {
    const url = new URL(request.url);
    const campaignIdFilter = url.searchParams.get('campaign_id') || undefined;

    const npsResponses = await getCollection('nps_responses');
    const now = new Date();
    const last30Days = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const responseFilter: Record<string, any> = {};
    if (campaignIdFilter) {
      responseFilter.campaign_id = campaignIdFilter;
    }

    // Overall breakdown (filtered by campaign when specified)
    const allResponses = await npsResponses
      .find(responseFilter)
      .sort({ created_at: -1 })
      .toArray();

    const totalResponses = allResponses.length;

    let promoters = 0;
    let passives = 0;
    let detractors = 0;

    for (const r of allResponses) {
      if (r.score >= 9) promoters++;
      else if (r.score >= 7) passives++;
      else detractors++;
    }

    const npsScore = totalResponses > 0
      ? Math.round(((promoters - detractors) / totalResponses) * 100)
      : 0;

    // 30-day daily trend (filtered by campaign when specified)
    const trendMatch: Record<string, any> = { created_at: { $gte: last30Days } };
    if (campaignIdFilter) {
      trendMatch.campaign_id = campaignIdFilter;
    }

    const dailyAgg = await npsResponses.aggregate([
      { $match: trendMatch },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$created_at' } },
          avg_score: { $avg: '$score' },
          count: { $sum: 1 },
          promoters: {
            $sum: { $cond: [{ $gte: ['$score', 9] }, 1, 0] },
          },
          detractors: {
            $sum: { $cond: [{ $lt: ['$score', 7] }, 1, 0] },
          },
        },
      },
      { $sort: { _id: 1 } },
    ]).toArray();

    // Build 30-day trend with filled gaps
    const trendMap = new Map(
      dailyAgg.map((d: any) => [
        d._id,
        {
          avg_score: Math.round(d.avg_score * 10) / 10,
          count: d.count,
          nps: d.count > 0
            ? Math.round(((d.promoters - d.detractors) / d.count) * 100)
            : null,
        },
      ])
    );

    const trend = [];
    for (let i = 29; i >= 0; i--) {
      const dayStart = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      dayStart.setHours(0, 0, 0, 0);
      const dateKey = dayStart.toISOString().split('T')[0];
      const dayData = trendMap.get(dateKey);
      trend.push({
        date: dateKey,
        avg_score: dayData?.avg_score ?? null,
        count: dayData?.count ?? 0,
        nps: dayData?.nps ?? null,
      });
    }

    // Recent responses (last 20)
    const recentResponses = allResponses.slice(0, 20).map((r: any) => ({
      user_email: r.user_email,
      score: r.score,
      comment: r.comment,
      created_at: r.created_at,
    }));

    // Fetch campaigns with response counts
    const campaignsCol = await getCollection('nps_campaigns');
    const allCampaigns = await campaignsCol.find({}).sort({ created_at: -1 }).toArray();

    const campaigns = await Promise.all(
      allCampaigns.map(async (c: any) => {
        const responseCount = await npsResponses.countDocuments({ campaign_id: c._id.toString() });
        const isActive = new Date(c.starts_at) <= now && new Date(c.ends_at) >= now;
        return {
          _id: c._id,
          name: c.name,
          starts_at: c.starts_at,
          ends_at: c.ends_at,
          created_by: c.created_by,
          created_at: c.created_at,
          response_count: responseCount,
          status: isActive ? 'active' : new Date(c.ends_at) < now ? 'ended' : 'scheduled',
        };
      })
    );

    return successResponse({
      nps_score: npsScore,
      total_responses: totalResponses,
      breakdown: {
        promoters,
        passives,
        detractors,
        promoter_pct: totalResponses > 0 ? Math.round((promoters / totalResponses) * 100) : 0,
        passive_pct: totalResponses > 0 ? Math.round((passives / totalResponses) * 100) : 0,
        detractor_pct: totalResponses > 0 ? Math.round((detractors / totalResponses) * 100) : 0,
      },
      trend,
      recent_responses: recentResponses,
      campaigns,
    });
  });
});
