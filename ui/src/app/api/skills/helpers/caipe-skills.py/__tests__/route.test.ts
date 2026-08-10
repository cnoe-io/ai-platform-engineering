/**
 * @jest-environment node
 *
 * Tests for GET /api/skills/helpers/caipe-skills.py
 *
 * Covers:
 *   - Serves the chart-mounted file with text/x-python content-type and
 *     no-store cache header.
 *   - SKILLS_HELPER_FILE env var overrides the chart path.
 *   - Missing chart file falls back to a built-in minimal helper that
 *     emits a JSON error envelope (operator-visible misconfiguration).
 *   - Files larger than the 256 KiB cap are rejected (DoS guard) and
 *     fall through to the next resolution step.
 *   - {{BASE_URL}} placeholder is substituted with the request origin
 *     (or an explicit ?base_url=... override).
 *   - Hostile base_url values (non-http schemes, embedded creds) are
 *     rejected and the request origin is used instead.
 */

const FILE_SIZE_CAP_BYTES = 256 * 1024;

// next/server NextResponse mock: the route uses `new NextResponse(body, init)`
// (not NextResponse.json), so we expose a constructor that records the args
// and presents a Response-like surface to the test.
//
// jest.mock() is hoisted above top-level declarations, so the mock class must
// be defined INSIDE the factory; the type alias below gives the test code
// something to assert against without leaking implementation into the route.
jest.mock('next/server', () => {
  class MockNextResponse {
    body: string;
    status: number;
    headers: Map<string, string>;

    constructor(
      body: string,
      init?: { status?: number; headers?: Record<string, string> },
    ) {
      this.body = body;
      this.status = init?.status ?? 200;
      this.headers = new Map(Object.entries(init?.headers ?? {}));
    }

    async text() {
      return this.body;
    }
  }
  return { NextResponse: MockNextResponse };
});

type MockNextResponseLike = {
  body: string;
  status: number;
  headers: Map<string, string>;
  text: () => Promise<string>;
};

jest.mock('fs', () => ({
  existsSync: jest.fn(),
  statSync: jest.fn(),
  readFileSync: jest.fn(),
}));

import fs from 'fs';
import { GET } from '../route';

const mockExists = fs.existsSync as jest.Mock;
const mockStat = fs.statSync as jest.Mock;
const mockRead = fs.readFileSync as jest.Mock;

const ORIG_ENV = { ...process.env };

const CHART_HELPER = '#!/usr/bin/env python3\n# CHART HELPER calls {{BASE_URL}}/api/skills\n';
const ENV_HELPER = '#!/usr/bin/env python3\n# ENV-OVERRIDE HELPER for {{BASE_URL}}\n';

beforeEach(() => {
  jest.clearAllMocks();
  mockExists.mockReturnValue(false);
  mockStat.mockReturnValue({ isFile: () => false, size: 0 });
  delete process.env.SKILLS_HELPER_FILE;
});

afterAll(() => {
  process.env = { ...ORIG_ENV };
});

/** Stage a virtual filesystem entry the route can read. */
function stageFile(absPathSubstring: string, contents: string) {
  mockExists.mockImplementation((p: string) => p.includes(absPathSubstring));
  mockStat.mockImplementation((p: string) => ({
    isFile: () => p.includes(absPathSubstring),
    size: contents.length,
  }));
  mockRead.mockImplementation((p: string) => {
    if (p.includes(absPathSubstring)) return contents;
    throw new Error(`unexpected read: ${p}`);
  });
}

const callGET = async (url: string) => {
  const res = (await GET(new Request(url))) as unknown as MockNextResponseLike;
  return {
    body: await res.text(),
    status: res.status,
    headers: res.headers,
  };
};

