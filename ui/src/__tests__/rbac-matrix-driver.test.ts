/**
 * @jest-environment node
 *
 * Spec 102 T038 — Jest matrix-driver for `surface: ui_bff` routes.
 *
 * For every route in `tests/rbac/rbac-matrix.yaml` whose `surface` is `ui_bff`,
 * iterate over each persona's expectation and assert that the route handler
 * returns the expected status code (200/201/204 = allow, 401/403 = deny).
 *
 * Strategy
 * --------
 *  1. Load the matrix YAML once at module load.
 *  2. Mock NextAuth's `getServerSession` to return the persona's session.
 *  3. Mock `@/lib/rbac/keycloak-authz`'s `checkPermission` to allow/deny per
 *     the matrix expectation (no live Keycloak — that's the playwright e2e job).
 *  4. Mock `@/lib/mongodb` so admin routes that hit Mongo don't error in unit.
 *  5. Dynamically `require()` the route handler module from `path` and dispatch
 *     `GET`/`POST`/etc. against a `NextRequest`.
 *  6. Assert response status matches matrix expectation.
 *
 * The driver is intentionally lenient on response *shape* — that's the job of
 * each route's own `__tests__/<route>.test.ts`. We only enforce the RBAC
 * contract: deny → 401/403, allow → not-401/403.
 *
 * Wire-up: `make test-rbac-jest` runs this via `cd ui && npx jest src/__tests__/rbac-matrix-driver.test.ts`.
 *
 * The matrix is empty in Phase 2; Phases 3–9 populate it route-by-route.
 * If the matrix has zero `ui_bff` rows, this file emits a single skipped test
 * rather than failing — the hard gate is `scripts/validate-rbac-matrix.py`.
 */

import * as fs from 'fs';
import * as path from 'path';
import { NextRequest } from 'next/server';
import * as yaml from 'js-yaml';

// ─────────────────────────────────────────────────────────────────────────────
// Mocks (must precede the dynamic route require())
// ─────────────────────────────────────────────────────────────────────────────

const mockGetServerSession = jest.fn();
jest.mock('next-auth', () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));

jest.mock('@/lib/auth-config', () => ({
  authOptions: {},
  isBootstrapAdmin: jest.fn().mockReturnValue(false),
  REQUIRED_ADMIN_GROUP: '',
}));

jest.mock('@/lib/rbac/keycloak-authz', () => ({
  checkPermission: jest.fn(),
}));
jest.mock('@/lib/rbac/audit', () => ({
  logAuthzDecision: jest.fn(),
}));

const mockCheckPermission = jest.requireMock<{ checkPermission: jest.Mock }>(
  '@/lib/rbac/keycloak-authz',
).checkPermission;

// Enable feature flags so routes don't short-circuit BEFORE the auth gate
// runs (e.g. /api/admin/feedback returns 404 when feedbackEnabled is false,
// which would mask the 403 the matrix expects).
jest.mock('@/lib/config', () => ({
  getConfig: (key: string) => {
    const enabledKeys = new Set([
      'ssoEnabled',
      'feedbackEnabled',
      'npsEnabled',
      'ragEnabled',
      'auditEnabled',
    ]);
    return enabledKeys.has(key);
  },
  getInternalA2AUrl: () => 'http://localhost:8000',
}));

const mockGetCollection = jest.fn(() =>
  Promise.resolve({
    find: () => ({
      sort: () => ({
        toArray: () => Promise.resolve([]),
        skip: () => ({ limit: () => ({ toArray: () => Promise.resolve([]) }) }),
      }),
      toArray: () => Promise.resolve([]),
    }),
    findOne: () => Promise.resolve(null),
    insertOne: () => Promise.resolve({ insertedId: 'mock' }),
    updateOne: () => Promise.resolve({ modifiedCount: 1 }),
    deleteOne: () => Promise.resolve({ deletedCount: 1 }),
    countDocuments: () => Promise.resolve(0),
    distinct: () => Promise.resolve([]),
    aggregate: () => ({ toArray: () => Promise.resolve([]) }),
  }),
);

jest.mock('@/lib/mongodb', () => ({
  getCollection: (...args: unknown[]) => mockGetCollection(...args),
  isMongoDBConfigured: true,
}));

// ─────────────────────────────────────────────────────────────────────────────
// Matrix loading
// ─────────────────────────────────────────────────────────────────────────────

interface MatrixExpectation {
  status: number;
  reason?: string;
}

interface MatrixRoute {
  id: string;
  surface: 'ui_bff' | 'supervisor' | 'mcp' | 'rag' | 'dynamic_agents' | 'slack_bot';
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  resource: string;
  scope: string;
  notes?: string;
  /**
   * `pending` = handler not yet migrated to requireRbacPermission. The
   * driver renders a `xit` (pending) instead of running the assertion. The
   * matrix linter still requires the entry; only test execution is gated.
   * Phase 11 (T127) verifies no `pending` rows remain before the spec exits.
   */
  migration_status?: 'migrated' | 'pending';
  expectations: Record<string, MatrixExpectation>;
}

interface MatrixDoc {
  version: number;
  routes: MatrixRoute[];
}

const MATRIX_PATH = path.resolve(__dirname, '../../../tests/rbac/rbac-matrix.yaml');

