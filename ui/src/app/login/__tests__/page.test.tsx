/**
 * Unit tests for Login page
 *
 * Tests cover:
 * - Redirect loop detection and circuit breaker
 * - Authenticated user redirect to app (happy path)
 * - No redirect when session_expired param is present
 * - No redirect when session_reset param is present
 * - Session expired message display
 * - Loop broken message display
 * - Error message display
 * - Sign-in button clears loop counter
 */

import React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { useSession, signIn } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'

// Must import the component AFTER mocks are set up
let LoginPage: React.ComponentType

// Mock Next Auth
jest.mock('next-auth/react', () => ({
  useSession: jest.fn(),
  signIn: jest.fn(),
}))

// Mock Next Router
const mockPush = jest.fn()
const mockSearchParamsGet = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
  useSearchParams: jest.fn(),
}))

// Mock config
jest.mock('@/lib/config', () => ({
  config: {
    appName: 'Test App',
    tagline: 'Test tagline',
    description: 'Test description',
    logoUrl: '/logo.png',
    logoStyle: 'default',
    previewMode: false,
    showPoweredBy: false,
  },
  getLogoFilterClass: jest.fn(() => ''),
}))

// Mock LoadingScreen
jest.mock('@/components/loading-screen', () => ({
  LoadingScreen: ({ message }: { message: string }) => (
    <div data-testid="loading-screen">{message}</div>
  ),
}))

// Mock IntegrationOrbit
jest.mock('@/components/gallery/IntegrationOrbit', () => ({
  IntegrationOrbit: () => <div data-testid="integration-orbit" />,
}))

// Mock framer-motion
jest.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}))

