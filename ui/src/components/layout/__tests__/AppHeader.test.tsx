/**
 * Unit tests for AppHeader component — Insights tab visibility
 *
 * Tests:
 * - Insights tab is visible when MongoDB is configured and user is authenticated
 * - Insights tab is NOT visible when storageMode !== 'mongodb'
 * - Insights tab is NOT visible when user is not authenticated (no session)
 * - Insights tab shows active state when pathname starts with /insights
 * - Insights tab link points to /insights
 * - Admin tab visibility is independent of Insights tab
 */

import React from 'react'
import { render, screen } from '@testing-library/react'

// ============================================================================
// Mocks — must be before imports
// ============================================================================

const mockSession = {
  data: { user: { name: 'Test User', email: 'test@test.com' } } as any,
  status: 'authenticated' as const,
  update: jest.fn(),
}
jest.mock('next-auth/react', () => ({
  useSession: jest.fn(() => mockSession),
}))

let mockPathname = '/chat'
jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}))

// Mock admin role hook
let mockIsAdmin = false
jest.mock('@/hooks/use-admin-role', () => ({
  useAdminRole: () => ({ isAdmin: mockIsAdmin }),
}))

// Mock chat store
jest.mock('@/store/chat-store', () => ({
  useChatStore: jest.fn(() => ({
    isStreaming: false,
  })),
}))

// Mock CAIPE health hook
let mockStorageMode = 'mongodb'
jest.mock('@/hooks/use-caipe-health', () => ({
  useCAIPEHealth: () => ({
    status: 'connected',
    url: 'http://localhost:8080',
    secondsUntilNextCheck: 30,
    agents: [],
    tags: {},
    mongoDBStatus: true,
    storageMode: mockStorageMode,
  }),
}))

// Mock RAG health hook
jest.mock('@/hooks/use-rag-health', () => ({
  useRAGHealth: () => ({
    status: 'connected',
    url: 'http://localhost:9090',
    enabled: false,
    secondsUntilNextCheck: 30,
    graphRagEnabled: false,
  }),
}))

// Mock version hook
jest.mock('@/hooks/use-version', () => ({
  useVersion: () => ({
    versionInfo: { version: '1.0.0', buildDate: '2026-02-10', gitCommit: 'abc1234' },
  }),
}))

// Mock config - this is a direct import, not getConfig
jest.mock('@/lib/config', () => ({
  config: {
    appName: 'Test App',
    tagline: 'Test tagline',
    logoUrl: '/logo.svg',
    logoStyle: 'auto',
    docsUrl: 'https://docs.example.com',
    githubUrl: 'https://github.com/example',
    ssoEnabled: true,
    previewMode: false,
    ragEnabled: false,
  },
  getConfig: jest.fn((key: string) => {
    const configs: Record<string, any> = {
      appName: 'Test App',
      tagline: 'Test tagline',
      logoUrl: '/logo.svg',
      logoStyle: 'auto',
      docsUrl: 'https://docs.example.com',
      githubUrl: 'https://github.com/example',
      ssoEnabled: true,
      previewMode: false,
      ragEnabled: false,
    }
    return configs[key]
  }),
  getLogoFilterClass: jest.fn(() => ''),
}))

// Mock Link component
jest.mock('next/link', () => {
  return React.forwardRef(({ children, href, className, ...props }: any, ref: any) => (
    <a ref={ref} href={href} className={className} data-testid={`link-${href}`} {...props}>{children}</a>
  ))
})

// Mock UI components
jest.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: any) => <>{children}</>,
  TooltipContent: ({ children }: any) => <div>{children}</div>,
  TooltipProvider: ({ children }: any) => <>{children}</>,
  TooltipTrigger: React.forwardRef(({ children, asChild, ...props }: any, ref: any) => {
    if (asChild && React.isValidElement(children)) {
      return React.cloneElement(children as React.ReactElement<any>, { ref, ...props })
    }
    return <div ref={ref} {...props}>{children}</div>
  }),
}))

jest.mock('@/components/ui/popover', () => ({
  Popover: ({ children }: any) => <>{children}</>,
  PopoverContent: ({ children }: any) => <div>{children}</div>,
  PopoverTrigger: React.forwardRef(({ children, asChild, ...props }: any, ref: any) => {
    if (asChild && React.isValidElement(children)) {
      return React.cloneElement(children as React.ReactElement<any>, { ref, ...props })
    }
    return <div ref={ref} {...props}>{children}</div>
  }),
}))

jest.mock('@/components/theme-toggle', () => ({
  ThemeToggle: () => <div data-testid="theme-toggle" />,
}))

jest.mock('@/components/user-menu', () => ({
  UserMenu: () => <div data-testid="user-menu" />,
}))

jest.mock('@/components/settings-panel', () => ({
  SettingsPanel: () => <div data-testid="settings-panel" />,
}))

jest.mock('@/components/ui/button', () => ({
  Button: React.forwardRef(({ children, ...props }: any, ref: any) => (
    <button ref={ref} {...props}>{children}</button>
  )),
}))

jest.mock('@/lib/utils', () => ({
  cn: (...args: any[]) => args.filter(Boolean).join(' '),
}))

// ============================================================================
// Imports — after mocks
// ============================================================================

import { AppHeader } from '../AppHeader'

// ============================================================================
// Tests
// ============================================================================

describe('AppHeader — Insights tab', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockStorageMode = 'mongodb'
    mockPathname = '/chat'
    mockIsAdmin = false
    mockSession.status = 'authenticated' as const
    mockSession.data = { user: { name: 'Test User', email: 'test@test.com' } } as any
  })

  it('shows Insights tab when MongoDB is configured and user is authenticated', () => {
    render(<AppHeader />)

    expect(screen.getByText('Personal Insights')).toBeInTheDocument()
    expect(screen.getByTestId('link-/insights')).toBeInTheDocument()
  })

  it('does NOT show Insights tab when storageMode is not mongodb', () => {
    mockStorageMode = 'localStorage'

    render(<AppHeader />)

    expect(screen.queryByText('Personal Insights')).not.toBeInTheDocument()
  })

  it('does NOT show Insights tab when user is not authenticated', () => {
    mockSession.status = 'unauthenticated' as any
    mockSession.data = null as any

    render(<AppHeader />)

    expect(screen.queryByText('Personal Insights')).not.toBeInTheDocument()
  })

  it('applies active style when pathname starts with /insights', () => {
    mockPathname = '/insights'

    render(<AppHeader />)

    const insightsLink = screen.getByTestId('link-/insights')
    expect(insightsLink.className).toContain('bg-primary')
    expect(insightsLink.className).toContain('text-primary-foreground')
  })

  it('applies inactive style when on a different page', () => {
    mockPathname = '/chat'

    render(<AppHeader />)

    const insightsLink = screen.getByTestId('link-/insights')
    expect(insightsLink.className).toContain('text-muted-foreground')
  })

  it('always shows Agent Skills and Chat tabs', () => {
    render(<AppHeader />)

    expect(screen.getByText('Agent Skills')).toBeInTheDocument()
    // Chat tab uses emoji: 💬 Chat
    expect(screen.getByText(/Chat/)).toBeInTheDocument()
  })

  it('Admin tab visibility is independent of Insights tab', () => {
    mockIsAdmin = true

    render(<AppHeader />)

    // Both Insights and Admin should be visible
    expect(screen.getByText('Personal Insights')).toBeInTheDocument()
    expect(screen.getByText('Admin')).toBeInTheDocument()
  })
})
