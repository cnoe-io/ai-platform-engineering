// GET /api/admin/stats/skills - Platform-wide skill metrics (admin only)

import { NextRequest, NextResponse } from 'next/server';
import { getCollection, isMongoDBConfigured } from '@/lib/mongodb';
import {
  withAuth,
  withErrorHandler,
  successResponse,
  ApiError,
} from '@/lib/api-middleware';
import type { AgentConfig } from '@/types/agent-config';
import type { WorkflowRun } from '@/types/workflow-run';

export const GET = withErrorHandler(async (request: NextRequest) => {
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

  return withAuth(request, async (_req, _user, session) => {
    if (session.role !== 'admin') {
      throw new ApiError('Admin access required', 403);
    }

    const configs = await getCollection<AgentConfig>('agent_configs');
    const runs = await getCollection<WorkflowRun>('workflow_runs');

    const now = new Date();
    const last30Days = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const allConfigs = await configs.find({}).toArray();

    const systemSkills = allConfigs.filter((c) => c.is_system).length;
    const userConfigs = allConfigs.filter((c) => !c.is_system);
    const userSkills = userConfigs.length;
    const totalSkills = allConfigs.length;

    const byVisibility = { private: 0, team: 0, global: 0 };
    const categoryMap = new Map<string, number>();
    const creatorMap = new Map<string, number>();

    for (const cfg of userConfigs) {
      const vis = cfg.visibility || 'private';
      if (vis in byVisibility) byVisibility[vis as keyof typeof byVisibility]++;
      categoryMap.set(cfg.category, (categoryMap.get(cfg.category) || 0) + 1);
      creatorMap.set(cfg.owner_id, (creatorMap.get(cfg.owner_id) || 0) + 1);
    }

    const byCategory = Array.from(categoryMap.entries())
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count);

    const topCreators = Array.from(creatorMap.entries())
      .map(([email, count]) => ({ email, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 15);

    // Daily creation timeline (last 30 days, user-created only)
    const dailyCreatedAgg = await configs
      .aggregate([
        {
          $match: {
            is_system: { $ne: true },
            created_at: { $gte: last30Days },
          },
        },
        {
          $group: {
            _id: {
              $dateToString: { format: '%Y-%m-%d', date: '$created_at' },
            },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ])
      .toArray();

    const dailyCreated = dailyCreatedAgg.map((d) => ({
      date: d._id as string,
      count: d.count as number,
    }));

    // Overall run stats
    const overallRunAgg = await runs
      .aggregate([
        {
          $group: {
            _id: null,
            total_runs: { $sum: 1 },
            completed: {
              $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] },
            },
            failed: {
              $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] },
            },
            avg_duration_ms: { $avg: '$duration_ms' },
          },
        },
      ])
      .toArray();

    const overallRaw = overallRunAgg[0] || {
      total_runs: 0,
      completed: 0,
      failed: 0,
      avg_duration_ms: null,
    };

    const overallRunStats = {
      total_runs: overallRaw.total_runs as number,
      completed: overallRaw.completed as number,
      failed: overallRaw.failed as number,
      success_rate:
        overallRaw.total_runs > 0
          ? Math.round(
              ((overallRaw.completed as number) / (overallRaw.total_runs as number)) * 100
            )
          : 0,
      avg_duration_ms: overallRaw.avg_duration_ms
        ? Math.round(overallRaw.avg_duration_ms as number)
        : null,
    };

    // Top skills by run count
    const topSkillsAgg = await runs
      .aggregate([
        {
          $group: {
            _id: '$workflow_id',
            workflow_name: { $first: '$workflow_name' },
            total_runs: { $sum: 1 },
            completed: {
              $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] },
            },
            failed: {
              $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] },
            },
            last_run: { $max: '$started_at' },
            avg_duration_ms: { $avg: '$duration_ms' },
          },
        },
        { $sort: { total_runs: -1 } },
        { $limit: 15 },
      ])
      .toArray();

    const nameMap = new Map(allConfigs.map((c) => [c.id, c.name]));

    const topSkillsByRuns = topSkillsAgg.map((r) => ({
      skill_id: r._id as string,
      skill_name: nameMap.get(r._id as string) || (r.workflow_name as string) || 'Unknown',
      total_runs: r.total_runs as number,
      completed: r.completed as number,
      failed: r.failed as number,
      success_rate:
        r.total_runs > 0
          ? Math.round(((r.completed as number) / (r.total_runs as number)) * 100)
          : 0,
      last_run: r.last_run ? new Date(r.last_run as string).toISOString() : null,
      avg_duration_ms: r.avg_duration_ms ? Math.round(r.avg_duration_ms as number) : null,
    }));

    return successResponse({
      total_skills: totalSkills,
      system_skills: systemSkills,
      user_skills: userSkills,
      by_visibility: byVisibility,
      by_category: byCategory,
      top_creators: topCreators,
      daily_created: dailyCreated,
      top_skills_by_runs: topSkillsByRuns,
      overall_run_stats: overallRunStats,
    });
  });
});