describe('Login Page', () => {
  const mockUseSession = useSession as jest.MockedFunction<typeof useSession>
  const mockUseRouter = useRouter as jest.MockedFunction<typeof useRouter>
  const mockUseSearchParams = useSearchParams as jest.MockedFunction<typeof useSearchParams>
  const mockSignIn = signIn as jest.MockedFunction<typeof signIn>

  // Mock sessionStorage
  let sessionStorageData: Record<string, string> = {}
  const mockSessionStorage = {
    getItem: jest.fn((key: string) => sessionStorageData[key] ?? null),
    setItem: jest.fn((key: string, value: string) => { sessionStorageData[key] = value }),
    removeItem: jest.fn((key: string) => { delete sessionStorageData[key] }),
    clear: jest.fn(() => { sessionStorageData = {} }),
  }

  // Mock localStorage
  const mockLocalStorage = {
    getItem: jest.fn(() => null),
    setItem: jest.fn(),
    removeItem: jest.fn(),
    clear: jest.fn(),
  }

  beforeAll(async () => {
    // Dynamic import after mocks are ready
    const mod = await import('../page')
    LoginPage = mod.default
  })

  beforeEach(() => {
    jest.clearAllMocks()
    sessionStorageData = {}
    Object.defineProperty(window, 'sessionStorage', { value: mockSessionStorage, writable: true })
    Object.defineProperty(window, 'localStorage', { value: mockLocalStorage, writable: true })

    // Mock document.cookie
    Object.defineProperty(document, 'cookie', { value: '', writable: true, configurable: true })

    mockUseRouter.mockReturnValue({ push: mockPush } as any)

    // Default searchParams: no special params
    mockSearchParamsGet.mockReturnValue(null)
    mockUseSearchParams.mockReturnValue({
      get: mockSearchParamsGet,
    } as any)

    mockSignIn.mockResolvedValue(undefined as any)
  })

  // ─────────────────────────────────────────────────────────────────────
  // Basic rendering
  // ─────────────────────────────────────────────────────────────────────

  it('should render login button when unauthenticated', () => {
    mockUseSession.mockReturnValue({ data: null, status: 'unauthenticated' } as any)

    render(<LoginPage />)

    expect(screen.getByText(/sign in with sso/i)).toBeInTheDocument()
  })

  it('should show loading screen while session is loading', () => {
    mockUseSession.mockReturnValue({ data: null, status: 'loading' } as any)

    render(<LoginPage />)

    expect(screen.getByTestId('loading-screen')).toBeInTheDocument()
  })

  // ─────────────────────────────────────────────────────────────────────
  // Authenticated user redirect
  // ─────────────────────────────────────────────────────────────────────

  it('should redirect authenticated user to callbackUrl', async () => {
    mockUseSession.mockReturnValue({
      data: { user: { name: 'Test' } },
      status: 'authenticated',
    } as any)

    render(<LoginPage />)

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/')
    })
  })

  it('should NOT redirect authenticated user when session_expired param is present', async () => {
    mockSearchParamsGet.mockImplementation((key: string) => {
      if (key === 'session_expired') return 'true'
      return null
    })

    mockUseSession.mockReturnValue({
      data: { user: { name: 'Test' } },
      status: 'authenticated',
    } as any)

    render(<LoginPage />)

    // Wait a tick to ensure effects run
    await waitFor(() => {
      expect(screen.getByText(/sign in with sso/i)).toBeInTheDocument()
    })

    // Should NOT redirect
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('should NOT redirect authenticated user when session_reset param is present', async () => {
    mockSearchParamsGet.mockImplementation((key: string) => {
      if (key === 'session_reset') return 'auto'
      return null
    })

    mockUseSession.mockReturnValue({
      data: { user: { name: 'Test' } },
      status: 'authenticated',
    } as any)

    render(<LoginPage />)

    await waitFor(() => {
      expect(screen.getByText(/sign in with sso/i)).toBeInTheDocument()
    })

    expect(mockPush).not.toHaveBeenCalled()
  })

  // ─────────────────────────────────────────────────────────────────────
  // Redirect loop detection
  // ─────────────────────────────────────────────────────────────────────

  it('should detect redirect loop and show reset message after 3 rapid visits', async () => {
    mockUseSession.mockReturnValue({
      data: { user: { name: 'Test' } },
      status: 'authenticated',
    } as any)

    // Simulate 2 prior visits within the time window
    const now = Date.now()
    sessionStorageData['login-redirect-count'] = '2'
    sessionStorageData['login-redirect-ts'] = String(now)

    render(<LoginPage />)

    // Should show loop-broken message (3rd visit = threshold hit)
    await waitFor(() => {
      expect(screen.getByText(/a login loop was detected/i)).toBeInTheDocument()
    })

    // Should NOT redirect (loop is broken)
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('should reset loop counter when visits are outside the time window', async () => {
    mockUseSession.mockReturnValue({ data: null, status: 'unauthenticated' } as any)

    // Simulate 2 prior visits but outside the 10s window (old timestamp)
    sessionStorageData['login-redirect-count'] = '2'
    sessionStorageData['login-redirect-ts'] = String(Date.now() - 20_000) // 20 seconds ago

    render(<LoginPage />)

    // Should NOT show loop message (counter was reset due to old timestamp)
    await waitFor(() => {
      expect(screen.queryByText(/a login loop was detected/i)).not.toBeInTheDocument()
    })

    // Counter should have been reset to 1
    expect(mockSessionStorage.setItem).toHaveBeenCalledWith('login-redirect-count', '1')
  })

  it('should clear cookies and storage when loop is detected', async () => {
    mockUseSession.mockReturnValue({
      data: { user: { name: 'Test' } },
      status: 'authenticated',
    } as any)

    // At threshold
    sessionStorageData['login-redirect-count'] = '2'
    sessionStorageData['login-redirect-ts'] = String(Date.now())

    render(<LoginPage />)

    await waitFor(() => {
      expect(screen.getByText(/a login loop was detected/i)).toBeInTheDocument()
    })

    // Should have cleared the loop counter keys
    expect(mockSessionStorage.removeItem).toHaveBeenCalledWith('login-redirect-count')
    expect(mockSessionStorage.removeItem).toHaveBeenCalledWith('login-redirect-ts')
    expect(mockSessionStorage.removeItem).toHaveBeenCalledWith('token-expiry-handling')
  })

  // ─────────────────────────────────────────────────────────────────────
  // Messages display
  // ─────────────────────────────────────────────────────────────────────

  it('should show session expired message when session_expired=true', async () => {
    mockSearchParamsGet.mockImplementation((key: string) => {
      if (key === 'session_expired') return 'true'
      return null
    })

    mockUseSession.mockReturnValue({ data: null, status: 'unauthenticated' } as any)

    render(<LoginPage />)

    await waitFor(() => {
      expect(screen.getByText(/session expired/i)).toBeInTheDocument()
      expect(screen.getByText(/your authentication session has expired/i)).toBeInTheDocument()
    })
  })

  it('should show error message for OAuth errors', async () => {
    mockSearchParamsGet.mockImplementation((key: string) => {
      if (key === 'error') return 'OAuthCallback'
      return null
    })

    mockUseSession.mockReturnValue({ data: null, status: 'unauthenticated' } as any)

    render(<LoginPage />)

    await waitFor(() => {
      expect(screen.getByText(/authentication failed/i)).toBeInTheDocument()
    })
  })

  it('should prioritize loop-broken message over session-expired message', async () => {
    mockSearchParamsGet.mockImplementation((key: string) => {
      if (key === 'session_expired') return 'true'
      return null
    })

    mockUseSession.mockReturnValue({
      data: { user: { name: 'Test' } },
      status: 'authenticated',
    } as any)

    // Trigger loop detection
    sessionStorageData['login-redirect-count'] = '2'
    sessionStorageData['login-redirect-ts'] = String(Date.now())

    render(<LoginPage />)

    await waitFor(() => {
      // Loop message should show
      expect(screen.getByText(/a login loop was detected/i)).toBeInTheDocument()
      // Session expired message should NOT show (loop message takes priority)
      expect(screen.queryByText(/your authentication session has expired/i)).not.toBeInTheDocument()
    })
  })

  // ─────────────────────────────────────────────────────────────────────
  // Sign-in button
  // ─────────────────────────────────────────────────────────────────────

  it('should clear loop counter and token-expiry flag on sign-in click', async () => {
    mockUseSession.mockReturnValue({ data: null, status: 'unauthenticated' } as any)

    // Set some stale data
    sessionStorageData['login-redirect-count'] = '1'
    sessionStorageData['login-redirect-ts'] = String(Date.now())
    sessionStorageData['token-expiry-handling'] = 'true'

    render(<LoginPage />)

    fireEvent.click(screen.getByText(/sign in with sso/i))

    // Should clear loop counters
    expect(mockSessionStorage.removeItem).toHaveBeenCalledWith('login-redirect-count')
    expect(mockSessionStorage.removeItem).toHaveBeenCalledWith('login-redirect-ts')
    expect(mockSessionStorage.removeItem).toHaveBeenCalledWith('token-expiry-handling')

    // Should call signIn
    await waitFor(() => {
      expect(mockSignIn).toHaveBeenCalledWith('oidc', { callbackUrl: '/' })
    })
  })
})