describe('GET /api/skills/helpers/caipe-skills.py — chart resolution', () => {
  it('serves the chart-mounted helper with text/x-python and no-store', async () => {
    stageFile('charts/ai-platform-engineering/data/skills/caipe-skills.py', CHART_HELPER);

    const res = await callGET('https://app.example.com/api/skills/helpers/caipe-skills.py');

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/x-python; charset=utf-8');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('Content-Disposition')).toBe('inline; filename=caipe-skills.py');
    // {{BASE_URL}} is substituted with the request origin.
    expect(res.body).toContain('https://app.example.com/api/skills');
    expect(res.body).not.toContain('{{BASE_URL}}');
  });

  it('falls back to the built-in minimal helper when the chart file is missing', async () => {
    // No file staged — every existsSync returns false.
    const res = await callGET('https://app.example.com/api/skills/helpers/caipe-skills.py');

    expect(res.status).toBe(200);
    expect(res.body).toContain('Fallback CAIPE skills helper');
    expect(res.body).toContain('caipe-skills.py source not found');
  });

  it('rejects files larger than the size cap (DoS guard)', async () => {
    const oversized = 'x'.repeat(FILE_SIZE_CAP_BYTES + 1);
    stageFile('charts/ai-platform-engineering/data/skills/caipe-skills.py', oversized);
    // Override stat to report the oversized length so the cap actually triggers.
    mockStat.mockImplementation((p: string) => ({
      isFile: () => p.includes('caipe-skills.py'),
      size: oversized.length,
    }));

    const res = await callGET('https://app.example.com/api/skills/helpers/caipe-skills.py');

    // Falls through to the built-in fallback rather than serving the oversized file.
    expect(res.body).toContain('Fallback CAIPE skills helper');
  });
});

describe('GET /api/skills/helpers/caipe-skills.py — env override', () => {
  it('SKILLS_HELPER_FILE wins over the chart path', async () => {
    process.env.SKILLS_HELPER_FILE = '/etc/caipe/custom-helper.py';
    stageFile('custom-helper.py', ENV_HELPER);

    const res = await callGET('https://app.example.com/api/skills/helpers/caipe-skills.py');

    expect(res.body).toContain('ENV-OVERRIDE HELPER');
    expect(res.body).not.toContain('CHART HELPER');
  });

  it('ignores SKILLS_HELPER_FILE when the file is missing and falls through to chart', async () => {
    process.env.SKILLS_HELPER_FILE = '/does/not/exist.py';
    stageFile('charts/ai-platform-engineering/data/skills/caipe-skills.py', CHART_HELPER);

    const res = await callGET('https://app.example.com/api/skills/helpers/caipe-skills.py');

    expect(res.body).toContain('CHART HELPER');
  });
});

describe('GET /api/skills/helpers/caipe-skills.py — base_url substitution', () => {
  it('uses an explicit ?base_url= override when valid', async () => {
    stageFile('charts/ai-platform-engineering/data/skills/caipe-skills.py', CHART_HELPER);

    const res = await callGET(
      'https://app.example.com/api/skills/helpers/caipe-skills.py?base_url=https://override.example.com',
    );

    expect(res.body).toContain('https://override.example.com/api/skills');
    expect(res.body).not.toContain('app.example.com');
  });

  it('rejects hostile base_url values and falls back to the request origin', async () => {
    stageFile('charts/ai-platform-engineering/data/skills/caipe-skills.py', CHART_HELPER);

    // file:// scheme — must be rejected.
    const fileScheme = await callGET(
      'https://app.example.com/api/skills/helpers/caipe-skills.py?base_url=file:///etc/passwd',
    );
    expect(fileScheme.body).toContain('https://app.example.com');
    expect(fileScheme.body).not.toContain('file:///etc/passwd');

    // Embedded creds — must be rejected.
    const withCreds = await callGET(
      'https://app.example.com/api/skills/helpers/caipe-skills.py?base_url=https://attacker:pw@evil.example.com',
    );
    expect(withCreds.body).toContain('https://app.example.com');
    expect(withCreds.body).not.toContain('attacker');
    expect(withCreds.body).not.toContain('evil.example.com');
  });

  it('strips trailing slashes from base_url', async () => {
    stageFile('charts/ai-platform-engineering/data/skills/caipe-skills.py', CHART_HELPER);

    const res = await callGET(
      'https://app.example.com/api/skills/helpers/caipe-skills.py?base_url=https://override.example.com//',
    );

    // After stripping, the substituted token + literal "/api/skills" should not double-slash.
    expect(res.body).toContain('https://override.example.com/api/skills');
    expect(res.body).not.toContain('//api/skills');
  });
});
