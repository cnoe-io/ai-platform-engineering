// GET /api/admin/stats/checkpoints - Per-agent checkpoint persistence statistics

import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase, isMongoDBConfigured } from '@/lib/mongodb';
import {
  withAuth,
  withErrorHandler,
  successResponse,
} from '@/lib/api-middleware';

// Limits to prevent overloading MongoDB
const MAX_PEEK_DOCS = 2;          // documents per agent in data peek
const MAX_PEEK_DOC_SIZE = 2000;   // max chars per serialized document
const MAX_DISTINCT_THREADS = 500; // cap on distinct() results

/** Compute a { from, to } date range from query params.
 *  Accepts either `from`/`to` ISO strings or a `range` shorthand like "7d". */
function resolveRange(searchParams: URLSearchParams): { from: Date; to: Date; days: number } {
  const fromParam = searchParams.get('from');
  const toParam = searchParams.get('to');
  const to = toParam ? new Date(toParam) : new Date();
  if (fromParam) {
    const from = new Date(fromParam);
    const days = Math.max(1, Math.ceil((to.getTime() - from.getTime()) / 86400000));
    return { from, to, days };
  }
  const range = searchParams.get('range');
  let days: number;
  switch (range) {
    case '1h': days = 1; break;   // 1 hour still shows 1 day of chart data
    case '12h': days = 1; break;
    case '1d': case '24h': days = 1; break;
    case '7d': days = 7; break;
    case '30d': days = 30; break;
    case '90d': days = 90; break;
    default: days = 7;
  }
  const from = new Date(to.getTime() - days * 86400000);
  return { from, to, days };
}

/** Safely serialize a MongoDB doc for JSON, truncating large values. */
function serializeDoc(doc: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [key, val] of Object.entries(doc)) {
    if (key === '_id') {
      out._id = String(val);
    } else if (val instanceof Buffer || (val && typeof val === 'object' && val.buffer instanceof ArrayBuffer)) {
      out[key] = `<binary ${(val as Buffer).length || 0} bytes>`;
    } else if (typeof val === 'string' && val.length > 300) {
      out[key] = val.substring(0, 300) + `... (${val.length} chars)`;
    } else if (typeof val === 'object' && val !== null) {
      const json = JSON.stringify(val);
      if (json.length > 300) {
        out[key] = json.substring(0, 300) + `... (${json.length} chars)`;
      } else {
        out[key] = val;
      }
    } else {
      out[key] = val;
    }
  }
  return out;
}

