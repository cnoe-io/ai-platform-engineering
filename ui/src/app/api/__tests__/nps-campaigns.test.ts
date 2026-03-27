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
      skip: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          toArray: jest.fn().mockResolvedValue([]),
        }),
      }),
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

function makeRequest(url: string, options: RequestInit = {}): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost:3000'), options);
}

const adminSession = {
  user: { email: 'admin@example.com', name: 'Admin' },
  role: 'admin',
};

const userSession = {
  user: { email: 'user@example.com', name: 'User' },
  role: 'user',
};

describe('POST /api/admin/nps/campaigns', () => {
  let POST: any;

  beforeEach(async () => {
    jest.resetModules();
    Object.keys(mockCollections).forEach((k) => delete mockCollections[k]);
    mockNpsEnabled = true;
    mockIsMongoDBConfigured = true;

    const mod = await import('@/app/api/admin/nps/campaigns/route');
    POST = mod.POST;
  });

  it('returns 404 when npsEnabled is false', async () => {
    mockNpsEnabled = false;
    mockGetServerSession.mockResolvedValue(adminSession);
    const res = await POST(
      makeRequest('/api/admin/nps/campaigns', {
        method: 'POST',
        body: JSON.stringify({ name: 'Q1 NPS', starts_at: '2026-03-01', ends_at: '2026-03-31' }),
      })
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe('NPS_DISABLED');
  });

  it('returns 503 when MongoDB not configured', async () => {
    mockIsMongoDBConfigured = false;
    mockGetServerSession.mockResolvedValue(adminSession);
    const res = await POST(
      makeRequest('/api/admin/nps/campaigns', {
        method: 'POST',
        body: JSON.stringify({ name: 'Q1 NPS', starts_at: '2026-03-01', ends_at: '2026-03-31' }),
      })
    );
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe('MONGODB_NOT_CONFIGURED');
  });

  it('returns 401 when not authenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const res = await POST(
      makeRequest('/api/admin/nps/campaigns', {
        method: 'POST',
        body: JSON.stringify({ name: 'Q1 NPS', starts_at: '2026-03-01', ends_at: '2026-03-31' }),
      })
    );
    expect(res.status).toBe(401);
  });

  it('returns 403 when user is not admin (viewer can\'t create)', async () => {
    mockGetServerSession.mockResolvedValue(userSession);
    const res = await POST(
      makeRequest('/api/admin/nps/campaigns', {
        method: 'POST',
        body: JSON.stringify({ name: 'Q1 NPS', starts_at: '2026-03-01', ends_at: '2026-03-31' }),
      })
    );
    expect(res.status).toBe(403);
  });

  it('returns 400 when name is missing', async () => {
    mockGetServerSession.mockResolvedValue(adminSession);
    const res = await POST(
      makeRequest('/api/admin/nps/campaigns', {
        method: 'POST',
        body: JSON.stringify({ starts_at: '2026-03-01', ends_at: '2026-03-31' }),
      })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('name');
  });

  it('returns 400 when starts_at or ends_at is missing', async () => {
    mockGetServerSession.mockResolvedValue(adminSession);
    const res = await POST(
      makeRequest('/api/admin/nps/campaigns', {
        method: 'POST',
        body: JSON.stringify({ name: 'Q1 NPS', ends_at: '2026-03-31' }),
      })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('starts_at');
  });

  it('returns 400 when ends_at is before starts_at', async () => {
    mockGetServerSession.mockResolvedValue(adminSession);
    const res = await POST(
      makeRequest('/api/admin/nps/campaigns', {
        method: 'POST',
        body: JSON.stringify({ name: 'Q1 NPS', starts_at: '2026-03-31', ends_at: '2026-03-01' }),
      })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('ends_at');
  });

  it('returns 400 when dates are invalid', async () => {
    mockGetServerSession.mockResolvedValue(adminSession);
    const res = await POST(
      makeRequest('/api/admin/nps/campaigns', {
        method: 'POST',
        body: JSON.stringify({ name: 'Q1 NPS', starts_at: 'not-a-date', ends_at: '2026-03-31' }),
      })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('valid dates');
  });

  it('returns 409 when campaign overlaps with existing one', async () => {
    mockGetServerSession.mockResolvedValue(adminSession);
    const campaignsCol = createMockCollection();
    campaignsCol.findOne.mockResolvedValue({
      _id: new ObjectId(),
      name: 'Existing Campaign',
      starts_at: new Date('2026-03-15'),
      ends_at: new Date('2026-04-15'),
    });
    mockCollections['nps_campaigns'] = campaignsCol;

    const res = await POST(
      makeRequest('/api/admin/nps/campaigns', {
        method: 'POST',
        body: JSON.stringify({ name: 'Q1 NPS', starts_at: '2026-03-01', ends_at: '2026-03-31' }),
      })
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain('overlaps');
  });

  it('successfully creates campaign with valid data (returns 201)', async () => {
    mockGetServerSession.mockResolvedValue(adminSession);
    const campaignsCol = createMockCollection();
    campaignsCol.findOne.mockResolvedValue(null);
    mockCollections['nps_campaigns'] = campaignsCol;

    const res = await POST(
      makeRequest('/api/admin/nps/campaigns', {
        method: 'POST',
        body: JSON.stringify({ name: 'Q1 NPS', starts_at: '2026-03-01', ends_at: '2026-03-31' }),
      })
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.name).toBe('Q1 NPS');
    expect(body.data._id).toBeDefined();
  });

  it('stores created_by as admin email', async () => {
    mockGetServerSession.mockResolvedValue(adminSession);
    const campaignsCol = createMockCollection();
    campaignsCol.findOne.mockResolvedValue(null);
    mockCollections['nps_campaigns'] = campaignsCol;

    await POST(
      makeRequest('/api/admin/nps/campaigns', {
        method: 'POST',
        body: JSON.stringify({ name: 'Q1 NPS', starts_at: '2026-03-01', ends_at: '2026-03-31' }),
      })
    );
    const inserted = campaignsCol.insertOne.mock.calls[0][0];
    expect(inserted.created_by).toBe('admin@example.com');
  });

  it('trims campaign name', async () => {
    mockGetServerSession.mockResolvedValue(adminSession);
    const campaignsCol = createMockCollection();
    campaignsCol.findOne.mockResolvedValue(null);
    mockCollections['nps_campaigns'] = campaignsCol;

    const res = await POST(
      makeRequest('/api/admin/nps/campaigns', {
        method: 'POST',
        body: JSON.stringify({ name: '  Q1 NPS  ', starts_at: '2026-03-01', ends_at: '2026-03-31' }),
      })
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.name).toBe('Q1 NPS');
  });
});

describe('GET /api/admin/nps/campaigns', () => {
  let GET: any;

  beforeEach(async () => {
    jest.resetModules();
    Object.keys(mockCollections).forEach((k) => delete mockCollections[k]);
    mockNpsEnabled = true;
    mockIsMongoDBConfigured = true;

    const mod = await import('@/app/api/admin/nps/campaigns/route');
    GET = mod.GET;
  });

  it('returns 404 when npsEnabled is false', async () => {
    mockNpsEnabled = false;
    mockGetServerSession.mockResolvedValue(adminSession);
    const res = await GET(makeRequest('/api/admin/nps/campaigns'));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe('NPS_DISABLED');
  });

  it('returns 503 when MongoDB not configured', async () => {
    mockIsMongoDBConfigured = false;
    mockGetServerSession.mockResolvedValue(adminSession);
    const res = await GET(makeRequest('/api/admin/nps/campaigns'));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe('MONGODB_NOT_CONFIGURED');
  });

  it('returns 401 when not authenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const res = await GET(makeRequest('/api/admin/nps/campaigns'));
    expect(res.status).toBe(401);
  });

  it('returns 200 for authenticated non-admin (GET lists campaigns)', async () => {
    mockGetServerSession.mockResolvedValue(userSession);
    const campaignsCol = createMockCollection();
    campaignsCol.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([]),
      }),
    });
    mockCollections['nps_campaigns'] = campaignsCol;
    mockCollections['nps_responses'] = createMockCollection();
    const res = await GET(makeRequest('/api/admin/nps/campaigns'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.campaigns).toEqual([]);
  });

  it('returns empty campaigns array when none exist', async () => {
    mockGetServerSession.mockResolvedValue(adminSession);
    const campaignsCol = createMockCollection();
    campaignsCol.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([]),
      }),
    });
    mockCollections['nps_campaigns'] = campaignsCol;
    mockCollections['nps_responses'] = createMockCollection();

    const res = await GET(makeRequest('/api/admin/nps/campaigns'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.campaigns).toEqual([]);
  });

  it('returns campaigns with response_count and status', async () => {
    mockGetServerSession.mockResolvedValue(adminSession);
    const campaignId = new ObjectId();
    const campaigns = [
      {
        _id: campaignId,
        name: 'Q1 NPS',
        starts_at: new Date('2026-01-01'),
        ends_at: new Date('2026-01-31'),
        created_at: new Date('2025-12-01'),
      },
    ];
    const campaignsCol = createMockCollection();
    campaignsCol.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue(campaigns),
      }),
    });
    const responsesCol = createMockCollection();
    responsesCol.countDocuments.mockResolvedValue(42);
    mockCollections['nps_campaigns'] = campaignsCol;
    mockCollections['nps_responses'] = responsesCol;

    const res = await GET(makeRequest('/api/admin/nps/campaigns'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.campaigns).toHaveLength(1);
    expect(body.data.campaigns[0].response_count).toBe(42);
    expect(body.data.campaigns[0].status).toBeDefined();
  });

  it('authenticated non-admin user can list campaigns', async () => {
    mockGetServerSession.mockResolvedValue(userSession);
    const campaignsCol = createMockCollection();
    campaignsCol.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([]),
      }),
    });
    mockCollections['nps_campaigns'] = campaignsCol;
    mockCollections['nps_responses'] = createMockCollection();

    const res = await GET(makeRequest('/api/admin/nps/campaigns'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.campaigns).toEqual([]);
  });

  it('correctly computes campaign status: active, ended, scheduled', async () => {
    mockGetServerSession.mockResolvedValue(adminSession);
    const now = new Date('2026-03-15');
    jest.useFakeTimers();
    jest.setSystemTime(now);

    const pastCampaign = {
      _id: new ObjectId(),
      name: 'Past',
      starts_at: new Date('2026-01-01'),
      ends_at: new Date('2026-01-31'),
      created_at: new Date('2025-12-01'),
    };
    const activeCampaign = {
      _id: new ObjectId(),
      name: 'Active',
      starts_at: new Date('2026-03-01'),
      ends_at: new Date('2026-03-31'),
      created_at: new Date('2026-02-01'),
    };
    const futureCampaign = {
      _id: new ObjectId(),
      name: 'Future',
      starts_at: new Date('2026-04-01'),
      ends_at: new Date('2026-04-30'),
      created_at: new Date('2026-03-01'),
    };

    const campaignsCol = createMockCollection();
    campaignsCol.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([pastCampaign, activeCampaign, futureCampaign]),
      }),
    });
    const responsesCol = createMockCollection();
    responsesCol.countDocuments.mockResolvedValue(0);
    mockCollections['nps_campaigns'] = campaignsCol;
    mockCollections['nps_responses'] = responsesCol;

    const res = await GET(makeRequest('/api/admin/nps/campaigns'));
    expect(res.status).toBe(200);
    const body = await res.json();

    const past = body.data.campaigns.find((c: any) => c.name === 'Past');
    const active = body.data.campaigns.find((c: any) => c.name === 'Active');
    const future = body.data.campaigns.find((c: any) => c.name === 'Future');

    expect(past.status).toBe('ended');
    expect(active.status).toBe('active');
    expect(future.status).toBe('scheduled');

    jest.useRealTimers();
  });
});

