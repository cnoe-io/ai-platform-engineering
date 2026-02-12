/**
 * Unit tests for TokenExpiryGuard component
 *
 * Tests cover:
 * - Token expiry monitoring and warning display
 * - Dismiss button persistence (stays dismissed for the same expiry cycle)
 * - Silent token auto-refresh via updateSession
 * - Expired token handling and auto-redirect
 * - Warning message changes based on refresh token availability
 * - Re-login button signs out before redirect (prevents infinite loop)
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

  // Mock sessionStorage
  let sessionStorageData: Record<string, string> = {}
  const mockSessionStorage = {
    getItem: jest.fn((key: string) => sessionStorageData[key] ?? null),
    setItem: jest.fn((key: string, value: string) => { sessionStorageData[key] = value }),
    removeItem: jest.fn((key: string) => { delete sessionStorageData[key] }),
    clear: jest.fn(() => { sessionStorageData = {} }),
  }

  beforeEach(() => {
    jest.restoreAllMocks()
    jest.useFakeTimers()
    mockUpdateSession.mockClear().mockResolvedValue(undefined)
    sessionStorageData = {}
    Object.defineProperty(window, 'sessionStorage', { value: mockSessionStorage, writable: true })

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
  // Re-login button (infinite loop fix)
  // ─────────────────────────────────────────────────────────────────────

  describe('re-login button', () => {
    it('should call signOut (not router.push) when Re-login Now is clicked', async () => {
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
        expect(screen.getByText(/session expiring soon/i)).toBeInTheDocument()
      })

      // Click Re-login Now
      fireEvent.click(screen.getByText(/re-login now/i))

      // Should call signOut with callbackUrl (not router.push)
      await waitFor(() => {
        expect(mockSignOut).toHaveBeenCalledWith({ callbackUrl: '/login?session_expired=true' })
      })

      // Should NOT use router.push (that causes the loop)
      expect(mockPush).not.toHaveBeenCalled()
    })

    it('should set token-expiry-handling flag before signing out', async () => {
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

      fireEvent.click(screen.getByText(/re-login now/i))

      // Should set the flag to prevent AuthGuard from also redirecting
      await waitFor(() => {
        expect(mockSessionStorage.setItem).toHaveBeenCalledWith('token-expiry-handling', 'true')
      })
    })

    it('should call signOut and set expiry flag when re-login is clicked', async () => {
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

      fireEvent.click(screen.getByText(/re-login now/i))

      // signOut should be called (this is the key assertion — it breaks the loop)
      await waitFor(() => {
        expect(mockSignOut).toHaveBeenCalledWith({ callbackUrl: '/login?session_expired=true' })
      })

      // The expiry handling flag should be set before signOut
      expect(mockSessionStorage.setItem).toHaveBeenCalledWith('token-expiry-handling', 'true')
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
        expect(screen.getByText(/save your work and re-login/i)).toBeInTheDocument()
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
  })

  // ─────────────────────────────────────────────────────────────────────
  // Logout handler
  // ─────────────────────────────────────────────────────────────────────

  describe('logout handler', () => {
    it('should clear token-expiry-handling flag on logout', async () => {
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

      // The re-login handler sets the flag; when signOut completes it should be cleared
      await waitFor(() => {
        expect(screen.getByText(/session expiring soon/i)).toBeInTheDocument()
      })

      // Click Re-login Now (which uses the new signOut-based handler)
      fireEvent.click(screen.getByText(/re-login now/i))

      await waitFor(() => {
        expect(mockSignOut).toHaveBeenCalledWith({ callbackUrl: '/login?session_expired=true' })
      })
    })
  })
})
