/**
 * @jest-environment node
 *
 * Tests for GET /api/skills/hooks/caipe-catalog.sh
 *
 * Mirrors the helper-route test layout. Covers:
 *   - Default (chart file exists, no base_url query) substitutes the
 *     request origin into {{BASE_URL}}.
 *   - Explicit ?base_url=… overrides the request origin.
 *   - SKILLS_HOOK_FILE env var takes precedence over the chart file.
 *   - Fallback engages when neither env nor chart file is readable.
 *   - Invalid base_url (javascript:, embedded creds) falls back to origin.
 *   - Response headers: text/x-shellscript + inline filename + no-store.
 */

const mockNextResponseCtor = jest.fn(
  (body: string, init?: { headers?: Record<string, string>; status?: number }) => ({
    text: async () => body,
    body,
    status: init?.status ?? 200,
    headers: new Map(Object.entries(init?.headers ?? {})),
  }),
);

jest.mock('next/server', () => ({
  NextResponse: function (body: string, init: any) {
    return mockNextResponseCtor(body, init);
  },
}));

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

const CHART_HOOK_BODY = `#!/usr/bin/env bash
DEFAULT_BASE_URL="{{BASE_URL}}"
echo "$DEFAULT_BASE_URL"
`;

beforeEach(() => {
  jest.clearAllMocks();
  // Default: chart file is present with the canonical body.
  mockExists.mockImplementation((p: string) =>
    String(p).endsWith('/data/skills/caipe-catalog.sh'),
  );
  mockStat.mockReturnValue({ isFile: () => true, size: CHART_HOOK_BODY.length });
  mockRead.mockReturnValue(CHART_HOOK_BODY);
  delete process.env.SKILLS_HOOK_FILE;
  delete process.env.NEXTAUTH_URL;
});

afterAll(() => {
  process.env = { ...ORIG_ENV };
});

const callGET = async (url: string) => {
  const res: any = await GET(new Request(url));
  return { body: await res.text(), headers: res.headers as Map<string, string> };
};

describe('GET /api/skills/hooks/caipe-catalog.sh', () => {
  it('substitutes the request origin into {{BASE_URL}} by default', async () => {
    const { body } = await callGET('https://gateway.example.com/api/skills/hooks/caipe-catalog.sh');

    expect(body).toContain('DEFAULT_BASE_URL="https://gateway.example.com"');
    expect(body).not.toContain('{{BASE_URL}}');
  });

  it('honors an explicit base_url query param over the request origin', async () => {
    const { body } = await callGET(
      'https://gateway.example.com/api/skills/hooks/caipe-catalog.sh?base_url=https://other.example.com',
    );

    expect(body).toContain('DEFAULT_BASE_URL="https://other.example.com"');
  });

  it('strips a trailing slash from the base_url', async () => {
    const { body } = await callGET(
      'https://gateway.example.com/api/skills/hooks/caipe-catalog.sh?base_url=https://other.example.com/',
    );

    expect(body).toContain('DEFAULT_BASE_URL="https://other.example.com"');
  });

  it('rejects javascript: base_url and falls back to the request origin', async () => {
    const { body } = await callGET(
      'https://gateway.example.com/api/skills/hooks/caipe-catalog.sh?base_url=javascript%3Aalert(1)',
    );

    expect(body).toContain('DEFAULT_BASE_URL="https://gateway.example.com"');
    expect(body).not.toContain('javascript');
  });

  it('rejects base_url with embedded credentials', async () => {
    const { body } = await callGET(
      'https://gateway.example.com/api/skills/hooks/caipe-catalog.sh?base_url=https://user:pass@evil.example.com',
    );

    expect(body).toContain('DEFAULT_BASE_URL="https://gateway.example.com"');
    expect(body).not.toContain('user:pass');
    expect(body).not.toContain('evil.example.com');
  });

  it('reads SKILLS_HOOK_FILE override before the chart file', async () => {
    process.env.SKILLS_HOOK_FILE = '/etc/caipe/custom-hook.sh';
    mockExists.mockImplementation((p: string) =>
      String(p) === '/etc/caipe/custom-hook.sh',
    );
    mockRead.mockReturnValue('#!/bin/bash\necho "from-env-file"\n');

    const { body } = await callGET(
      'https://gateway.example.com/api/skills/hooks/caipe-catalog.sh',
    );

    expect(body).toContain('from-env-file');
  });

  it('falls back to the built-in stub when neither env nor chart file is readable', async () => {
    mockExists.mockReturnValue(false);

    const { body } = await callGET(
      'https://gateway.example.com/api/skills/hooks/caipe-catalog.sh',
    );

    // Fallback prints a Claude-format error envelope.
    expect(body).toContain('Hook source not found on the CAIPE gateway');
    expect(body).toContain('hookSpecificOutput');
  });

  it('sets the right response headers', async () => {
    const { headers } = await callGET(
      'https://gateway.example.com/api/skills/hooks/caipe-catalog.sh',
    );

    expect(headers.get('Content-Type')).toBe('text/x-shellscript; charset=utf-8');
    expect(headers.get('Content-Disposition')).toBe('inline; filename=caipe-catalog.sh');
    expect(headers.get('Cache-Control')).toBe('no-store');
  });

  it('honors NEXTAUTH_URL when set (ingress-aware origin)', async () => {
    process.env.NEXTAUTH_URL = 'https://public.example.com';

    const { body } = await callGET(
      'http://internal-pod-ip:3000/api/skills/hooks/caipe-catalog.sh',
    );

    expect(body).toContain('DEFAULT_BASE_URL="https://public.example.com"');
    expect(body).not.toContain('internal-pod-ip');
  });
});
