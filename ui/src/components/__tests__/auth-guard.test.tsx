/**
 * Unit tests for AuthGuard component
 * Tests route protection, token validation, and redirect behavior
 */

import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { AuthGuard } from '../auth-guard'

// Mock Next Auth
jest.mock('next-auth/react', () => ({
  useSession: jest.fn(),
  signOut: jest.fn(() => Promise.resolve()),
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

// Mock auth-utils
jest.mock('@/lib/auth-utils', () => ({
  isTokenExpired: jest.fn((expiresAt: number, buffer: number) => {
    const now = Math.floor(Date.now() / 1000)
    return now >= (expiresAt - buffer)
  }),
}))

// Mock LoadingScreen
jest.mock('@/components/loading-screen', () => ({
  LoadingScreen: ({ message }: { message: string }) => <div data-testid="loading-screen">{message}</div>,
}))

describe('AuthGuard', () => {
  const mockPush = jest.fn()
  const mockUseSession = useSession as jest.MockedFunction<typeof useSession>
  const mockUseRouter = useRouter as jest.MockedFunction<typeof useRouter>

  beforeEach(() => {
    jest.clearAllMocks()

    mockUseRouter.mockReturnValue({
      push: mockPush,
    } as any)
  })

  describe('SSO Disabled', () => {
    beforeEach(() => {
      const { getConfig } = require('@/lib/config')
      getConfig.mockImplementation((key: string) => {
        if (key === 'ssoEnabled') return false
        return undefined
      })
    })

    it('should render children directly when SSO is disabled', async () => {
      mockUseSession.mockReturnValue({
        data: null,
        status: 'unauthenticated',
      } as any)

      render(
        <AuthGuard>
          <div data-testid="protected-content">Protected Content</div>
        </AuthGuard>
      )

      await waitFor(() => {
        expect(screen.getByTestId('protected-content')).toBeInTheDocument()
      })

      expect(mockPush).not.toHaveBeenCalled()
    })
  })

  describe('SSO Enabled', () => {
    beforeEach(() => {
      const { getConfig } = require('@/lib/config')
      getConfig.mockImplementation((key: string) => {
        if (key === 'ssoEnabled') return true
        return undefined
      })
    })

    it('should show loading screen while checking SSO config', () => {
      mockUseSession.mockReturnValue({
        data: null,
        status: 'loading',
      } as any)

      render(
        <AuthGuard>
          <div data-testid="protected-content">Protected Content</div>
        </AuthGuard>
      )

      // Should render nothing initially (SSO config check)
      expect(screen.queryByTestId('protected-content')).not.toBeInTheDocument()
    })

    it('should show loading screen while session is loading', async () => {
      mockUseSession.mockReturnValue({
        data: null,
        status: 'loading',
      } as any)

      render(
        <AuthGuard>
          <div data-testid="protected-content">Protected Content</div>
        </AuthGuard>
      )

      await waitFor(() => {
        expect(screen.getByTestId('loading-screen')).toBeInTheDocument()
      })

      expect(screen.getByText(/checking authentication/i)).toBeInTheDocument()
    })

    it('should redirect to login when unauthenticated', async () => {
      mockUseSession.mockReturnValue({
        data: null,
        status: 'unauthenticated',
      } as any)

      render(
        <AuthGuard>
          <div data-testid="protected-content">Protected Content</div>
        </AuthGuard>
      )

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/login')
      })

      expect(screen.queryByTestId('protected-content')).not.toBeInTheDocument()
    })

    it('should redirect to unauthorized when user lacks required group', async () => {
      mockUseSession.mockReturnValue({
        data: {
          user: { name: 'Test User', email: 'test@example.com' },
          isAuthorized: false,
        } as any,
        status: 'authenticated',
      })

      render(
        <AuthGuard>
          <div data-testid="protected-content">Protected Content</div>
        </AuthGuard>
      )

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/unauthorized')
      })
    })

    it('should redirect to login when refresh token expired', async () => {
      mockUseSession.mockReturnValue({
        data: {
          user: { name: 'Test User', email: 'test@example.com' },
          isAuthorized: true,
          error: 'RefreshTokenExpired',
        } as any,
        status: 'authenticated',
      })

      render(
        <AuthGuard>
          <div data-testid="protected-content">Protected Content</div>
        </AuthGuard>
      )

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/login?session_expired=true')
      })
    })

    it('should redirect to login when refresh token error occurs', async () => {
      mockUseSession.mockReturnValue({
        data: {
          user: { name: 'Test User', email: 'test@example.com' },
          isAuthorized: true,
          error: 'RefreshTokenError',
        } as any,
        status: 'authenticated',
      })

      render(
        <AuthGuard>
          <div data-testid="protected-content">Protected Content</div>
        </AuthGuard>
      )

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/login?session_expired=true')
      })
    })

    it('should redirect to login when token is expired', async () => {
      const expiredTime = Math.floor(Date.now() / 1000) - 100 // Expired 100 seconds ago

      mockUseSession.mockReturnValue({
        data: {
          user: { name: 'Test User', email: 'test@example.com' },
          isAuthorized: true,
          expiresAt: expiredTime,
        } as any,
        status: 'authenticated',
      })

      render(
        <AuthGuard>
          <div data-testid="protected-content">Protected Content</div>
        </AuthGuard>
      )

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/login?session_expired=true')
      })
    })

    it('should render children when authenticated and authorized', async () => {
      const futureExpiry = Math.floor(Date.now() / 1000) + 600 // 10 minutes from now

      mockUseSession.mockReturnValue({
        data: {
          user: { name: 'Test User', email: 'test@example.com' },
          isAuthorized: true,
          expiresAt: futureExpiry,
        } as any,
        status: 'authenticated',
      })

      render(
        <AuthGuard>
          <div data-testid="protected-content">Protected Content</div>
        </AuthGuard>
      )

      await waitFor(() => {
        expect(screen.getByTestId('protected-content')).toBeInTheDocument()
      })

      expect(mockPush).not.toHaveBeenCalled()
    })

    it('should show loading then render content for valid session', async () => {
      const futureExpiry = Math.floor(Date.now() / 1000) + 600

      mockUseSession.mockReturnValue({
        data: {
          user: { name: 'Test User', email: 'test@example.com' },
          isAuthorized: true,
          expiresAt: futureExpiry,
        } as any,
        status: 'authenticated',
      })

      render(
        <AuthGuard>
          <div data-testid="protected-content">Protected Content</div>
        </AuthGuard>
      )

      // Should eventually show content after auth check
      await waitFor(() => {
        expect(screen.getByTestId('protected-content')).toBeInTheDocument()
      })

      expect(mockPush).not.toHaveBeenCalled()
    })

    it('should handle token close to expiry (within 60s buffer)', async () => {
      const soonExpiry = Math.floor(Date.now() / 1000) + 30 // 30 seconds from now (within 60s buffer)

      mockUseSession.mockReturnValue({
        data: {
          user: { name: 'Test User', email: 'test@example.com' },
          isAuthorized: true,
          expiresAt: soonExpiry,
        } as any,
        status: 'authenticated',
      })

      render(
        <AuthGuard>
          <div data-testid="protected-content">Protected Content</div>
        </AuthGuard>
      )

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/login?session_expired=true')
      })
    })

    it('should not redirect when token is valid and beyond buffer', async () => {
      const validExpiry = Math.floor(Date.now() / 1000) + 300 // 5 minutes from now (beyond 60s buffer)

      mockUseSession.mockReturnValue({
        data: {
          user: { name: 'Test User', email: 'test@example.com' },
          isAuthorized: true,
          expiresAt: validExpiry,
        } as any,
        status: 'authenticated',
      })

      render(
        <AuthGuard>
          <div data-testid="protected-content">Protected Content</div>
        </AuthGuard>
      )

      await waitFor(() => {
        expect(screen.getByTestId('protected-content')).toBeInTheDocument()
      })

      expect(mockPush).not.toHaveBeenCalled()
    })
  })

  describe('Edge Cases', () => {
    beforeEach(() => {
      const { getConfig } = require('@/lib/config')
      getConfig.mockImplementation((key: string) => {
        if (key === 'ssoEnabled') return true
        return undefined
      })
    })

    it('should handle session without expiresAt', async () => {
      mockUseSession.mockReturnValue({
        data: {
          user: { name: 'Test User', email: 'test@example.com' },
          isAuthorized: true,
          // No expiresAt field
        } as any,
        status: 'authenticated',
      })

      render(
        <AuthGuard>
          <div data-testid="protected-content">Protected Content</div>
        </AuthGuard>
      )

      await waitFor(() => {
        expect(screen.getByTestId('protected-content')).toBeInTheDocument()
      })
    })

    it('should handle explicitly false isAuthorized flag', async () => {
      mockUseSession.mockReturnValue({
        data: {
          user: { name: 'Test User', email: 'test@example.com' },
          isAuthorized: false, // Explicitly set to false
        } as any,
        status: 'authenticated',
      })

      render(
        <AuthGuard>
          <div data-testid="protected-content">Protected Content</div>
        </AuthGuard>
      )

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/unauthorized')
      })
    })

    it('should prioritize refresh token errors over token expiry', async () => {
      const expiredTime = Math.floor(Date.now() / 1000) - 100

      mockUseSession.mockReturnValue({
        data: {
          user: { name: 'Test User', email: 'test@example.com' },
          isAuthorized: true,
          error: 'RefreshTokenExpired',
          expiresAt: expiredTime,
        } as any,
        status: 'authenticated',
      })

      render(
        <AuthGuard>
          <div data-testid="protected-content">Protected Content</div>
        </AuthGuard>
      )

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/login?session_expired=true')
      })

      // Should only redirect once (for refresh error, not for expired token)
      expect(mockPush).toHaveBeenCalledTimes(1)
    })
  })

  describe('TokenExpiryGuard coordination', () => {
    beforeEach(() => {
      const { getConfig } = require('@/lib/config')
      getConfig.mockImplementation((key: string) => {
        if (key === 'ssoEnabled') return true
        return undefined
      })
    })

    it('should skip redirect and render children when token-expiry-handling flag is set', async () => {
      // Simulate TokenExpiryGuard handling expiry
      Object.defineProperty(window, 'sessionStorage', {
        value: {
          getItem: (key: string) => key === 'token-expiry-handling' ? 'true' : null,
          setItem: jest.fn(),
          removeItem: jest.fn(),
          clear: jest.fn(),
        },
        writable: true,
      })

      const soonExpiry = Math.floor(Date.now() / 1000) + 30 // within 60s buffer

      mockUseSession.mockReturnValue({
        data: {
          user: { name: 'Test User', email: 'test@example.com' },
          isAuthorized: true,
          expiresAt: soonExpiry,
        } as any,
        status: 'authenticated',
      })

      render(
        <AuthGuard>
          <div data-testid="protected-content">Protected Content</div>
        </AuthGuard>
      )

      // Should render children (not redirect) because TokenExpiryGuard is handling it
      await waitFor(() => {
        expect(screen.getByTestId('protected-content')).toBeInTheDocument()
      })

      // Should NOT redirect to login
      expect(mockPush).not.toHaveBeenCalledWith('/login?session_expired=true')
    })

    it('should handle RefreshTokenMissing error gracefully without crashing', async () => {
      mockUseSession.mockReturnValue({
        data: {
          user: { name: 'Test User', email: 'test@example.com' },
          isAuthorized: true,
          error: 'RefreshTokenMissing',
          expiresAt: Math.floor(Date.now() / 1000) + 600,
        } as any,
        status: 'authenticated',
      })

      render(
        <AuthGuard>
          <div data-testid="protected-content">Protected Content</div>
        </AuthGuard>
      )

      // RefreshTokenMissing is not RefreshTokenExpired/Error, so it should render
      await waitFor(() => {
        expect(screen.getByTestId('protected-content')).toBeInTheDocument()
      })
    })

    it('should handle transition from loading to authenticated without extra redirect', async () => {
      // Start as loading
      mockUseSession.mockReturnValue({
        data: null,
        status: 'loading',
      } as any)

      const { rerender } = render(
        <AuthGuard>
          <div data-testid="protected-content">Protected Content</div>
        </AuthGuard>
      )

      // Should show loading
      expect(screen.getByTestId('loading-screen')).toBeInTheDocument()

      // Transition to authenticated
      mockUseSession.mockReturnValue({
        data: {
          user: { name: 'Test User', email: 'test@example.com' },
          isAuthorized: true,
          expiresAt: Math.floor(Date.now() / 1000) + 600,
        } as any,
        status: 'authenticated',
      })

      rerender(
        <AuthGuard>
          <div data-testid="protected-content">Protected Content</div>
        </AuthGuard>
      )

      // Should render content without any redirect
      await waitFor(() => {
        expect(screen.getByTestId('protected-content')).toBeInTheDocument()
      })

      expect(mockPush).not.toHaveBeenCalled()
    })
  })
})