describe('PATCH /api/admin/nps/campaigns', () => {
  let PATCH: any;

  beforeEach(async () => {
    jest.resetModules();
    Object.keys(mockCollections).forEach((k) => delete mockCollections[k]);
    mockNpsEnabled = true;
    mockIsMongoDBConfigured = true;

    const mod = await import('@/app/api/admin/nps/campaigns/route');
    PATCH = mod.PATCH;
  });

  it('returns 404 when npsEnabled is false', async () => {
    mockNpsEnabled = false;
    jest.resetModules();
    const mod = await import('@/app/api/admin/nps/campaigns/route');
    const res = await mod.PATCH(makeRequest('/api/admin/nps/campaigns', {
      method: 'PATCH',
      body: JSON.stringify({ campaign_id: new ObjectId().toString() }),
    }));
    expect(res.status).toBe(404);
  });

  it('returns 503 when MongoDB not configured', async () => {
    mockIsMongoDBConfigured = false;
    jest.resetModules();
    const mod = await import('@/app/api/admin/nps/campaigns/route');
    const res = await mod.PATCH(makeRequest('/api/admin/nps/campaigns', {
      method: 'PATCH',
      body: JSON.stringify({ campaign_id: new ObjectId().toString() }),
    }));
    expect(res.status).toBe(503);
  });

  it('returns 401 when not authenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const res = await PATCH(makeRequest('/api/admin/nps/campaigns', {
      method: 'PATCH',
      body: JSON.stringify({ campaign_id: new ObjectId().toString() }),
    }));
    expect(res.status).toBe(401);
  });

  it('returns 403 when user is not admin', async () => {
    mockGetServerSession.mockResolvedValue(userSession);
    const res = await PATCH(makeRequest('/api/admin/nps/campaigns', {
      method: 'PATCH',
      body: JSON.stringify({ campaign_id: new ObjectId().toString() }),
    }));
    expect(res.status).toBe(403);
  });

  it('returns 400 when campaign_id is missing', async () => {
    mockGetServerSession.mockResolvedValue(adminSession);
    const res = await PATCH(makeRequest('/api/admin/nps/campaigns', {
      method: 'PATCH',
      body: JSON.stringify({}),
    }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when campaign_id format is invalid', async () => {
    mockGetServerSession.mockResolvedValue(adminSession);
    const campaignsCol = createMockCollection();
    mockCollections['nps_campaigns'] = campaignsCol;

    const res = await PATCH(makeRequest('/api/admin/nps/campaigns', {
      method: 'PATCH',
      body: JSON.stringify({ campaign_id: 'not-a-valid-objectid' }),
    }));
    expect(res.status).toBe(400);
  });

  it('returns 404 when campaign not found', async () => {
    mockGetServerSession.mockResolvedValue(adminSession);
    const campaignsCol = createMockCollection();
    campaignsCol.findOne.mockResolvedValue(null);
    mockCollections['nps_campaigns'] = campaignsCol;

    const res = await PATCH(makeRequest('/api/admin/nps/campaigns', {
      method: 'PATCH',
      body: JSON.stringify({ campaign_id: new ObjectId().toString() }),
    }));
    expect(res.status).toBe(404);
  });

  it('returns 400 when campaign has already ended', async () => {
    mockGetServerSession.mockResolvedValue(adminSession);
    const campaignsCol = createMockCollection();
    campaignsCol.findOne.mockResolvedValue({
      _id: new ObjectId(),
      name: 'Old Campaign',
      ends_at: new Date('2025-01-01'),
    });
    mockCollections['nps_campaigns'] = campaignsCol;

    const res = await PATCH(makeRequest('/api/admin/nps/campaigns', {
      method: 'PATCH',
      body: JSON.stringify({ campaign_id: new ObjectId().toString() }),
    }));
    expect(res.status).toBe(400);
  });

  it('successfully stops an active campaign', async () => {
    mockGetServerSession.mockResolvedValue(adminSession);
    const campaignId = new ObjectId();
    const campaignsCol = createMockCollection();
    campaignsCol.findOne.mockResolvedValue({
      _id: campaignId,
      name: 'Active Campaign',
      starts_at: new Date('2026-01-01'),
      ends_at: new Date('2026-12-31'),
    });
    campaignsCol.updateOne.mockResolvedValue({ modifiedCount: 1 });
    mockCollections['nps_campaigns'] = campaignsCol;

    const res = await PATCH(makeRequest('/api/admin/nps/campaigns', {
      method: 'PATCH',
      body: JSON.stringify({ campaign_id: campaignId.toString() }),
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.stopped).toBe(true);
    expect(body.data.ended_at).toBeDefined();

    expect(campaignsCol.updateOne).toHaveBeenCalledWith(
      { _id: campaignId },
      expect.objectContaining({
        $set: expect.objectContaining({
          stopped_by: 'admin@example.com',
        }),
      })
    );
  });

  it('records stopped_by and stopped_at in the update', async () => {
    mockGetServerSession.mockResolvedValue(adminSession);
    const campaignId = new ObjectId();
    const campaignsCol = createMockCollection();
    campaignsCol.findOne.mockResolvedValue({
      _id: campaignId,
      name: 'Scheduled Campaign',
      starts_at: new Date('2026-06-01'),
      ends_at: new Date('2026-06-30'),
    });
    mockCollections['nps_campaigns'] = campaignsCol;

    await PATCH(makeRequest('/api/admin/nps/campaigns', {
      method: 'PATCH',
      body: JSON.stringify({ campaign_id: campaignId.toString() }),
    }));

    const updateCall = campaignsCol.updateOne.mock.calls[0][1];
    expect(updateCall.$set.stopped_by).toBe('admin@example.com');
    expect(updateCall.$set.stopped_at).toBeInstanceOf(Date);
    expect(updateCall.$set.ends_at).toBeInstanceOf(Date);
  });
});
