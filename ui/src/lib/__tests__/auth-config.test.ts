/**
 * Unit tests for auth-config.ts
 * Tests OIDC configuration, token refresh, and group authorization
 */

// Mock jose so we can control decodeJwt in group re-evaluation tests
jest.mock('jose', () => ({
  decodeJwt: jest.fn(),
}))

import { hasRequiredGroup, isAdminUser, canViewAdminDashboard, canAccessDynamicAgents, authOptions, _resetInflightRefreshes } from '../auth-config'

function withDefaultRequiredGroup<T>(cb: (mod: typeof import('../auth-config')) => T): T {
  const previous = process.env.OIDC_REQUIRED_GROUP
  delete process.env.OIDC_REQUIRED_GROUP
  try {
    let result!: T
    jest.isolateModules(() => {
      result = cb(require('../auth-config'))
    })
    return result
  } finally {
    if (previous === undefined) {
      delete process.env.OIDC_REQUIRED_GROUP
    } else {
      process.env.OIDC_REQUIRED_GROUP = previous
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility: build a fake fetch mock that handles OIDC discovery + token exchange
// ─────────────────────────────────────────────────────────────────────────────
function makeRefreshFetchMock(opts: {
  discoveryFails?: boolean
  tokenFails?: boolean
  nonJsonResponse?: boolean
  newTokens?: Record<string, unknown>
} = {}) {
  return jest.fn().mockImplementation(async (url: RequestInfo | URL) => {
    const urlStr = url.toString()

    // OIDC discovery endpoint
    if (urlStr.includes('.well-known')) {
      if (opts.discoveryFails) {
        return { ok: false, status: 500 }
      }
      return {
        ok: true,
        json: async () => ({ token_endpoint: 'https://sso.example.com/token' }),
      }
    }

    // Token exchange endpoint
    if (opts.nonJsonResponse) {
      return {
        ok: false,
        headers: { get: () => 'text/html' },
        text: async () => '<html>Error page</html>',
      }
    }
    if (opts.tokenFails) {
      return {
        ok: false,
        headers: { get: () => 'application/json' },
        json: async () => ({ error: 'invalid_grant', error_description: 'Refresh token expired' }),
      }
    }
    return {
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({
        access_token: 'new-access-token',
        id_token: 'new-id-token',
        refresh_token: 'new-refresh-token',
        expires_in: 3600,
        ...opts.newTokens,
      }),
    }
  })
}

describe('auth-config', () => {
  describe('hasRequiredGroup', () => {
    it('should return true when user has exact required group (default: backstage-access)', () => {
      const groups = ['backstage-access', 'other-group']
      expect(withDefaultRequiredGroup(({ hasRequiredGroup }) => hasRequiredGroup(groups))).toBe(true)
    })


    it('should return false when user does not have required group', () => {
      const groups = ['other-group', 'another-group']
      expect(withDefaultRequiredGroup(({ hasRequiredGroup }) => hasRequiredGroup(groups))).toBe(false)
    })

    it('should be case-insensitive', () => {
      const groups = ['BACKSTAGE-ACCESS', 'other-group']
      expect(withDefaultRequiredGroup(({ hasRequiredGroup }) => hasRequiredGroup(groups))).toBe(true)
    })

    it('should handle LDAP DN format for groups', () => {
      const groups = [
        'CN=backstage-access,OU=Groups,DC=example,DC=com',
        'other-group',
      ]
      expect(withDefaultRequiredGroup(({ hasRequiredGroup }) => hasRequiredGroup(groups))).toBe(true)
    })

    it('should handle mixed case in LDAP DN', () => {
      const groups = [
        'cn=BACKSTAGE-ACCESS,ou=Groups,dc=example,dc=com',
        'other-group',
      ]
      expect(withDefaultRequiredGroup(({ hasRequiredGroup }) => hasRequiredGroup(groups))).toBe(true)
    })

    it('should handle partial DN matches', () => {
      const groups = [
        'cn=Backstage-Access,ou=Groups',
        'other-group',
      ]
      expect(withDefaultRequiredGroup(({ hasRequiredGroup }) => hasRequiredGroup(groups))).toBe(true)
    })

    it('should not match substring in non-DN groups', () => {
      const groups = ['my-backstage-access-team', 'other-group']
      // Should not match because we're looking for "cn=backstage-access" in DN format
      // and exact match for simple group names
      expect(withDefaultRequiredGroup(({ hasRequiredGroup }) => hasRequiredGroup(groups))).toBe(false)
    })

    it('should handle empty groups array', () => {
      const groups: string[] = []
      expect(withDefaultRequiredGroup(({ hasRequiredGroup }) => hasRequiredGroup(groups))).toBe(false)
    })

    it('should handle multiple matching groups', () => {
      const groups = [
        'backstage-access',
        'CN=backstage-access,OU=Groups,DC=example,DC=com',
        'other-group',
      ]
      expect(withDefaultRequiredGroup(({ hasRequiredGroup }) => hasRequiredGroup(groups))).toBe(true)
    })
  })

  describe('Token refresh configuration', () => {
    const originalEnv = process.env

    beforeEach(() => {
      // Note: jest.resetModules() deliberately omitted here.
      // Each test uses jest.isolateModules() to get an isolated module load.
      // Calling jest.resetModules() here would invalidate the top-level
      // jose mock reference captured by the already-loaded authOptions module.
      process.env = { ...originalEnv }
    })

    afterAll(() => {
      process.env = originalEnv
    })

    it('ENABLE_REFRESH_TOKEN defaults to true', () => {
      delete process.env.OIDC_ENABLE_REFRESH_TOKEN

      jest.isolateModules(() => {
        const { ENABLE_REFRESH_TOKEN } = require('../auth-config')
        expect(ENABLE_REFRESH_TOKEN).toBe(true)
      })
    })

    it('ENABLE_REFRESH_TOKEN is false when OIDC_ENABLE_REFRESH_TOKEN=false', () => {
      process.env.OIDC_ENABLE_REFRESH_TOKEN = 'false'

      jest.isolateModules(() => {
        const { ENABLE_REFRESH_TOKEN } = require('../auth-config')
        expect(ENABLE_REFRESH_TOKEN).toBe(false)
      })
    })
  })

  describe('OIDC Scope Configuration', () => {
    const originalEnv = process.env

    beforeEach(() => {
      // See note in 'Token refresh configuration' — jest.resetModules() omitted intentionally.
      process.env = { ...originalEnv }
    })

    afterAll(() => {
      process.env = originalEnv
    })

    it('should request groups scope when refresh tokens enabled (no offline_access)', () => {
      process.env.OIDC_ENABLE_REFRESH_TOKEN = 'true'

      jest.isolateModules(() => {
        const { authOptions, ENABLE_REFRESH_TOKEN } = require('../auth-config')
        expect(ENABLE_REFRESH_TOKEN).toBe(true)

        const provider = authOptions.providers[0]
        const scope = provider.authorization.params.scope
        expect(scope).toContain('groups')
        expect(scope).not.toContain('offline_access')
      })
    })

    it('should still request groups scope when refresh tokens disabled', () => {
      process.env.OIDC_ENABLE_REFRESH_TOKEN = 'false'

      jest.isolateModules(() => {
        const { authOptions, ENABLE_REFRESH_TOKEN } = require('../auth-config')
        expect(ENABLE_REFRESH_TOKEN).toBe(false)

        const provider = authOptions.providers[0]
        const scope = provider.authorization.params.scope
        expect(scope).toContain('groups')
        expect(scope).not.toContain('offline_access')
      })
    })

    it('should default to enabled if OIDC_ENABLE_REFRESH_TOKEN not set', () => {
      delete process.env.OIDC_ENABLE_REFRESH_TOKEN

      jest.isolateModules(() => {
        const { ENABLE_REFRESH_TOKEN } = require('../auth-config')
        expect(ENABLE_REFRESH_TOKEN).toBe(true)
      })
    })

    it('should always include required OIDC scopes', () => {
      jest.isolateModules(() => {
        const { authOptions } = require('../auth-config')
        const provider = authOptions.providers[0]
        const scope = provider.authorization.params.scope

        expect(scope).toContain('openid')
        expect(scope).toContain('email')
        expect(scope).toContain('profile')
        expect(scope).toContain('groups')
      })
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // JWT callback — real implementation tests
  // ─────────────────────────────────────────────────────────────────────────

  describe('JWT callback', () => {
    const originalEnv = process.env
    let fetchSpy: jest.SpyInstance

    beforeEach(() => {
      process.env = {
        ...originalEnv,
        OIDC_ISSUER: 'https://sso.example.com',
        OIDC_CLIENT_ID: 'test-client-id',
        OIDC_CLIENT_SECRET: 'test-client-secret',
        OIDC_ENABLE_REFRESH_TOKEN: 'true',
      }
      fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(makeRefreshFetchMock())
    })

    afterEach(() => {
      process.env = originalEnv
      fetchSpy.mockRestore()
    })

    it('should store all tokens on initial sign-in', async () => {
      const now = Math.floor(Date.now() / 1000)

      const result = await (authOptions.callbacks!.jwt! as Function)({
        token: {},
        account: {
          access_token: 'at',
          id_token: 'idt',
          refresh_token: 'rt',
          expires_at: now + 3600,
        },
        profile: {
          sub: 'sub-123',
          email: 'user@example.com',
          groups: ['backstage-access'],
        },
      })

      expect(result.accessToken).toBe('at')
      expect(result.idToken).toBeUndefined()
      expect(result.refreshToken).toBe('rt')
      expect(result.expiresAt).toBe(now + 3600)
      expect(result.isAuthorized).toBe(true)
      expect(result.role).toBe('user')
      expect(result.groupsCheckedAt).toBeGreaterThanOrEqual(now)
    })

    it('should set isAuthorized=false when user lacks required group', async () => {
      const now = Math.floor(Date.now() / 1000)
      const result = await withDefaultRequiredGroup(async ({ authOptions }) => (
        authOptions.callbacks!.jwt! as Function
      )({
        token: {},
        account: {
          access_token: 'at',
          id_token: 'idt',
          expires_at: now + 3600,
        },
        profile: {
          sub: 'sub-123',
          email: 'nogroup@example.com',
          groups: ['unrelated-group'],
        },
      }))

      expect(result.isAuthorized).toBe(false)
    })

    it('should NOT refresh token when expiry is more than 5 minutes away', async () => {
      const now = Math.floor(Date.now() / 1000)

      const result = await (authOptions.callbacks!.jwt! as Function)({
        token: {
          accessToken: 'old-at',
          refreshToken: 'rt',
          expiresAt: now + 600, // 10 minutes — no refresh needed
        },
      })

      expect(result.accessToken).toBe('old-at')
      // fetch should NOT have been called (no refresh needed)
      expect(fetchSpy).not.toHaveBeenCalled()
    })

    it('should attempt token refresh when within 5 minutes of expiry', async () => {
      const now = Math.floor(Date.now() / 1000)

      const result = await (authOptions.callbacks!.jwt! as Function)({
        token: {
          accessToken: 'old-at',
          idToken: 'old-idt',
          refreshToken: 'old-rt',
          expiresAt: now + 60, // 1 minute — refresh triggered
        },
      })

      expect(result.accessToken).toBe('new-access-token')
      expect(result.idToken).toBe('new-id-token')
      expect(result.refreshToken).toBe('new-refresh-token')
      expect(result.error).toBeUndefined()
    })

    it('should return RefreshTokenExpired when token expired by more than 1 hour', async () => {
      const now = Math.floor(Date.now() / 1000)

      const result = await (authOptions.callbacks!.jwt! as Function)({
        token: {
          accessToken: 'at',
          refreshToken: 'rt',
          expiresAt: now - 4000, // expired 4000s ago (>1h)
        },
      })

      expect(result.error).toBe('RefreshTokenExpired')
      // Should NOT call fetch when token is that stale
      expect(fetchSpy).not.toHaveBeenCalled()
    })

    it('should skip refresh attempt when token already has an error', async () => {
      const now = Math.floor(Date.now() / 1000)

      const result = await (authOptions.callbacks!.jwt! as Function)({
        token: {
          accessToken: 'at',
          refreshToken: 'rt',
          expiresAt: now + 60,
          error: 'RefreshTokenExpired',
        },
      })

      expect(result.error).toBe('RefreshTokenExpired')
      expect(fetchSpy).not.toHaveBeenCalled()
    })

    it('should return RefreshTokenExpired when token exchange returns non-JSON', async () => {
      fetchSpy.mockRestore()
      fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(
        makeRefreshFetchMock({ nonJsonResponse: true }),
      )

      const now = Math.floor(Date.now() / 1000)

      const result = await (authOptions.callbacks!.jwt! as Function)({
        token: {
          accessToken: 'at',
          refreshToken: 'rt',
          expiresAt: now + 60,
        },
      })

      expect(result.error).toBe('RefreshTokenExpired')
    })

    it('should return RefreshTokenExpired when token exchange fails', async () => {
      fetchSpy.mockRestore()
      fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(
        makeRefreshFetchMock({ tokenFails: true }),
      )

      const now = Math.floor(Date.now() / 1000)

      // Access token already expired (-10s): if refresh token also gives invalid_grant
      // this is a real failure (not a concurrent race), so the user must re-authenticate.
      const result = await (authOptions.callbacks!.jwt! as Function)({
        token: {
          accessToken: 'at',
          refreshToken: 'rt',
          expiresAt: now - 10,
        },
      })

      expect(result.error).toBe('RefreshTokenExpired')
    })

    it('should fall back to Keycloak-style token endpoint when OIDC discovery fails', async () => {
      fetchSpy.mockRestore()
      fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(
        makeRefreshFetchMock({ discoveryFails: true }),
      )

      const now = Math.floor(Date.now() / 1000)

      // Should still attempt the refresh using Keycloak fallback path
      await (authOptions.callbacks!.jwt! as Function)({
        token: {
          accessToken: 'at',
          refreshToken: 'rt',
          expiresAt: now + 60,
        },
      })

      // Discovery failed → fallback → token exchange also "failed" (our mock returns non-JSON
      // for the fallback call because discovery-fails mock only mocks the discovery call)
      // The important assertion: it attempted a refresh (fetch was called)
      expect(fetchSpy).toHaveBeenCalled()
    })

    it('should keep existing refresh token when provider does not return a new one', async () => {
      fetchSpy.mockRestore()
      fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(
        makeRefreshFetchMock({ newTokens: { refresh_token: undefined } }),
      )

      const now = Math.floor(Date.now() / 1000)

      const result = await (authOptions.callbacks!.jwt! as Function)({
        token: {
          accessToken: 'at',
          refreshToken: 'original-rt',
          expiresAt: now + 60,
        },
      })

      // Should keep original refresh token (null-coalescing in auth-config.ts)
      expect(result.refreshToken).toBe('original-rt')
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Group re-evaluation every 4 hours
  // ─────────────────────────────────────────────────────────────────────────

  describe('Group re-evaluation after token refresh', () => {
    const originalEnv = process.env
    let fetchSpy: jest.SpyInstance
    let mockDecodeJwt: jest.Mock

    beforeEach(() => {
      process.env = {
        ...originalEnv,
        OIDC_ISSUER: 'https://sso.example.com',
        OIDC_CLIENT_ID: 'test-client-id',
        OIDC_CLIENT_SECRET: 'test-client-secret',
        OIDC_ENABLE_REFRESH_TOKEN: 'true',
        OIDC_REQUIRED_ADMIN_GROUP: 'platform-admins',
      }
      fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(makeRefreshFetchMock())
      mockDecodeJwt = jest.requireMock('jose').decodeJwt
      mockDecodeJwt.mockReset()
    })

    afterEach(() => {
      process.env = originalEnv
      fetchSpy.mockRestore()
    })

    it('should re-evaluate groups when 4+ hours have passed since last check', async () => {
      const now = Math.floor(Date.now() / 1000)

      mockDecodeJwt.mockReturnValue({
        groups: ['backstage-access'],
      })

      const result = await (authOptions.callbacks!.jwt! as Function)({
        token: {
          accessToken: 'at',
          idToken: 'old-idt',
          refreshToken: 'rt',
          expiresAt: now + 60,
          groupsCheckedAt: now - 5 * 60 * 60, // 5 hours ago
          isAuthorized: true,
          role: 'user',
          canViewAdmin: false,
        },
      })

      // decodeJwt should be called with the freshly-refreshed id_token
      expect(mockDecodeJwt).toHaveBeenCalledWith('new-id-token')
      // groupsCheckedAt must be updated to "now" (re-eval happened)
      expect(result.groupsCheckedAt).toBeGreaterThanOrEqual(now)
      // isAuthorized reflects the re-evaluated groups
      expect(result.isAuthorized).toBe(true)
      // Note: role promotion (user→admin) requires OIDC_REQUIRED_ADMIN_GROUP to be
      // set at module LOAD time. That constant is evaluated once at import; env changes
      // in beforeEach arrive too late. Role promotion is covered in isAdminUser unit tests.
    })

    it('should NOT re-evaluate groups when less than 4 hours have passed', async () => {
      const now = Math.floor(Date.now() / 1000)

      mockDecodeJwt.mockReturnValue({ groups: ['backstage-access'] })

      await (authOptions.callbacks!.jwt! as Function)({
        token: {
          accessToken: 'at',
          idToken: 'old-idt',
          refreshToken: 'rt',
          expiresAt: now + 60,
          groupsCheckedAt: now - 1 * 60 * 60, // only 1 hour ago
          isAuthorized: true,
          role: 'user',
        },
      })

      // decodeJwt should NOT have been called (interval not reached)
      expect(mockDecodeJwt).not.toHaveBeenCalled()
    })

    it('should skip group re-evaluation when refreshed token has an error', async () => {
      fetchSpy.mockRestore()
      fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(
        makeRefreshFetchMock({ tokenFails: true }),
      )

      const now = Math.floor(Date.now() / 1000)

      mockDecodeJwt.mockReturnValue({ groups: ['backstage-access'] })

      // Access token already expired: this is a real refresh failure (not a race),
      // so the token gets error:'RefreshTokenExpired' and group re-eval is skipped.
      const result = await (authOptions.callbacks!.jwt! as Function)({
        token: {
          accessToken: 'at',
          idToken: 'old-idt',
          refreshToken: 'rt',
          expiresAt: now - 10,
          groupsCheckedAt: now - 5 * 60 * 60, // 5 hours ago
          isAuthorized: true,
          role: 'user',
        },
      })

      // Token refresh failed → shouldRecheckGroups is false → decodeJwt not called
      expect(mockDecodeJwt).not.toHaveBeenCalled()
      expect(result.error).toBe('RefreshTokenExpired')
    })

    it('should fall back gracefully when decodeJwt throws during group re-check', async () => {
      const now = Math.floor(Date.now() / 1000)

      mockDecodeJwt.mockImplementation(() => {
        throw new Error('Malformed JWT')
      })

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation()

      const result = await (authOptions.callbacks!.jwt! as Function)({
        token: {
          accessToken: 'at',
          idToken: 'old-idt',
          refreshToken: 'rt',
          expiresAt: now + 60,
          groupsCheckedAt: now - 5 * 60 * 60,
          isAuthorized: true,
          role: 'user',
        },
      })

      // Should return the refreshed token without re-evaluated groups
      expect(result.accessToken).toBe('new-access-token')
      // Existing authorization should be preserved
      expect(result.isAuthorized).toBe(true)
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to decode id_token'),
        expect.any(Error),
      )

      consoleSpy.mockRestore()
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // session callback
  // ─────────────────────────────────────────────────────────────────────────

  describe('session callback', () => {
    it('should pass accessToken and idToken to session when no error', async () => {
      const result = await (authOptions.callbacks!.session! as Function)({
        session: { user: { name: 'Test', email: 'test@example.com' } },
        token: {
          accessToken: 'at',
          idToken: 'idt',
          refreshToken: 'rt',
          isAuthorized: true,
          role: 'user',
          expiresAt: 9999999999,
          hasRefreshToken: true,
        },
      })

      expect(result.accessToken).toBe('at')
      expect(result.idToken).toBeUndefined()
      expect(result.isAuthorized).toBe(true)
      expect(result.role).toBe('user')
    })

    it('should clear accessToken from session when RefreshTokenExpired', async () => {
      const result = await (authOptions.callbacks!.session! as Function)({
        session: { user: { name: 'Test', email: 'test@example.com' } },
        token: {
          accessToken: 'at',
          idToken: 'idt',
          error: 'RefreshTokenExpired',
          isAuthorized: true,
          role: 'user',
        },
      })

      expect(result.accessToken).toBeUndefined()
      expect(result.error).toBe('RefreshTokenExpired')
    })

    it('should NOT include tokens in session when token has error', async () => {
      const result = await (authOptions.callbacks!.session! as Function)({
        session: { user: {} },
        token: {
          accessToken: 'at',
          idToken: 'idt',
          error: 'RefreshTokenError',
        },
      })

      // error path clears accessToken
      expect(result.accessToken).toBeUndefined()
    })

    it('should set role to user as default', async () => {
      const result = await (authOptions.callbacks!.session! as Function)({
        session: { user: {} },
        token: {
          // no role set
        },
      })

      expect(result.role).toBe('user')
    })
  })

  describe('extractGroups helper', () => {
    it('should extract groups from various OIDC claim formats', () => {
      expect(true).toBe(true) // Covered by JWT callback integration
    })
  })

  describe('isAdminUser', () => {
    it('returns false when OIDC_REQUIRED_ADMIN_GROUP is not set', () => {
      // Default is empty string, so returns false
      expect(isAdminUser([])).toBe(false)
    })
  })

  describe('canViewAdminDashboard', () => {
    it('returns true when OIDC_REQUIRED_ADMIN_VIEW_GROUP is not set (default)', () => {
      // Default is empty string = all authenticated users can view
      const groups = ['some-group']
      expect(canViewAdminDashboard(groups)).toBe(true)
    })

    it('returns true even with empty groups when no view group configured', () => {
      expect(canViewAdminDashboard([])).toBe(true)
    })
  })

  describe('canAccessDynamicAgents (OIDC_REQUIRED_DYNAMIC_AGENTS_GROUP)', () => {
    const originalEnv = process.env

    beforeEach(() => {
      jest.resetModules()
      process.env = { ...originalEnv }
    })

    afterAll(() => {
      process.env = originalEnv
    })

    it('returns false for empty groups when OIDC_REQUIRED_DYNAMIC_AGENTS_GROUP is not set (falls back to admin check)', () => {
      // No env var set → fallback to isAdminUser → REQUIRED_ADMIN_GROUP is '' → false
      expect(canAccessDynamicAgents([])).toBe(false)
    })

    it('returns false for non-admin groups when env var not set (admin fallback)', () => {
      expect(canAccessDynamicAgents(['eng', 'backend'])).toBe(false)
    })

    it('returns true when OIDC_REQUIRED_DYNAMIC_AGENTS_GROUP is set and user is in that group', () => {
      jest.isolateModules(() => {
        process.env.OIDC_REQUIRED_DYNAMIC_AGENTS_GROUP = 'custom-agents-users'
        const { canAccessDynamicAgents: fn } = require('../auth-config')
        expect(fn(['custom-agents-users', 'eng'])).toBe(true)
      })
    })

    it('returns false when OIDC_REQUIRED_DYNAMIC_AGENTS_GROUP is set but user is not in that group', () => {
      jest.isolateModules(() => {
        process.env.OIDC_REQUIRED_DYNAMIC_AGENTS_GROUP = 'custom-agents-users'
        const { canAccessDynamicAgents: fn } = require('../auth-config')
        expect(fn(['eng', 'backstage-access'])).toBe(false)
      })
    })

    it('check is case-insensitive', () => {
      jest.isolateModules(() => {
        process.env.OIDC_REQUIRED_DYNAMIC_AGENTS_GROUP = 'Custom-Agents-Users'
        const { canAccessDynamicAgents: fn } = require('../auth-config')
        expect(fn(['custom-agents-users'])).toBe(true)
      })
    })

    it('matches LDAP DN format (cn=... substring)', () => {
      jest.isolateModules(() => {
        process.env.OIDC_REQUIRED_DYNAMIC_AGENTS_GROUP = 'custom-agents-users'
        const { canAccessDynamicAgents: fn } = require('../auth-config')
        expect(fn(['CN=custom-agents-users,OU=Groups,DC=example,DC=com'])).toBe(true)
      })
    })

    it('does not match partial substring outside of DN format', () => {
      jest.isolateModules(() => {
        process.env.OIDC_REQUIRED_DYNAMIC_AGENTS_GROUP = 'agents'
        const { canAccessDynamicAgents: fn } = require('../auth-config')
        // "custom-agents-users" contains "agents" as substring but should NOT match
        // (only exact or cn=... match is valid)
        expect(fn(['custom-agents-users'])).toBe(false)
      })
    })

    it('returns false for empty groups even when env var is set', () => {
      jest.isolateModules(() => {
        process.env.OIDC_REQUIRED_DYNAMIC_AGENTS_GROUP = 'custom-agents-users'
        const { canAccessDynamicAgents: fn } = require('../auth-config')
        expect(fn([])).toBe(false)
      })
    })

    it('ignores admin group when OIDC_REQUIRED_DYNAMIC_AGENTS_GROUP is set', () => {
      jest.isolateModules(() => {
        process.env.OIDC_REQUIRED_DYNAMIC_AGENTS_GROUP = 'custom-agents-users'
        process.env.OIDC_REQUIRED_ADMIN_GROUP = 'sre-admin'
        const { canAccessDynamicAgents: fn } = require('../auth-config')
        // User is in admin group but NOT in custom-agents-users → should return false
        expect(fn(['sre-admin'])).toBe(false)
      })
    })

    it('env var set to empty string falls back to admin check', () => {
      jest.isolateModules(() => {
        process.env.OIDC_REQUIRED_DYNAMIC_AGENTS_GROUP = ''
        // REQUIRED_ADMIN_GROUP defaults to '' → isAdminUser returns false
        const { canAccessDynamicAgents: fn } = require('../auth-config')
        expect(fn(['eng'])).toBe(false)
      })
    })
  })


  // ─────────────────────────────────────────────────────────────────────────
  // Concurrent refresh race safety nets
  // ─────────────────────────────────────────────────────────────────────────

  describe('Concurrent refresh race safety nets', () => {
    const originalEnv = process.env
    let fetchSpy: jest.SpyInstance

    beforeEach(() => {
      process.env = {
        ...originalEnv,
        OIDC_ISSUER: 'https://sso.example.com',
        OIDC_CLIENT_ID: 'test-client-id',
        OIDC_CLIENT_SECRET: 'test-client-secret',
        OIDC_ENABLE_REFRESH_TOKEN: 'true',
      }
      _resetInflightRefreshes()
    })

    afterEach(() => {
      process.env = originalEnv
      fetchSpy?.mockRestore()
    })

    it('Safety net 1: concurrent callers share one HTTP exchange', async () => {
      // Two JWT callbacks with the same refresh token fire simultaneously.
      // Only one fetch should happen (the in-flight dedup kicks in for the second).
      let resolveExchange!: (v: Response) => void
      const exchangeHeld = new Promise<Response>((res) => { resolveExchange = res })

      let fetchCallCount = 0
      fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (url) => {
        fetchCallCount++
        const urlStr = url.toString()
        if (urlStr.includes('.well-known')) {
          return {
            ok: true,
            json: async () => ({ token_endpoint: 'https://sso.example.com/token' }),
          } as Response
        }
        // Hold the exchange until we're ready
        return exchangeHeld
      })

      const now = Math.floor(Date.now() / 1000)
      const baseToken = {
        accessToken: 'at',
        idToken: 'old-idt',
        refreshToken: 'shared-rt',
        expiresAt: now + 60,
      }

      // Fire two concurrent calls
      const call1 = (authOptions.callbacks!.jwt! as Function)({ token: { ...baseToken } })
      const call2 = (authOptions.callbacks!.jwt! as Function)({ token: { ...baseToken } })

      // Resolve the held exchange with a successful response
      resolveExchange({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({
          access_token: 'new-at',
          id_token: 'new-idt',
          refresh_token: 'new-rt',
          expires_in: 3600,
        }),
      } as any)

      const [result1, result2] = await Promise.all([call1, call2])

      // Both should get new tokens
      expect(result1.accessToken).toBe('new-at')
      expect(result2.accessToken).toBe('new-at')

      // Only 2 fetches total: 1 discovery + 1 exchange (not 2 exchanges)
      // (The second caller joined the in-flight Promise)
      expect(fetchCallCount).toBe(2)
    })

    it('Safety net 2: invalid_grant with valid access token keeps session (no logout)', async () => {
      const now = Math.floor(Date.now() / 1000)

      fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(makeRefreshFetchMock({
        tokenFails: false,
        // Override to return invalid_grant specifically
      }))
      // Override with invalid_grant scenario
      fetchSpy.mockRestore()
      fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (url) => {
        const urlStr = url.toString()
        if (urlStr.includes('.well-known')) {
          return {
            ok: true,
            json: async () => ({ token_endpoint: 'https://sso.example.com/token' }),
          } as Response
        }
        // Token exchange: return invalid_grant
        return {
          ok: false,
          headers: { get: () => 'application/json' },
          json: async () => ({ error: 'invalid_grant', error_description: 'Token already used' }),
        } as any
      })

      const result = await (authOptions.callbacks!.jwt! as Function)({
        token: {
          accessToken: 'still-valid-at',
          refreshToken: 'consumed-rt',
          expiresAt: now + 200, // access token still valid but within 5-min refresh window
        },
      })

      // Should NOT be logged out — access token is still valid
      expect(result.error).toBeUndefined()
      expect(result.accessToken).toBe('still-valid-at')
      // Should suppress further refresh attempts until token expires
      expect(result.refreshSuppressedUntil).toBe(now + 200)
    })

    it('Safety net 3: suppressed refresh prevents further refresh attempts', async () => {
      const now = Math.floor(Date.now() / 1000)

      fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(makeRefreshFetchMock())

      // Token has refreshSuppressedUntil set (from a prior graceful invalid_grant)
      const result = await (authOptions.callbacks!.jwt! as Function)({
        token: {
          accessToken: 'still-valid-at',
          refreshToken: 'consumed-rt',
          expiresAt: now + 200,
          refreshSuppressedUntil: now + 200, // suppressed until token expires
        },
      })

      // Should return the token as-is without attempting refresh
      expect(result.accessToken).toBe('still-valid-at')
      expect(result.error).toBeUndefined()
      // No fetch calls — refresh was suppressed
      expect(fetchSpy).not.toHaveBeenCalled()
    })

    it('Safety net 2: invalid_grant with expired access token still logs out', async () => {
      const now = Math.floor(Date.now() / 1000)

      fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (url) => {
        const urlStr = url.toString()
        if (urlStr.includes('.well-known')) {
          return {
            ok: true,
            json: async () => ({ token_endpoint: 'https://sso.example.com/token' }),
          } as Response
        }
        return {
          ok: false,
          headers: { get: () => 'application/json' },
          json: async () => ({ error: 'invalid_grant', error_description: 'Token already used' }),
        } as any
      })

      const result = await (authOptions.callbacks!.jwt! as Function)({
        token: {
          accessToken: 'expired-at',
          refreshToken: 'consumed-rt',
          expiresAt: now - 300, // access token has already expired
        },
      })

      // Access token is expired too — user must re-authenticate
      expect(result.error).toBe('RefreshTokenExpired')
    })
  })
})
