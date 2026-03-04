/**
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { ObjectId } from 'mongodb';

const mockGetServerSession = jest.fn();
jest.mock('next-auth', () => ({
  getServerSession: (...args: any[]) => mockGetServerSession(...args),
}));
jest.mock('@/lib/auth-config', () => ({ authOptions: {} }));

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

function userSession() {
  return {
    user: { email: 'user@example.com', name: 'User' },
    role: 'user',
    canViewAdmin: false,
  };
}

function adminSession() {
  return {
    user: { email: 'admin@example.com', name: 'Admin' },
    role: 'admin',
    canViewAdmin: true,
  };
}

describe('POST /api/nps', () => {
  let POST: any;

  beforeEach(async () => {
    jest.resetModules();
    Object.keys(mockCollections).forEach((k) => delete mockCollections[k]);
    mockGetCollection.mockClear();
    mockNpsEnabled = true;
    mockIsMongoDBConfigured = true;

    const mod = await import('@/app/api/nps/route');
    POST = mod.POST;
  });

  it('returns 404 when npsEnabled is false', async () => {
    mockNpsEnabled = false;
    mockGetServerSession.mockResolvedValue(userSession());
    const res = await POST(
      makeRequest('/api/nps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ score: 9 }),
      })
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe('NPS_DISABLED');
  });

  it('returns 503 when MongoDB not configured', async () => {
    mockIsMongoDBConfigured = false;
    mockGetServerSession.mockResolvedValue(userSession());
    const res = await POST(
      makeRequest('/api/nps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ score: 9 }),
      })
    );
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe('MONGODB_NOT_CONFIGURED');
  });

  it('returns 401 when not authenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const res = await POST(
      makeRequest('/api/nps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ score: 9 }),
      })
    );
    expect(res.status).toBe(401);
  });

  it('rejects score -1', async () => {
    mockGetServerSession.mockResolvedValue(userSession());
    const res = await POST(
      makeRequest('/api/nps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ score: -1 }),
      })
    );
    expect(res.status).toBe(400);
  });

  it('rejects score 11', async () => {
    mockGetServerSession.mockResolvedValue(userSession());
    const res = await POST(
      makeRequest('/api/nps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ score: 11 }),
      })
    );
    expect(res.status).toBe(400);
  });

  it('rejects score 5.5', async () => {
    mockGetServerSession.mockResolvedValue(userSession());
    const res = await POST(
      makeRequest('/api/nps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ score: 5.5 }),
      })
    );
    expect(res.status).toBe(400);
  });

  it('rejects score "abc"', async () => {
    mockGetServerSession.mockResolvedValue(userSession());
    const res = await POST(
      makeRequest('/api/nps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ score: 'abc' }),
      })
    );
    expect(res.status).toBe(400);
  });

  it('successfully submits with score only (no comment)', async () => {
    mockGetServerSession.mockResolvedValue(userSession());
    const res = await POST(
      makeRequest('/api/nps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ score: 9 }),
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.submitted).toBe(true);

    const col = mockCollections['nps_responses'];
    expect(col.insertOne).toHaveBeenCalledTimes(1);
    const inserted = col.insertOne.mock.calls[0][0];
    expect(inserted.score).toBe(9);
    expect(inserted.comment).toBeUndefined();
    expect(inserted.campaign_id).toBeUndefined();
  });

  it('successfully submits with score + comment', async () => {
    mockGetServerSession.mockResolvedValue(userSession());
    const res = await POST(
      makeRequest('/api/nps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ score: 8, comment: 'great product' }),
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.submitted).toBe(true);

    const col = mockCollections['nps_responses'];
    const inserted = col.insertOne.mock.calls[0][0];
    expect(inserted.score).toBe(8);
    expect(inserted.comment).toBe('great product');
  });

  it('successfully submits with score + campaign_id', async () => {
    mockGetServerSession.mockResolvedValue(userSession());
    const res = await POST(
      makeRequest('/api/nps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ score: 9, campaign_id: 'camp-123' }),
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.submitted).toBe(true);

    const col = mockCollections['nps_responses'];
    const inserted = col.insertOne.mock.calls[0][0];
    expect(inserted.score).toBe(9);
    expect(inserted.campaign_id).toBe('camp-123');
  });

  it('truncates comment to 1000 chars', async () => {
    mockGetServerSession.mockResolvedValue(userSession());
    const longComment = 'x'.repeat(1500);
    const res = await POST(
      makeRequest('/api/nps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ score: 7, comment: longComment }),
      })
    );
    expect(res.status).toBe(200);

    const col = mockCollections['nps_responses'];
    const inserted = col.insertOne.mock.calls[0][0];
    expect(inserted.comment).toHaveLength(1000);
  });

  it('stores user_email from session', async () => {
    mockGetServerSession.mockResolvedValue(userSession());
    await POST(
      makeRequest('/api/nps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ score: 10 }),
      })
    );

    const col = mockCollections['nps_responses'];
    const inserted = col.insertOne.mock.calls[0][0];
    expect(inserted.user_email).toBe('user@example.com');
  });

  it('returns { submitted: true } on success', async () => {
    mockGetServerSession.mockResolvedValue(userSession());
    const res = await POST(
      makeRequest('/api/nps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ score: 9 }),
      })
    );
    const body = await res.json();
    expect(body.data).toEqual({ submitted: true });
  });
});

describe('GET /api/nps/active', () => {
  let GET: any;

  beforeEach(async () => {
    jest.resetModules();
    Object.keys(mockCollections).forEach((k) => delete mockCollections[k]);
    mockGetCollection.mockClear();
    mockNpsEnabled = true;
    mockIsMongoDBConfigured = true;

    const modActive = await import('@/app/api/nps/active/route');
    GET = modActive.GET;
  });

  it('returns { active: false } when npsEnabled is false (200 status, not 404)', async () => {
    mockNpsEnabled = false;
    mockGetServerSession.mockResolvedValue(userSession());
    const res = await GET(makeRequest('/api/nps/active'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.active).toBe(false);
  });

  it('returns 503 when MongoDB not configured', async () => {
    mockIsMongoDBConfigured = false;
    mockGetServerSession.mockResolvedValue(userSession());
    const res = await GET(makeRequest('/api/nps/active'));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe('MONGODB_NOT_CONFIGURED');
  });

  it('returns 401 when not authenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const res = await GET(makeRequest('/api/nps/active'));
    expect(res.status).toBe(401);
  });

  it('returns { active: false } when no active campaign', async () => {
    mockGetServerSession.mockResolvedValue(userSession());
    const campaignsCol = mockCollections['nps_campaigns'] || createMockCollection();
    campaignsCol.findOne.mockResolvedValue(null);
    mockCollections['nps_campaigns'] = campaignsCol;

    const res = await GET(makeRequest('/api/nps/active'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.active).toBe(false);
  });

  it('returns { active: true, campaign: { id, name, ends_at } } when campaign exists', async () => {
    mockGetServerSession.mockResolvedValue(userSession());
    const campaignId = new ObjectId();
    const startsAt = new Date('2026-01-01');
    const endsAt = new Date('2026-12-31');
    const campaignDoc = {
      _id: campaignId,
      name: 'Q1 2026 NPS',
      starts_at: startsAt,
      ends_at: endsAt,
    };

    const campaignsCol = mockCollections['nps_campaigns'] || createMockCollection();
    campaignsCol.findOne.mockResolvedValue(campaignDoc);
    mockCollections['nps_campaigns'] = campaignsCol;

    const res = await GET(makeRequest('/api/nps/active'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.active).toBe(true);
    expect(body.data.campaign.id).toBe(campaignId.toString());
    expect(body.data.campaign.name).toBe('Q1 2026 NPS');
    expect(body.data.campaign.ends_at).toBe(endsAt.toISOString());
  });

  it('only matches campaigns where now is between starts_at and ends_at', async () => {
    mockGetServerSession.mockResolvedValue(userSession());
    const campaignsCol = mockCollections['nps_campaigns'] || createMockCollection();
    campaignsCol.findOne.mockResolvedValue(null);
    mockCollections['nps_campaigns'] = campaignsCol;

    await GET(makeRequest('/api/nps/active'));

    const findOneCall = campaignsCol.findOne.mock.calls[0][0];
    expect(findOneCall.starts_at).toEqual({ $lte: expect.any(Date) });
    expect(findOneCall.ends_at).toEqual({ $gte: expect.any(Date) });
  });
});
