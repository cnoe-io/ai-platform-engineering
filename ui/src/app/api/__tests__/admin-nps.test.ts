/**
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { ObjectId } from 'mongodb';

const mockGetServerSession = jest.fn();
jest.mock('next-auth', () => ({
  getServerSession: (...args: any[]) => mockGetServerSession(...args),
}));
jest.mock('@/lib/auth-config', () => ({
  authOptions: {},
  isBootstrapAdmin: jest.fn().mockReturnValue(false),
  REQUIRED_ADMIN_GROUP: '',
}));

let mockNpsEnabled = true;
jest.mock('@/lib/config', () => ({
  getConfig: (key: string) => {
    if (key === 'npsEnabled') return mockNpsEnabled;
    return key === 'ssoEnabled';
  },
}));

const mockCollections: Record<string, any> = {};
const mockGetCollection = jest.fn((name: string) => {
  if (!mockCollections[name]) mockCollections[name] = createMockCollection();
  return Promise.resolve(mockCollections[name]);
});
let mockIsMongoDBConfigured = true;
jest.mock('@/lib/mongodb', () => ({
  getCollection: (...args: any[]) => mockGetCollection(...args),
  get isMongoDBConfigured() {
    return mockIsMongoDBConfigured;
  },
}));
jest.spyOn(console, 'error').mockImplementation(() => {});
jest.spyOn(console, 'log').mockImplementation(() => {});
jest.spyOn(console, 'warn').mockImplementation(() => {});

function createMockCollection() {
  const findReturnValue = {
    sort: jest.fn().mockReturnValue({
      toArray: jest.fn().mockResolvedValue([]),
    }),
    toArray: jest.fn().mockResolvedValue([]),
  };
  return {
    find: jest.fn().mockReturnValue(findReturnValue),
    findOne: jest.fn().mockResolvedValue(null),
    insertOne: jest.fn().mockResolvedValue({ insertedId: new ObjectId() }),
    updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    countDocuments: jest.fn().mockResolvedValue(0),
    aggregate: jest.fn().mockReturnValue({
      toArray: jest.fn().mockResolvedValue([]),
    }),
  };
}

function makeRequest(url: string): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost:3000'));
}

const adminSession = {
  user: { email: 'admin@example.com', name: 'Admin' },
  role: 'admin',
};

const userSession = {
  user: { email: 'user@example.com', name: 'User' },
  role: 'user',
};

describe('GET /api/admin/nps', () => {
  let GET: any;

  beforeEach(async () => {
    jest.resetModules();
    Object.keys(mockCollections).forEach((k) => delete mockCollections[k]);
    mockGetCollection.mockClear();
    mockNpsEnabled = true;
    mockIsMongoDBConfigured = true;

    const mod = await import('@/app/api/admin/nps/route');
    GET = mod.GET;
  });

  it('returns 404 when npsEnabled is false', async () => {
    mockNpsEnabled = false;
    mockGetServerSession.mockResolvedValue(adminSession);
    const res = await GET(makeRequest('/api/admin/nps'));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe('NPS_DISABLED');
  });

  it('returns 503 when MongoDB not configured', async () => {
    mockIsMongoDBConfigured = false;
    mockGetServerSession.mockResolvedValue(adminSession);
    const res = await GET(makeRequest('/api/admin/nps'));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe('MONGODB_NOT_CONFIGURED');
  });

  it('returns 401 when not authenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const res = await GET(makeRequest('/api/admin/nps'));
    expect(res.status).toBe(401);
  });

  it('returns 200 for authenticated non-admin (no admin gate on route)', async () => {
    mockGetServerSession.mockResolvedValue(userSession);
    const npsCol = createMockCollection();
    mockCollections['nps_responses'] = npsCol;
    mockCollections['nps_campaigns'] = createMockCollection();
    const res = await GET(makeRequest('/api/admin/nps'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it('returns correct NPS score and breakdown for mixed responses', async () => {
    mockGetServerSession.mockResolvedValue(adminSession);
    const responses = [
      { score: 10, user_email: 'a@e.com', created_at: new Date(), comment: 'great' },
      { score: 9, user_email: 'b@e.com', created_at: new Date() },
      { score: 7, user_email: 'c@e.com', created_at: new Date() },
      { score: 3, user_email: 'd@e.com', created_at: new Date(), comment: 'bad' },
    ];
    const npsCol = createMockCollection();
    npsCol.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue(responses),
      }),
    });
    npsCol.aggregate.mockReturnValue({
      toArray: jest.fn().mockResolvedValue([]),
    });
    const campaignsCol = createMockCollection();
    campaignsCol.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([]),
      }),
    });
    mockCollections['nps_responses'] = npsCol;
    mockCollections['nps_campaigns'] = campaignsCol;

    const res = await GET(makeRequest('/api/admin/nps'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.nps_score).toBe(25);
    expect(body.data.total_responses).toBe(4);
    expect(body.data.breakdown.promoters).toBe(2);
    expect(body.data.breakdown.passives).toBe(1);
    expect(body.data.breakdown.detractors).toBe(1);
  });

  it('returns zero NPS for empty database', async () => {
    mockGetServerSession.mockResolvedValue(adminSession);
    const npsCol = createMockCollection();
    npsCol.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([]),
      }),
    });
    npsCol.aggregate.mockReturnValue({
      toArray: jest.fn().mockResolvedValue([]),
    });
    const campaignsCol = createMockCollection();
    campaignsCol.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([]),
      }),
    });
    mockCollections['nps_responses'] = npsCol;
    mockCollections['nps_campaigns'] = campaignsCol;

    const res = await GET(makeRequest('/api/admin/nps'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.nps_score).toBe(0);
    expect(body.data.total_responses).toBe(0);
  });

  it('returns 30-day trend array with 30 entries', async () => {
    mockGetServerSession.mockResolvedValue(adminSession);
    const npsCol = createMockCollection();
    npsCol.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([]),
      }),
    });
    npsCol.aggregate.mockReturnValue({
      toArray: jest.fn().mockResolvedValue([]),
    });
    const campaignsCol = createMockCollection();
    campaignsCol.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([]),
      }),
    });
    mockCollections['nps_responses'] = npsCol;
    mockCollections['nps_campaigns'] = campaignsCol;

    const res = await GET(makeRequest('/api/admin/nps'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.trend).toHaveLength(30);
  });

  it('returns recent_responses capped at 20', async () => {
    mockGetServerSession.mockResolvedValue(adminSession);
    const manyResponses = Array.from({ length: 25 }, (_, i) => ({
      score: 8,
      user_email: `u${i}@e.com`,
      created_at: new Date(),
    }));
    const npsCol = createMockCollection();
    npsCol.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue(manyResponses),
      }),
    });
    npsCol.aggregate.mockReturnValue({
      toArray: jest.fn().mockResolvedValue([]),
    });
    const campaignsCol = createMockCollection();
    campaignsCol.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([]),
      }),
    });
    mockCollections['nps_responses'] = npsCol;
    mockCollections['nps_campaigns'] = campaignsCol;

    const res = await GET(makeRequest('/api/admin/nps'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.recent_responses).toHaveLength(20);
  });

  it('returns campaigns array with response_count and status', async () => {
    mockGetServerSession.mockResolvedValue(adminSession);
    const campaignId = new ObjectId();
    const campaigns = [
      {
        _id: campaignId,
        name: 'Q1 NPS',
        starts_at: new Date('2026-01-01'),
        ends_at: new Date('2026-01-31'),
        created_by: 'admin@example.com',
        created_at: new Date('2025-12-01'),
      },
    ];
    const npsCol = createMockCollection();
    npsCol.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([]),
      }),
    });
    npsCol.aggregate.mockReturnValue({
      toArray: jest.fn().mockResolvedValue([]),
    });
    npsCol.countDocuments.mockResolvedValue(15);
    const campaignsCol = createMockCollection();
    campaignsCol.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue(campaigns),
      }),
    });
    mockCollections['nps_responses'] = npsCol;
    mockCollections['nps_campaigns'] = campaignsCol;

    const res = await GET(makeRequest('/api/admin/nps'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.campaigns).toHaveLength(1);
    expect(body.data.campaigns[0].response_count).toBe(15);
    expect(body.data.campaigns[0].status).toBeDefined();
  });

  it('passes campaign_id to find filter when query param is set', async () => {
    mockGetServerSession.mockResolvedValue(adminSession);
    const npsCol = createMockCollection();
    npsCol.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([]),
      }),
    });
    npsCol.aggregate.mockReturnValue({
      toArray: jest.fn().mockResolvedValue([]),
    });
    const campaignsCol = createMockCollection();
    campaignsCol.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([]),
      }),
    });
    mockCollections['nps_responses'] = npsCol;
    mockCollections['nps_campaigns'] = campaignsCol;

    await GET(makeRequest('/api/admin/nps?campaign_id=abc123'));
    expect(npsCol.find.mock.calls[0][0]).toEqual({ campaign_id: 'abc123' });
  });

  it('does not filter when no campaign_id is specified', async () => {
    mockGetServerSession.mockResolvedValue(adminSession);
    const npsCol = createMockCollection();
    npsCol.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([]),
      }),
    });
    npsCol.aggregate.mockReturnValue({
      toArray: jest.fn().mockResolvedValue([]),
    });
    const campaignsCol = createMockCollection();
    campaignsCol.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([]),
      }),
    });
    mockCollections['nps_responses'] = npsCol;
    mockCollections['nps_campaigns'] = campaignsCol;

    await GET(makeRequest('/api/admin/nps'));
    expect(npsCol.find.mock.calls[0][0]).toEqual({});
  });
});
