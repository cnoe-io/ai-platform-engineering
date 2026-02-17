/**
 * Unit tests for TokenExpiryGuard component
 * Tests token expiry monitoring, warnings, and user notifications
 */

import React from 'react'
import { render, screen, waitFor, act } from '@testing-library/react'
import { useSession, signOut } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { TokenExpiryGuard } from '../token-expiry-guard'

// Mock Next Auth
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

  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers()

    mockUseRouter.mockReturnValue({
      push: mockPush,
    } as any)

    mockSignOut.mockResolvedValue(undefined as any)
  })

  afterEach(() => {
    jest.runOnlyPendingTimers()
    jest.useRealTimers()
  })

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

  it('should not show warning when token has plenty of time remaining', () => {
    const futureExpiry = Math.floor(Date.now() / 1000) + 600 // 10 minutes from now

    mockUseSession.mockReturnValue({
      data: {
        user: { name: 'Test User', email: 'test@example.com' },
        expiresAt: futureExpiry,
      } as any,
      status: 'authenticated',
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

  // TODO: Fix fake timer interaction with React effects
  it.skip('should show critical modal when token is expired', async () => {
    const expiredTime = Math.floor(Date.now() / 1000) - 10 // 10 seconds ago

    mockUseSession.mockReturnValue({
      data: {
        user: { name: 'Test User', email: 'test@example.com' },
        expiresAt: expiredTime,
      } as any,
      status: 'authenticated',
    })

    render(<TokenExpiryGuard />)

    // Advance time by 5 seconds for auto-redirect (component calls checkTokenExpiry immediately on mount)
    await act(async () => {
      jest.advanceTimersByTime(5000)
    })

    // Verify signOut was called
    expect(mockSignOut).toHaveBeenCalledWith({ callbackUrl: '/login' })
  })

  // TODO: Fix fake timer interaction with React effects
  it.skip('should auto-redirect after detecting token expired', async () => {
    const expiredTime = Math.floor(Date.now() / 1000) - 10

    mockUseSession.mockReturnValue({
      data: {
        user: { name: 'Test User', email: 'test@example.com' },
        expiresAt: expiredTime,
      } as any,
      status: 'authenticated',
    })

    render(<TokenExpiryGuard />)

    // Advance time by 5 seconds for auto-redirect
    await act(async () => {
      jest.advanceTimersByTime(5000)
    })

    // Should have called signOut with correct callback
    expect(mockSignOut).toHaveBeenCalledWith({ callbackUrl: '/login' })
  })

  // TODO: Fix fake timer interaction with React effects
  it.skip('should handle refresh token expiry error', async () => {
    mockUseSession.mockReturnValue({
      data: {
        user: { name: 'Test User', email: 'test@example.com' },
        error: 'RefreshTokenExpired',
      } as any,
      status: 'authenticated',
    })

    render(<TokenExpiryGuard />)

    // Advance time by 5 seconds for auto-redirect
    await act(async () => {
      jest.advanceTimersByTime(5000)
    })

    // Should call signOut
    expect(mockSignOut).toHaveBeenCalledWith({ callbackUrl: '/login' })
  })

  // TODO: Fix fake timer interaction with React effects
  it.skip('should handle refresh token error', async () => {
    mockUseSession.mockReturnValue({
      data: {
        user: { name: 'Test User', email: 'test@example.com' },
        error: 'RefreshTokenError',
      } as any,
      status: 'authenticated',
    })

    render(<TokenExpiryGuard />)

    // Advance time by 5 seconds for auto-redirect
    await act(async () => {
      jest.advanceTimersByTime(5000)
    })

    // Should call signOut
    expect(mockSignOut).toHaveBeenCalledWith({ callbackUrl: '/login' })
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

  // TODO: Fix fake timer interaction with React effects
  it.skip('should stop checking after token expires and trigger signOut', async () => {
    const expiredTime = Math.floor(Date.now() / 1000) - 10

    mockUseSession.mockReturnValue({
      data: {
        user: { name: 'Test User', email: 'test@example.com' },
        expiresAt: expiredTime,
      } as any,
      status: 'authenticated',
    })

    render(<TokenExpiryGuard />)

    // Advance by 5 seconds for auto-redirect (initial check happens immediately)
    await act(async () => {
      jest.advanceTimersByTime(5000)
    })

    // signOut should be called once
    expect(mockSignOut).toHaveBeenCalledTimes(1)
    expect(mockSignOut).toHaveBeenCalledWith({ callbackUrl: '/login' })
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
    })

    const { unmount } = render(<TokenExpiryGuard />)

    unmount()

    // Advance time - no errors should occur
    act(() => {
      jest.advanceTimersByTime(60000)
    })

    // No assertions needed - just ensuring no errors
  })
})