export const GET = withErrorHandler(async (request: NextRequest) => {
  if (!isMongoDBConfigured) {
    return NextResponse.json(
      { success: false, error: 'MongoDB not configured', code: 'MONGODB_NOT_CONFIGURED' },
      { status: 503 },
    );
  }

  return withAuth(request, async (req, user, session) => {
    const { searchParams } = new URL(request.url);
    const includePeek = searchParams.get('peek') !== 'false'; // default: include
    const { days } = resolveRange(searchParams);

    const { db } = await connectToDatabase();

    // ── Discover checkpoint collections ──────────────────────────────────
    const allCollections = await db.listCollections({}, { nameOnly: true }).toArray();
    const cpCollNames = allCollections
      .map((c) => c.name)
      .filter((n: string) => n.startsWith('checkpoints_'))
      .sort();

    // ── Per-agent stats (lightweight: countDocuments + 1 findOne) ─────────
    const agents = await Promise.all(
      cpCollNames.map(async (cpColl: string) => {
        const prefix = cpColl.replace(/^checkpoints_/, '');
        const wrColl = `checkpoint_writes_${prefix}`;

        const [checkpoints, writes, latestDoc] = await Promise.all([
          db.collection(cpColl).estimatedDocumentCount().catch(() => 0),
          db.collection(wrColl).estimatedDocumentCount().catch(() => 0),
          db.collection(cpColl)
            .findOne({}, { sort: { _id: -1 }, projection: { _id: 1, thread_id: 1 } })
            .catch(() => null),
        ]);

        let latestCheckpoint: string | null = null;
        if (latestDoc?._id && typeof latestDoc._id === 'object' && 'getTimestamp' in latestDoc._id) {
          latestCheckpoint = (latestDoc._id as any).getTimestamp().toISOString();
        }

        return {
          name: prefix,
          checkpoints,
          writes,
          latest_checkpoint: latestCheckpoint,
        };
      }),
    );

    // ── Totals ───────────────────────────────────────────────────────────
    const totalCheckpoints = agents.reduce((s, a) => s + a.checkpoints, 0);
    const totalWrites = agents.reduce((s, a) => s + a.writes, 0);
    const activeAgents = agents.filter((a) => a.checkpoints > 0).length;

    // ── Thread counts (capped distinct to avoid full collection scan) ────
    const allThreadSets = new Map<string, string[]>();
    await Promise.all(
      cpCollNames.map(async (cpColl: string) => {
        try {
          // Use aggregation with $limit to cap the distinct
          const threads = await db.collection(cpColl).aggregate([
            { $group: { _id: '$thread_id' } },
            { $limit: MAX_DISTINCT_THREADS },
          ]).toArray();
          for (const t of threads) {
            const key = String(t._id);
            if (!allThreadSets.has(key)) allThreadSets.set(key, []);
            allThreadSets.get(key)!.push(cpColl);
          }
        } catch {
          // skip
        }
      }),
    );
    const totalThreads = allThreadSets.size;

    // ── Cross-contamination ──────────────────────────────────────────────
    const sharedEntries = [...allThreadSets.entries()].filter(([, colls]) => colls.length > 1);
    const crossContamination = {
      shared_threads: sharedEntries.length,
      details: sharedEntries.slice(0, 5).map(([tid, colls]) => ({
        thread_id: tid.length > 12 ? `${tid.substring(0, 8)}...` : tid,
        full_thread_id: tid,
        collections: colls,
      })),
    };

    // ── Data Peek (only if requested, with strict limits) ────────────────
    let peekData: any[] = [];
    if (includePeek) {
      const activeCollections = cpCollNames.filter((c: string) => {
        const a = agents.find((ag) => ag.name === c.replace(/_checkpoints$/, ''));
        return a && a.checkpoints > 0;
      });

      peekData = (await Promise.all(
        activeCollections.map(async (cpColl: string) => {
          const prefix = cpColl.replace(/^checkpoints_/, '');
          try {
            const docs = await db.collection(cpColl)
              .find({}, { sort: { _id: -1 }, limit: MAX_PEEK_DOCS })
              .toArray();
            if (docs.length === 0) return null;
            return {
              agent: prefix,
              collection: cpColl,
              documents: docs.map((doc) => {
                const serialized = serializeDoc(doc);
                // Final safety: cap total JSON size
                const json = JSON.stringify(serialized);
                if (json.length > MAX_PEEK_DOC_SIZE) {
                  return { _id: serialized._id, thread_id: serialized.thread_id, _truncated: `Document too large (${json.length} chars)` };
                }
                return serialized;
              }),
            };
          } catch {
            return null;
          }
        }),
      )).filter(Boolean);
    }

    // ── Daily activity ───────────────────────────────────────────────────
    const dailyMap = new Map<string, number>();
    const now = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      d.setHours(0, 0, 0, 0);
      dailyMap.set(d.toISOString().split('T')[0], 0);
    }

    const wrCollNames = cpCollNames.map((c: string) => c.replace(/^checkpoints_/, 'checkpoint_writes_'));
    for (const wrColl of wrCollNames) {
      try {
        const count = await db.collection(wrColl).estimatedDocumentCount();
        if (count > 0) {
          const today = now.toISOString().split('T')[0];
          dailyMap.set(today, (dailyMap.get(today) || 0) + count);
        }
      } catch {
        // collection may not exist
      }
    }

    const dailyActivity = [...dailyMap.entries()].map(([date, writes]) => ({ date, writes }));

    return successResponse({
      agents: agents.map((a) => ({
        ...a,
        threads: [...allThreadSets.entries()]
          .filter(([, colls]) => colls.includes(`checkpoints_${a.name}`))
          .length,
      })),
      totals: {
        total_checkpoints: totalCheckpoints,
        total_writes: totalWrites,
        total_threads: totalThreads,
        active_agents: activeAgents,
        total_agents: cpCollNames.length,
      },
      daily_activity: dailyActivity,
      cross_contamination: crossContamination,
      peek_data: peekData,
      range: searchParams.get('range') || `${days}d`,
    });
  });
});
