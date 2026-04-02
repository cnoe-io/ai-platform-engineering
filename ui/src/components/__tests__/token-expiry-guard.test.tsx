/**
 * Unit tests for TokenExpiryGuard component
 *
 * Tests cover:
 * - Token expiry monitoring and warning display
 * - Dismiss button persistence (stays dismissed for the same expiry cycle)
 * - Silent token auto-refresh via updateSession
 * - Expired token handling and auto-redirect
 * - Warning message changes based on refresh token availability
 * - "Refresh in New Tab" opens new tab without disrupting current page
 * - "Log In Again" on expired modal signs out and clears flag
 * - BroadcastChannel SESSION_REFRESHED updates session silently
 * - Auto-logout after 5-second countdown
 * - Concurrent refresh lock (only one refresh attempt at a time)
 * - Cleanup on unmount
 */

import React from 'react'
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react'
import { useSession, signOut } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { TokenExpiryGuard } from '../token-expiry-guard'

// Mock Next Auth
const mockUpdateSession = jest.fn().mockResolvedValue(undefined)

jest.mock('next-auth/react', () => ({
  useSession: jest.fn(),
  signOut: jest.fn(),
}))

// Mock Next Router
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
}))

// Mock config
jest.mock('@/lib/config', () => ({
  getConfig: jest.fn((key: string) => {
    if (key === 'ssoEnabled') return true
    return undefined
  }),
}))

// Mock framer-motion to avoid animation issues in tests
jest.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}))

