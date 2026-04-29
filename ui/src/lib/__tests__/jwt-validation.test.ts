/**
 * Tests for the OIDC_ACCEPTED_AUDIENCES logic in jwt-validation.ts.
 *
 * Since jose v6 relies on APIs (structuredClone, WebCrypto) that aren't
 * fully available in jsdom, we test the audience-building logic by calling
 * validateBearerJWT through the real module but mocking jwtVerify itself
 * to capture the options passed to it.
 */

let capturedOptions: Record<string, unknown> | undefined;
let capturedKey: unknown;

// Mock jose — intercept jwtVerify to capture the audience option
jest.mock('jose', () => {
  const actual = jest.requireActual('jose');
  return {
    ...actual,
    createRemoteJWKSet: jest.fn().mockReturnValue('mock-jwks'),
    jwtVerify: jest.fn().mockImplementation(async (_token: string, key: unknown, options?: Record<string, unknown>) => {
      capturedKey = key;
      capturedOptions = options;
      return {
        payload: {
          email: 'user@example.com',
          name: 'Test User',
          sub: 'user@example.com',
        },
        protectedHeader: { alg: 'RS256' },
      };
    }),
  };
});

beforeEach(() => {
  capturedOptions = undefined;
  capturedKey = undefined;

  global.fetch = jest.fn().mockImplementation(async () => ({
    ok: true,
    json: async () => ({ jwks_uri: 'https://idp.example.com/jwks' }),
  }));
});

afterEach(() => {
  jest.restoreAllMocks();
  delete process.env.OIDC_ISSUER;
  delete process.env.OIDC_CLIENT_ID;
  delete process.env.OIDC_ACCEPTED_AUDIENCES;

  const mod = require('../jwt-validation');
  mod._resetJWKSCache();
});

describe('validateBearerJWT audience handling', () => {
  it('passes OIDC_CLIENT_ID as audience when no OIDC_ACCEPTED_AUDIENCES', async () => {
    process.env.OIDC_ISSUER = 'https://idp.example.com';
    process.env.OIDC_CLIENT_ID = 'my-client-id';

    const { validateBearerJWT } = require('../jwt-validation');
    await validateBearerJWT('fake-token');

    expect(capturedOptions?.audience).toEqual(['my-client-id']);
  });

  it('combines OIDC_ACCEPTED_AUDIENCES and OIDC_CLIENT_ID', async () => {
    process.env.OIDC_ISSUER = 'https://idp.example.com';
    process.env.OIDC_CLIENT_ID = 'my-client-id';
    process.env.OIDC_ACCEPTED_AUDIENCES = 'https://my-api.example.com';

    const { validateBearerJWT } = require('../jwt-validation');
    await validateBearerJWT('fake-token');

    expect(capturedOptions?.audience).toEqual(['https://my-api.example.com', 'my-client-id']);
  });

  it('supports multiple comma-separated OIDC_ACCEPTED_AUDIENCES', async () => {
    process.env.OIDC_ISSUER = 'https://idp.example.com';
    process.env.OIDC_CLIENT_ID = 'my-client-id';
    process.env.OIDC_ACCEPTED_AUDIENCES = 'https://api-a.example.com, https://api-b.example.com';

    const { validateBearerJWT } = require('../jwt-validation');
    await validateBearerJWT('fake-token');

    expect(capturedOptions?.audience).toEqual([
      'https://api-a.example.com',
      'https://api-b.example.com',
      'my-client-id',
    ]);
  });

  it('deduplicates OIDC_CLIENT_ID when already in OIDC_ACCEPTED_AUDIENCES', async () => {
    process.env.OIDC_ISSUER = 'https://idp.example.com';
    process.env.OIDC_CLIENT_ID = 'my-client-id';
    process.env.OIDC_ACCEPTED_AUDIENCES = 'my-client-id, https://my-api.example.com';

    const { validateBearerJWT } = require('../jwt-validation');
    await validateBearerJWT('fake-token');

    expect(capturedOptions?.audience).toEqual(['my-client-id', 'https://my-api.example.com']);
  });

  it('passes undefined audience when neither OIDC_CLIENT_ID nor OIDC_ACCEPTED_AUDIENCES is set', async () => {
    process.env.OIDC_ISSUER = 'https://idp.example.com';

    const { validateBearerJWT } = require('../jwt-validation');
    await validateBearerJWT('fake-token');

    expect(capturedOptions?.audience).toBeUndefined();
  });

  it('trims whitespace and ignores empty entries in OIDC_ACCEPTED_AUDIENCES', async () => {
    process.env.OIDC_ISSUER = 'https://idp.example.com';
    process.env.OIDC_ACCEPTED_AUDIENCES = ' https://api.example.com , , ';

    const { validateBearerJWT } = require('../jwt-validation');
    await validateBearerJWT('fake-token');

    expect(capturedOptions?.audience).toEqual(['https://api.example.com']);
  });

  it('always passes issuer from OIDC_ISSUER', async () => {
    process.env.OIDC_ISSUER = 'https://idp.example.com';
    process.env.OIDC_CLIENT_ID = 'my-client-id';

    const { validateBearerJWT } = require('../jwt-validation');
    await validateBearerJWT('fake-token');

    expect(capturedOptions?.issuer).toBe('https://idp.example.com');
  });
});
