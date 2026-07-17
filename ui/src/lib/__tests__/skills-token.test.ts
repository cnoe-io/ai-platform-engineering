/**
 * @jest-environment node
 *
 * Round-trip tests for local skills API tokens: signing embeds a `jti`
 * (needed by the key registry in skills-api-keys.ts to support revocation),
 * and validation surfaces it back out. Runs in the node environment because
 * jose's WebAPI SignJWT needs `structuredClone`, unavailable in jsdom.
 */

import { signLocalSkillsToken, validateLocalSkillsJWT } from '../jwt-validation';

beforeEach(() => {
  process.env.NEXTAUTH_SECRET = 'a-long-enough-test-secret-not-a-placeholder-value';
  delete process.env.SKILLS_API_SECRET;
});

afterEach(() => {
  delete process.env.NEXTAUTH_SECRET;
});

describe('signLocalSkillsToken / validateLocalSkillsJWT jti round trip', () => {
  it('embeds a caller-supplied jti and surfaces it on validation', async () => {
    const token = await signLocalSkillsToken('user@example.com', 'Test User', '30d', 'jti-123');
    const identity = await validateLocalSkillsJWT(token);

    expect(identity).not.toBeNull();
    expect(identity?.email).toBe('user@example.com');
    expect(identity?.jti).toBe('jti-123');
  });

  it('generates a jti automatically when none is supplied', async () => {
    const token = await signLocalSkillsToken('user@example.com', 'Test User', '30d');
    const identity = await validateLocalSkillsJWT(token);

    expect(identity?.jti).toEqual(expect.any(String));
    expect(identity?.jti?.length).toBeGreaterThan(0);
  });

  it('two tokens for the same user get distinct jtis', async () => {
    const tokenA = await signLocalSkillsToken('user@example.com', 'Test User', '30d');
    const tokenB = await signLocalSkillsToken('user@example.com', 'Test User', '30d');

    const identityA = await validateLocalSkillsJWT(tokenA);
    const identityB = await validateLocalSkillsJWT(tokenB);

    expect(identityA?.jti).not.toBe(identityB?.jti);
  });
});
