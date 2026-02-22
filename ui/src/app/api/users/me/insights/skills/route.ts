// GET /api/users/me/insights/skills - Personal skill creation and run metrics

import { NextRequest, NextResponse } from 'next/server';
import { getCollection, isMongoDBConfigured } from '@/lib/mongodb';
import {
  withAuth,
  withErrorHandler,
  successResponse,
} from '@/lib/api-middleware';
import type { AgentConfig } from '@/types/agent-config';
import type { WorkflowRun } from '@/types/workflow-run';

export const GET = withErrorHandler(async (request: NextRequest) => {
  if (!isMongoDBConfigured) {
    return NextResponse.json(
      {
        success: false,
        error: 'MongoDB not configured - skill metrics require MongoDB',
        code: 'MONGODB_NOT_CONFIGURED',
      },
      { status: 503 }
    );
  }

  return withAuth(request, async (_req, user) => {
    const configs = await getCollection<AgentConfig>('agent_configs');
    const runs = await getCollection<WorkflowRun>('workflow_runs');

    const now = new Date();
    const last30Days = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const myConfigs = await configs
      .find({ owner_id: user.email, is_system: { $ne: true } })
      .sort({ created_at: -1 })
      .toArray();

    const totalSkills = myConfigs.length;

    const byVisibility = { private: 0, team: 0, global: 0 };
    const categoryMap = new Map<string, number>();

    for (const cfg of myConfigs) {
      const vis = cfg.visibility || 'private';
      if (vis in byVisibility) byVisibility[vis as keyof typeof byVisibility]++;
      categoryMap.set(cfg.category, (categoryMap.get(cfg.category) || 0) + 1);
    }

    const byCategory = Array.from(categoryMap.entries())
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count);

    const recentSkills = myConfigs.slice(0, 10).map((c) => ({
      id: c.id,
      name: c.name,
      visibility: c.visibility || 'private',
      category: c.category,
      created_at: c.created_at instanceof Date ? c.created_at.toISOString() : String(c.created_at),
    }));

    // Daily creation timeline (last 30 days)
    const dailyCreatedAgg = await configs
      .aggregate([
        {
          $match: {
            owner_id: user.email,
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

    // Per-skill run stats
    const configIds = myConfigs.map((c) => c.id);
    let runStats: Array<{
      skill_id: string;
      skill_name: string;
      total_runs: number;
      completed: number;
      failed: number;
      success_rate: number;
      last_run: string | null;
      avg_duration_ms: number | null;
    }> = [];

    if (configIds.length > 0) {
      const runAgg = await runs
        .aggregate([
          { $match: { owner_id: user.email, workflow_id: { $in: configIds } } },
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
        ])
        .toArray();

      const nameMap = new Map(myConfigs.map((c) => [c.id, c.name]));

      runStats = runAgg.map((r) => ({
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
    }

    return successResponse({
      total_skills: totalSkills,
      by_visibility: byVisibility,
      by_category: byCategory,
      recent_skills: recentSkills,
      run_stats: runStats,
      daily_created: dailyCreated,
    });
  });
});