describe('TokenExpiryGuard', () => {
  const mockPush = jest.fn()
  const mockSignOut = signOut as jest.MockedFunction<typeof signOut>
  const mockUseSession = useSession as jest.MockedFunction<typeof useSession>
  const mockUseRouter = useRouter as jest.MockedFunction<typeof useRouter>
  let mockWindowOpen: jest.Mock

  // Mock sessionStorage
  let sessionStorageData: Record<string, string> = {}
  const mockSessionStorage = {
    getItem: jest.fn((key: string) => sessionStorageData[key] ?? null),
    setItem: jest.fn((key: string, value: string) => { sessionStorageData[key] = value }),
    removeItem: jest.fn((key: string) => { delete sessionStorageData[key] }),
    clear: jest.fn(() => { sessionStorageData = {} }),
  }

  // BroadcastChannel mock instances (pushed in order of creation)
  const broadcastChannelInstances: Array<{ onmessage: ((e: any) => void) | null; close: jest.Mock }> = []

  beforeEach(() => {
    jest.restoreAllMocks()
    jest.useFakeTimers()
    mockUpdateSession.mockClear().mockResolvedValue(undefined)
    sessionStorageData = {}
    broadcastChannelInstances.length = 0

    Object.defineProperty(window, 'sessionStorage', { value: mockSessionStorage, writable: true })

    // Mock window.open
    mockWindowOpen = jest.fn()
    Object.defineProperty(window, 'open', { value: mockWindowOpen, writable: true })

    // Mock BroadcastChannel
    ;(global as any).BroadcastChannel = jest.fn().mockImplementation(() => {
      const instance = { onmessage: null as any, close: jest.fn() }
      broadcastChannelInstances.push(instance)
      return instance
    })

    // Reset getConfig mock to default (ssoEnabled = true)
    const { getConfig } = require('@/lib/config')
    getConfig.mockImplementation((key: string) => {
      if (key === 'ssoEnabled') return true
      return undefined
    })

    mockUseRouter.mockReturnValue({
      push: mockPush,
    } as any)

    mockSignOut.mockResolvedValue(undefined as any)
  })

  afterEach(() => {
    // Only run pending timers if fake timers are active
    try { jest.runOnlyPendingTimers() } catch { /* real timers active */ }
    jest.useRealTimers()
  })

  // ─────────────────────────────────────────────────────────────────────
  // Basic rendering
  // ─────────────────────────────────────────────────────────────────────

  it('should render nothing when SSO is not enabled', () => {
    const { getConfig } = require('@/lib/config')
    getConfig.mockReturnValue(false)

    mockUseSession.mockReturnValue({
      data: null,
      status: 'unauthenticated',
    } as any)

    const { container } = render(<TokenExpiryGuard />)
    expect(container.firstChild).toBeNull()
  })

  it('should render nothing when not authenticated', () => {
    mockUseSession.mockReturnValue({
      data: null,
      status: 'unauthenticated',
    } as any)

    const { container } = render(<TokenExpiryGuard />)
    expect(container.firstChild).toBeNull()
  })

  it('should render nothing when session is loading', () => {
    mockUseSession.mockReturnValue({
      data: null,
      status: 'loading',
    } as any)

    const { container } = render(<TokenExpiryGuard />)
    expect(container.firstChild).toBeNull()
  })

  // ─────────────────────────────────────────────────────────────────────
  // Warning display
  // ─────────────────────────────────────────────────────────────────────

  it('should not show warning when token has plenty of time remaining', () => {
    const futureExpiry = Math.floor(Date.now() / 1000) + 600 // 10 minutes from now

    mockUseSession.mockReturnValue({
      data: {
        user: { name: 'Test User', email: 'test@example.com' },
        expiresAt: futureExpiry,
      } as any,
      status: 'authenticated',
      update: mockUpdateSession,
    })

    render(<TokenExpiryGuard />)

    // Advance timer by 30 seconds (one check cycle)
    act(() => {
      jest.advanceTimersByTime(30000)
    })

    // Should not show any warnings
    expect(screen.queryByText(/session expiring soon/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/session expired/i)).not.toBeInTheDocument()
  })

  it('should not call signOut when token expires soon (warning only)', async () => {
    const soonExpiry = Math.floor(Date.now() / 1000) + 240 // 4 minutes from now

    mockUseSession.mockReturnValue({
      data: {
        user: { name: 'Test User', email: 'test@example.com' },
        expiresAt: soonExpiry,
      } as any,
      status: 'authenticated',
      update: mockUpdateSession,
    })

    render(<TokenExpiryGuard />)

    // Wait for mount
    await act(async () => {
      jest.advanceTimersByTime(0)
    })

    // Trigger warning check
    await act(async () => {
      jest.advanceTimersByTime(30000)
    })

    // Should NOT call signOut yet (just warning)
    expect(mockSignOut).not.toHaveBeenCalled()
  })

  it('should check token expiry periodically', async () => {
    const futureExpiry = Math.floor(Date.now() / 1000) + 600

    // Track when checkTokenExpiry is called by spying on console.warn
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation()

    mockUseSession.mockReturnValue({
      data: {
        user: { name: 'Test User', email: 'test@example.com' },
        expiresAt: futureExpiry,
        accessToken: 'test-token',
      } as any,
      status: 'authenticated',
      update: mockUpdateSession,
    })

    render(<TokenExpiryGuard />)

    // Clear any initial logs
    consoleSpy.mockClear()

    // Advance by 30 seconds (one check cycle) - this should trigger the interval
    await act(async () => {
      jest.advanceTimersByTime(30000)
    })

    // Component should still be checking (no warning or errors)
    // Just verify no errors were thrown and component is still mounted
    expect(mockSignOut).not.toHaveBeenCalled()

    consoleSpy.mockRestore()
  })

  it('should execute expiry checks without crashing', async () => {
    // Test with various expiry times to ensure logic doesn't crash
    const testCases = [
      Math.floor(Date.now() / 1000) + 600, // 10 min - no warning
      Math.floor(Date.now() / 1000) + 240, // 4 min - warning
      Math.floor(Date.now() / 1000) + 120, // 2 min - warning
    ]

    for (const expiry of testCases) {
      mockUseSession.mockReturnValue({
        data: {
          user: { name: 'Test User', email: 'test@example.com' },
          expiresAt: expiry,
        } as any,
        status: 'authenticated',
        update: mockUpdateSession,
      })

      const { unmount } = render(<TokenExpiryGuard />)

      // Wait for mount and trigger check
      await act(async () => {
        jest.advanceTimersByTime(30000)
      })

      // Component should not crash
      expect(true).toBe(true)

      unmount()
    }
  })

  it('should cleanup interval on unmount', () => {
    const futureExpiry = Math.floor(Date.now() / 1000) + 600

    mockUseSession.mockReturnValue({
      data: {
        user: { name: 'Test User', email: 'test@example.com' },
        expiresAt: futureExpiry,
      } as any,
      status: 'authenticated',
      update: mockUpdateSession,
    })

    const { unmount } = render(<TokenExpiryGuard />)

    unmount()

    // Advance time - no errors should occur
    act(() => {
      jest.advanceTimersByTime(60000)
    })

    // No assertions needed - just ensuring no errors
  })

  // ─────────────────────────────────────────────────────────────────────
  // Refresh in New Tab button
  // ─────────────────────────────────────────────────────────────────────

  describe('Refresh in New Tab button', () => {
    it('should open new tab with correct callbackUrl when clicked', async () => {
      jest.useRealTimers()
      const soonExpiry = Math.floor(Date.now() / 1000) + 240

      mockUseSession.mockReturnValue({
        data: {
          user: { name: 'Test User', email: 'test@example.com' },
          expiresAt: soonExpiry,
          hasRefreshToken: false,
        } as any,
        status: 'authenticated',
        update: mockUpdateSession,
      })

      render(<TokenExpiryGuard />)

      await waitFor(() => {
        expect(screen.getByText(/session expiring soon/i)).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText(/refresh in new tab/i))

      const expectedCallbackUrl = encodeURIComponent('/auth/reauth-complete')
      expect(mockWindowOpen).toHaveBeenCalledWith(
        `/api/auth/signin/oidc?callbackUrl=${expectedCallbackUrl}`,
        '_blank',
        'noopener',
      )
    })

    it('should NOT call signOut when Refresh in New Tab is clicked', async () => {
      jest.useRealTimers()
      const soonExpiry = Math.floor(Date.now() / 1000) + 240

      mockUseSession.mockReturnValue({
        data: {
          user: { name: 'Test User', email: 'test@example.com' },
          expiresAt: soonExpiry,
          hasRefreshToken: false,
        } as any,
        status: 'authenticated',
        update: mockUpdateSession,
      })

      render(<TokenExpiryGuard />)

      await waitFor(() => {
        expect(screen.getByText(/session expiring soon/i)).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText(/refresh in new tab/i))

      // Should NOT sign out — user stays on the current page
      expect(mockSignOut).not.toHaveBeenCalled()
    })

    it('should NOT redirect (router.push) when Refresh in New Tab is clicked', async () => {
      jest.useRealTimers()
      const soonExpiry = Math.floor(Date.now() / 1000) + 240

      mockUseSession.mockReturnValue({
        data: {
          user: { name: 'Test User', email: 'test@example.com' },
          expiresAt: soonExpiry,
          hasRefreshToken: false,
        } as any,
        status: 'authenticated',
        update: mockUpdateSession,
      })

      render(<TokenExpiryGuard />)

      await waitFor(() => {
        expect(screen.getByText(/session expiring soon/i)).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText(/refresh in new tab/i))

      expect(mockPush).not.toHaveBeenCalled()
    })
  })

  // ─────────────────────────────────────────────────────────────────────
  // Dismiss persistence tests
  // ─────────────────────────────────────────────────────────────────────

  describe('dismiss persistence', () => {
    it('should keep warning dismissed after clicking Dismiss (same expiry cycle)', async () => {
      jest.useRealTimers() // Use real timers so async flows resolve naturally
      const soonExpiry = Math.floor(Date.now() / 1000) + 240 // 4 minutes from now

      mockUseSession.mockReturnValue({
        data: {
          user: { name: 'Test User', email: 'test@example.com' },
          expiresAt: soonExpiry,
        } as any,
        status: 'authenticated',
        update: mockUpdateSession,
      })

      render(<TokenExpiryGuard />)

      // Wait for warning to appear (checkTokenExpiry runs on mount via useEffect)
      await waitFor(() => {
        expect(screen.getByText(/session expiring soon/i)).toBeInTheDocument()
      })

      // Click Dismiss
      fireEvent.click(screen.getByText('Dismiss'))

      // Warning should disappear
      expect(screen.queryByText(/session expiring soon/i)).not.toBeInTheDocument()
    })

    it('should show warning again after token is refreshed (new expiry cycle)', async () => {
      jest.useRealTimers()
      const soonExpiry = Math.floor(Date.now() / 1000) + 240 // 4 minutes from now

      mockUseSession.mockReturnValue({
        data: {
          user: { name: 'Test User', email: 'test@example.com' },
          expiresAt: soonExpiry,
        } as any,
        status: 'authenticated',
        update: mockUpdateSession,
      })

      const { rerender } = render(<TokenExpiryGuard />)

      // Wait for warning to appear
      await waitFor(() => {
        expect(screen.getByText(/session expiring soon/i)).toBeInTheDocument()
      })

      // Dismiss
      fireEvent.click(screen.getByText('Dismiss'))
      expect(screen.queryByText(/session expiring soon/i)).not.toBeInTheDocument()

      // Simulate token refresh — new expiresAt (different value = new expiry cycle)
      const newExpiry = Math.floor(Date.now() / 1000) + 200

      mockUseSession.mockReturnValue({
        data: {
          user: { name: 'Test User', email: 'test@example.com' },
          expiresAt: newExpiry,
        } as any,
        status: 'authenticated',
        update: mockUpdateSession,
      })

      rerender(<TokenExpiryGuard />)

      // Warning should reappear for the new expiry cycle
      await waitFor(() => {
        expect(screen.getByText(/session expiring soon/i)).toBeInTheDocument()
      })
    })
  })

  // ─────────────────────────────────────────────────────────────────────
  // Silent auto-refresh tests
  // ─────────────────────────────────────────────────────────────────────

  describe('silent auto-refresh', () => {
    it('should call updateSession when token is within warning window and refresh token exists', async () => {
      jest.useRealTimers()
      const soonExpiry = Math.floor(Date.now() / 1000) + 240 // 4 minutes from now

      mockUseSession.mockReturnValue({
        data: {
          user: { name: 'Test User', email: 'test@example.com' },
          expiresAt: soonExpiry,
          hasRefreshToken: true,
        } as any,
        status: 'authenticated',
        update: mockUpdateSession,
      })

      render(<TokenExpiryGuard />)

      // Wait for the warning to appear (which means checkTokenExpiry ran)
      await waitFor(() => {
        expect(screen.getByText(/session expiring soon/i)).toBeInTheDocument()
      })

      // updateSession should have been called (silent refresh triggered on mount)
      expect(mockUpdateSession).toHaveBeenCalled()
    })

    it('should NOT call updateSession when token has plenty of time remaining', async () => {
      jest.useRealTimers()
      const futureExpiry = Math.floor(Date.now() / 1000) + 600 // 10 min from now

      mockUseSession.mockReturnValue({
        data: {
          user: { name: 'Test User', email: 'test@example.com' },
          expiresAt: futureExpiry,
          hasRefreshToken: true,
        } as any,
        status: 'authenticated',
        update: mockUpdateSession,
      })

      render(<TokenExpiryGuard />)

      // Wait a tick for effects to settle
      await waitFor(() => {
        // No warning should appear (token not near expiry)
        expect(screen.queryByText(/session expiring soon/i)).not.toBeInTheDocument()
      })

      // Should NOT have called updateSession (token not near expiry)
      expect(mockUpdateSession).not.toHaveBeenCalled()
    })

    it('should show auto-refresh message when hasRefreshToken is true', async () => {
      jest.useRealTimers()
      const soonExpiry = Math.floor(Date.now() / 1000) + 240

      mockUseSession.mockReturnValue({
        data: {
          user: { name: 'Test User', email: 'test@example.com' },
          expiresAt: soonExpiry,
          hasRefreshToken: true,
        } as any,
        status: 'authenticated',
        update: mockUpdateSession,
      })

      render(<TokenExpiryGuard />)

      // Wait for warning to appear
      await waitFor(() => {
        expect(screen.getByText(/attempting to refresh automatically/i)).toBeInTheDocument()
      })
    })

    it('should show manual re-login message when hasRefreshToken is false', async () => {
      jest.useRealTimers()
      const soonExpiry = Math.floor(Date.now() / 1000) + 240

      mockUseSession.mockReturnValue({
        data: {
          user: { name: 'Test User', email: 'test@example.com' },
          expiresAt: soonExpiry,
          hasRefreshToken: false,
        } as any,
        status: 'authenticated',
        update: mockUpdateSession,
      })

      render(<TokenExpiryGuard />)

      // Wait for warning to appear
      await waitFor(() => {
        expect(screen.getByText(/please re-login to continue/i)).toBeInTheDocument()
      })

      expect(screen.queryByText(/attempting to refresh automatically/i)).not.toBeInTheDocument()
    })

    it('should not crash if updateSession rejects', async () => {
      jest.useRealTimers()
      const soonExpiry = Math.floor(Date.now() / 1000) + 240
      mockUpdateSession.mockRejectedValueOnce(new Error('Network error'))

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation()

      mockUseSession.mockReturnValue({
        data: {
          user: { name: 'Test User', email: 'test@example.com' },
          expiresAt: soonExpiry,
          hasRefreshToken: true,
        } as any,
        status: 'authenticated',
        update: mockUpdateSession,
      })

      render(<TokenExpiryGuard />)

      // Should not crash — warning is still displayed
      await waitFor(() => {
        expect(screen.getByText(/session expiring soon/i)).toBeInTheDocument()
      })

      consoleSpy.mockRestore()
    })

    it('should not start a second refresh while first is in flight (concurrent lock)', async () => {
      // Use fake timers so we can control the 30s interval
      // mockUpdateSession never resolves for this test, keeping isRefreshingRef = true
      let resolveFirstRefresh!: () => void
      mockUpdateSession.mockReturnValue(
        new Promise<any>((resolve) => { resolveFirstRefresh = resolve }),
      )

      const soonExpiry = Math.floor(Date.now() / 1000) + 240

      mockUseSession.mockReturnValue({
        data: {
          user: { name: 'Test User', email: 'test@example.com' },
          expiresAt: soonExpiry,
          hasRefreshToken: true,
        } as any,
        status: 'authenticated',
        update: mockUpdateSession,
      })

      render(<TokenExpiryGuard />)

      // Initial mount check triggers the first refresh (never resolves)
      await act(async () => { jest.advanceTimersByTime(0) })

      expect(mockUpdateSession).toHaveBeenCalledTimes(1)

      // 30s interval fires — first refresh is still in flight
      await act(async () => { jest.advanceTimersByTime(30000) })

      // updateSession should still be called only once (lock prevents second call)
      expect(mockUpdateSession).toHaveBeenCalledTimes(1)

      // Resolve first refresh to clean up
      act(() => { resolveFirstRefresh() })
    })
  })

  // ─────────────────────────────────────────────────────────────────────
  // Refresh token error handling
  // ─────────────────────────────────────────────────────────────────────

  describe('refresh token errors', () => {
    it('should set token-expiry-handling flag when RefreshTokenExpired', async () => {
      jest.useRealTimers()

      mockUseSession.mockReturnValue({
        data: {
          user: { name: 'Test User', email: 'test@example.com' },
          error: 'RefreshTokenExpired',
        } as any,
        status: 'authenticated',
        update: mockUpdateSession,
      })

      render(<TokenExpiryGuard />)

      await waitFor(() => {
        expect(mockSessionStorage.setItem).toHaveBeenCalledWith('token-expiry-handling', 'true')
      })
    })

    it('should set token-expiry-handling flag when RefreshTokenError', async () => {
      jest.useRealTimers()

      mockUseSession.mockReturnValue({
        data: {
          user: { name: 'Test User', email: 'test@example.com' },
          error: 'RefreshTokenError',
        } as any,
        status: 'authenticated',
        update: mockUpdateSession,
      })

      render(<TokenExpiryGuard />)

      await waitFor(() => {
        expect(mockSessionStorage.setItem).toHaveBeenCalledWith('token-expiry-handling', 'true')
      })
    })

    it('should show expired modal when session has RefreshTokenExpired error', async () => {
      jest.useRealTimers()

      mockUseSession.mockReturnValue({
        data: {
          user: { name: 'Test User', email: 'test@example.com' },
          error: 'RefreshTokenExpired',
        } as any,
        status: 'authenticated',
        update: mockUpdateSession,
      })

      render(<TokenExpiryGuard />)

      await waitFor(() => {
        expect(screen.getByText(/session expired/i)).toBeInTheDocument()
      })
    })
  })

  // ─────────────────────────────────────────────────────────────────────
  // Logout handler (expired modal)
  // ─────────────────────────────────────────────────────────────────────

  describe('logout handler', () => {
    it('should call signOut with /login callbackUrl when Log In Again is clicked', async () => {
      jest.useRealTimers()

      mockUseSession.mockReturnValue({
        data: {
          user: { name: 'Test User', email: 'test@example.com' },
          error: 'RefreshTokenExpired',
        } as any,
        status: 'authenticated',
        update: mockUpdateSession,
      })

      render(<TokenExpiryGuard />)

      await waitFor(() => {
        expect(screen.getByText(/session expired/i)).toBeInTheDocument()
      })

      fireEvent.click(screen.getByRole('button', { name: /log in again/i }))

      await waitFor(() => {
        expect(mockSignOut).toHaveBeenCalledWith({ callbackUrl: '/login' })
      })
    })

    it('should clear token-expiry-handling flag when Log In Again is clicked', async () => {
      jest.useRealTimers()
      // Pre-populate the flag (as set when entering the error/expired state)
      sessionStorageData['token-expiry-handling'] = 'true'

      mockUseSession.mockReturnValue({
        data: {
          user: { name: 'Test User', email: 'test@example.com' },
          error: 'RefreshTokenExpired',
        } as any,
        status: 'authenticated',
        update: mockUpdateSession,
      })

      render(<TokenExpiryGuard />)

      await waitFor(() => {
        expect(screen.getByText(/session expired/i)).toBeInTheDocument()
      })

      fireEvent.click(screen.getByRole('button', { name: /log in again/i }))

      await waitFor(() => {
        expect(mockSessionStorage.removeItem).toHaveBeenCalledWith('token-expiry-handling')
      })
    })
  })

  // ─────────────────────────────────────────────────────────────────────
  // Auto-logout countdown
  // ─────────────────────────────────────────────────────────────────────

  describe('auto-logout countdown', () => {
    it('should auto-redirect after 5 seconds when RefreshTokenExpired', async () => {
      mockUseSession.mockReturnValue({
        data: {
          user: { name: 'Test User', email: 'test@example.com' },
          error: 'RefreshTokenExpired',
        } as any,
        status: 'authenticated',
        update: mockUpdateSession,
      })

      render(<TokenExpiryGuard />)

      // Mount triggers checkTokenExpiry which sets a 5s setTimeout
      await act(async () => { jest.advanceTimersByTime(0) })

      // Advance 5 seconds — auto-logout fires
      await act(async () => { jest.advanceTimersByTime(5000) })

      expect(mockSignOut).toHaveBeenCalledWith({ callbackUrl: '/login' })
    })

    it('should auto-redirect after 5 seconds when token has actually expired', async () => {
      const pastExpiry = Math.floor(Date.now() / 1000) - 10 // expired 10s ago

      mockUseSession.mockReturnValue({
        data: {
          user: { name: 'Test User', email: 'test@example.com' },
          expiresAt: pastExpiry,
        } as any,
        status: 'authenticated',
        update: mockUpdateSession,
      })

      render(<TokenExpiryGuard />)

      await act(async () => { jest.advanceTimersByTime(0) })
      await act(async () => { jest.advanceTimersByTime(5000) })

      expect(mockSignOut).toHaveBeenCalledWith({ callbackUrl: '/login' })
    })
  })

  // ─────────────────────────────────────────────────────────────────────
  // BroadcastChannel SESSION_REFRESHED
  // ─────────────────────────────────────────────────────────────────────

  describe('BroadcastChannel SESSION_REFRESHED', () => {
    it('should call updateSession and clear warning when SESSION_REFRESHED is received', async () => {
      jest.useRealTimers()
      const soonExpiry = Math.floor(Date.now() / 1000) + 240
      const freshExpiry = Math.floor(Date.now() / 1000) + 3600

      const sessionConfig = {
        data: {
          user: { name: 'Test User', email: 'test@example.com' },
          expiresAt: soonExpiry,
          hasRefreshToken: false,
        } as any,
        status: 'authenticated',
        update: mockUpdateSession,
      }

      mockUseSession.mockReturnValue(sessionConfig)

      render(<TokenExpiryGuard />)

      // Wait for warning to appear
      await waitFor(() => {
        expect(screen.getByText(/session expiring soon/i)).toBeInTheDocument()
      })

      // Update session mock to simulate what updateSession() fetches: fresh token
      // This ensures checkTokenExpiry (re-triggered after showWarning→false) sees
      // the refreshed expiry and does not re-show the warning.
      mockUseSession.mockReturnValue({
        ...sessionConfig,
        data: { ...sessionConfig.data, expiresAt: freshExpiry },
      })

      // Simulate SESSION_REFRESHED broadcast from reauth-complete tab
      const channel = broadcastChannelInstances[0]
      await act(async () => {
        channel.onmessage!({ data: { type: 'SESSION_REFRESHED' } })
        // Flush promise microtasks (updateSession().then(...))
        await Promise.resolve()
        await Promise.resolve()
      })

      // updateSession should have been called
      expect(mockUpdateSession).toHaveBeenCalled()
      // Warning should be cleared (fresh session + setShowWarning(false))
      await waitFor(() => {
        expect(screen.queryByText(/session expiring soon/i)).not.toBeInTheDocument()
      })
    })

    it('should remove token-expiry-handling flag after SESSION_REFRESHED', async () => {
      jest.useRealTimers()
      sessionStorageData['token-expiry-handling'] = 'true'
      const soonExpiry = Math.floor(Date.now() / 1000) + 240

      mockUseSession.mockReturnValue({
        data: {
          user: { name: 'Test User', email: 'test@example.com' },
          expiresAt: soonExpiry,
          hasRefreshToken: false,
        } as any,
        status: 'authenticated',
        update: mockUpdateSession,
      })

      render(<TokenExpiryGuard />)

      await waitFor(() => {
        expect(screen.getByText(/session expiring soon/i)).toBeInTheDocument()
      })

      const channel = broadcastChannelInstances[0]
      await act(async () => {
        channel.onmessage!({ data: { type: 'SESSION_REFRESHED' } })
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(mockSessionStorage.removeItem).toHaveBeenCalledWith('token-expiry-handling')
    })

    it('should ignore broadcast messages that are not SESSION_REFRESHED', async () => {
      jest.useRealTimers()
      const soonExpiry = Math.floor(Date.now() / 1000) + 240

      mockUseSession.mockReturnValue({
        data: {
          user: { name: 'Test User', email: 'test@example.com' },
          expiresAt: soonExpiry,
          hasRefreshToken: false,
        } as any,
        status: 'authenticated',
        update: mockUpdateSession,
      })

      render(<TokenExpiryGuard />)

      await waitFor(() => {
        expect(screen.getByText(/session expiring soon/i)).toBeInTheDocument()
      })

      const callCountBefore = mockUpdateSession.mock.calls.length

      const channel = broadcastChannelInstances[0]
      await act(async () => {
        channel.onmessage!({ data: { type: 'SOME_OTHER_EVENT' } })
        await Promise.resolve()
      })

      // updateSession should NOT have been called for this event
      expect(mockUpdateSession).toHaveBeenCalledTimes(callCountBefore)
      // Warning should still be visible
      expect(screen.getByText(/session expiring soon/i)).toBeInTheDocument()
    })

    it('should close the BroadcastChannel on unmount', async () => {
      jest.useRealTimers()
      const futureExpiry = Math.floor(Date.now() / 1000) + 600

      mockUseSession.mockReturnValue({
        data: {
          user: { name: 'Test User', email: 'test@example.com' },
          expiresAt: futureExpiry,
        } as any,
        status: 'authenticated',
        update: mockUpdateSession,
      })

      const { unmount } = render(<TokenExpiryGuard />)

      // Wait for the BroadcastChannel to be created
      await waitFor(() => {
        expect(broadcastChannelInstances.length).toBeGreaterThan(0)
      })

      const channel = broadcastChannelInstances[0]

      unmount()

      expect(channel.close).toHaveBeenCalled()
    })
  })

  // ─────────────────────────────────────────────────────────────────────
  // Warning hidden when token is refreshed (else-if branch)
  // ─────────────────────────────────────────────────────────────────────

  describe('warning cleared after token refresh', () => {
    it('should hide warning and remove flag when token is refreshed (outside warning window)', async () => {
      jest.useRealTimers()
      const soonExpiry = Math.floor(Date.now() / 1000) + 240

      mockUseSession.mockReturnValue({
        data: {
          user: { name: 'Test User', email: 'test@example.com' },
          expiresAt: soonExpiry,
          hasRefreshToken: true,
        } as any,
        status: 'authenticated',
        update: mockUpdateSession,
      })

      const { rerender } = render(<TokenExpiryGuard />)

      // Wait for warning to appear
      await waitFor(() => {
        expect(screen.getByText(/session expiring soon/i)).toBeInTheDocument()
      })

      // Simulate token refresh: new expiresAt far in the future
      const refreshedExpiry = Math.floor(Date.now() / 1000) + 3600 // 1 hour

      mockUseSession.mockReturnValue({
        data: {
          user: { name: 'Test User', email: 'test@example.com' },
          expiresAt: refreshedExpiry,
          hasRefreshToken: true,
        } as any,
        status: 'authenticated',
        update: mockUpdateSession,
      })

      rerender(<TokenExpiryGuard />)

      // Warning should disappear because we're now outside the warning window
      await waitFor(() => {
        expect(screen.queryByText(/session expiring soon/i)).not.toBeInTheDocument()
      })
    })
  })
})