function loadMatrix(): MatrixDoc {
  const raw = fs.readFileSync(MATRIX_PATH, 'utf8');
  const parsed = yaml.load(raw) as MatrixDoc;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`rbac-matrix.yaml at ${MATRIX_PATH} did not parse to an object`);
  }
  if (parsed.version !== 1) {
    throw new Error(`rbac-matrix.yaml version must be 1, got ${parsed.version}`);
  }
  return parsed;
}

const MATRIX = loadMatrix();
const UI_BFF_ROUTES = MATRIX.routes.filter((r) => r.surface === 'ui_bff');

// ─────────────────────────────────────────────────────────────────────────────
// Persona session shapes (mirror tests/rbac/fixtures/keycloak.py)
// ─────────────────────────────────────────────────────────────────────────────

const PERSONA_ROLES: Record<string, string[]> = {
  alice_admin: ['admin'],
  bob_chat_user: ['chat_user'],
  carol_kb_ingestor: ['chat_user', 'kb_ingestor'],
  dave_no_role: [],
  eve_dynamic_agent_user: ['chat_user'],
  frank_service_account: [], // service-account; no realm roles by default
};

function accessTokenForPersona(persona: string): string {
  const roles = PERSONA_ROLES[persona] ?? [];
  const payload = Buffer.from(
    JSON.stringify({ realm_access: { roles }, sub: persona }),
    'utf8',
  ).toString('base64url');
  return `header.${payload}.signature`;
}

function sessionForPersona(persona: string): Record<string, unknown> {
  return {
    user: { email: `${persona}@example.com`, name: persona },
    role: persona === 'alice_admin' ? 'admin' : 'user',
    sub: persona,
    accessToken: accessTokenForPersona(persona),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Route handler resolution
// ─────────────────────────────────────────────────────────────────────────────

function routeFileForPath(routePath: string): string {
  // Convert `/api/admin/teams` → `ui/src/app/api/admin/teams/route.ts`
  // Convert `/api/admin/users/[id]/role` → `ui/src/app/api/admin/users/[id]/role/route.ts`
  const trimmed = routePath.replace(/^\//, '');
  return path.resolve(__dirname, '../app', trimmed, 'route.ts');
}

function loadRouteHandler(routePath: string, method: string): (req: NextRequest, ctx?: unknown) => Promise<Response> {
  const file = routeFileForPath(routePath);
  if (!fs.existsSync(file)) {
    throw new Error(`route handler file does not exist: ${file}`);
  }
  // jest's `require` will run the route module, which will pick up the mocks above.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require(file);
  const handler = mod[method];
  if (typeof handler !== 'function') {
    throw new Error(`route ${routePath} does not export ${method}`);
  }
  return handler;
}

function makeRequest(routePath: string, method: string): NextRequest {
  const url = new URL(routePath, 'http://localhost:3000');
  return new NextRequest(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: method === 'GET' || method === 'DELETE' ? undefined : JSON.stringify({}),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Driver
// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockGetServerSession.mockReset();
  mockCheckPermission.mockReset();
  mockGetCollection.mockClear();
});

if (UI_BFF_ROUTES.length === 0) {
  describe.skip('rbac-matrix-driver (ui_bff)', () => {
    it('matrix has no ui_bff routes — populated by Phase 3+ tasks (T035, T036)', () => {});
  });
} else {
  describe('rbac-matrix-driver (ui_bff)', () => {
    UI_BFF_ROUTES.forEach((route) => {
      const status = route.migration_status ?? 'migrated';
      const groupTitle = `${route.method} ${route.path} → ${route.resource}#${route.scope}` +
        (status === 'pending' ? ' [PENDING MIGRATION]' : '');
      describe(groupTitle, () => {
        Object.entries(route.expectations).forEach(([persona, expectation]) => {
          const testName = `${persona}: expects status ${expectation.status}${expectation.reason ? ` (${expectation.reason})` : ''}`;

          if (status === 'pending') {
            // `xit` produces a yellow/skipped marker so it shows up in CI as
            // "to-do" rather than vanishing. Once the migration task lands,
            // flip migration_status: pending → migrated to enable.
            xit(testName, () => {});
            return;
          }

          it(testName, async () => {
            mockGetServerSession.mockResolvedValue(sessionForPersona(persona));

            const allow = expectation.status >= 200 && expectation.status < 300;
            mockCheckPermission.mockResolvedValue({
              allowed: allow,
              reason: allow ? 'OK' : (expectation.reason ?? 'DENY_NO_CAPABILITY'),
            });

            const handler = loadRouteHandler(route.path, route.method);
            const req = makeRequest(route.path, route.method);
            const res = await handler(req, {});

            // RBAC contract assertion: deny ⇒ 401/403, allow ⇒ not-401/403.
            // Other 4xx/5xx (e.g. 503 Mongo not configured, 400 bad payload)
            // are out of scope for the matrix driver and handled by per-route tests.
            if (allow) {
              expect([401, 403]).not.toContain(res.status);
            } else {
              expect([401, 403]).toContain(res.status);
              if (expectation.reason && expectation.reason !== 'DENY_NO_TOKEN') {
                // For DENY_NO_TOKEN we'd expect 401; otherwise 403.
                expect(res.status).toBe(403);
              }
            }
          });
        });
      });
    });
  });
}
