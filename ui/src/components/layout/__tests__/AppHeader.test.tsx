/**
 * Unit tests for AppHeader component — nav tab visibility
 *
 * Tests:
 * - Personal Insights tab is NOT in the nav pills (moved to user menu)
 * - Agent Skills and Chat tabs are always visible
 * - Knowledge Bases tab is visible when RAG is enabled
 * - Admin tab is visible for admin users, disabled without MongoDB
 * - Active tab styling based on pathname
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
let mockRagEnabled = false
jest.mock('@/hooks/use-rag-health', () => ({
  useRAGHealth: () => ({
    status: 'connected',
    url: 'http://localhost:9090',
    enabled: mockRagEnabled,
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

// Mock config
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
    get ragEnabled() { return mockRagEnabled },
  },
  getConfig: jest.fn((key: string) => {
    const configs: Record<string, any> = {
      appName: 'Test App',
      ssoEnabled: true,
      previewMode: false,
      get ragEnabled() { return mockRagEnabled },
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

describe('AppHeader — nav tabs', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockStorageMode = 'mongodb'
    mockPathname = '/chat'
    mockIsAdmin = false
    mockRagEnabled = false
    mockSession.status = 'authenticated' as const
    mockSession.data = { user: { name: 'Test User', email: 'test@test.com' } } as any
  })

  describe('Insights tab removed from nav', () => {
    it('does NOT show Personal Insights in the nav pills even with MongoDB', () => {
      render(<AppHeader />)
      // Insights was moved to user menu — it should NOT be a tab
      const navLinks = screen.queryAllByTestId(/^link-/)
      const insightsLink = navLinks.find(el => el.getAttribute('href') === '/insights')
      expect(insightsLink).toBeUndefined()
    })

    it('does NOT show Personal Insights text in nav with authenticated user + mongodb', () => {
      render(<AppHeader />)
      // The text "Personal Insights" should NOT appear as a navigation tab
      // (UserMenu is mocked out, so it won't appear from there either)
      expect(screen.queryByTestId('link-/insights')).not.toBeInTheDocument()
    })
  })

  describe('core tabs', () => {
    it('always shows Agent Skills and Chat tabs', () => {
      render(<AppHeader />)
      expect(screen.getByText('Agent Skills')).toBeInTheDocument()
      expect(screen.getByText(/Chat/)).toBeInTheDocument()
    })

    it('shows Agent Skills as active on /agent-builder', () => {
      mockPathname = '/agent-builder'
      render(<AppHeader />)
      const link = screen.getByTestId('link-/agent-builder')
      expect(link.className).toContain('text-white')
    })

    it('shows Chat as active on /chat', () => {
      mockPathname = '/chat'
      render(<AppHeader />)
      const link = screen.getByTestId('link-/chat')
      expect(link.className).toContain('bg-primary')
    })

    it('shows Knowledge Bases tab when RAG is enabled', () => {
      mockRagEnabled = true
      render(<AppHeader />)
      expect(screen.getByText('Knowledge Bases')).toBeInTheDocument()
      expect(screen.getByTestId('link-/knowledge-bases')).toBeInTheDocument()
    })

    it('does NOT show Knowledge Bases when RAG is disabled', () => {
      mockRagEnabled = false
      render(<AppHeader />)
      expect(screen.queryByText('Knowledge Bases')).not.toBeInTheDocument()
    })
  })

  describe('admin tab', () => {
    it('shows Admin tab for admin users', () => {
      mockIsAdmin = true
      render(<AppHeader />)
      expect(screen.getByText('Admin')).toBeInTheDocument()
    })

    it('does NOT show Admin tab for non-admin users', () => {
      mockIsAdmin = false
      render(<AppHeader />)
      expect(screen.queryByTestId('link-/admin')).not.toBeInTheDocument()
    })

    it('Admin tab is clickable when MongoDB is configured', () => {
      mockIsAdmin = true
      mockStorageMode = 'mongodb'
      render(<AppHeader />)
      expect(screen.getByTestId('link-/admin')).toBeInTheDocument()
    })

    it('Admin tab is disabled when MongoDB is not configured', () => {
      mockIsAdmin = true
      mockStorageMode = 'localStorage'
      render(<AppHeader />)
      // Should show Admin text but NOT as a link
      expect(screen.getByText('Admin')).toBeInTheDocument()
      expect(screen.queryByTestId('link-/admin')).not.toBeInTheDocument()
    })
  })

  describe('right-side elements', () => {
    it('renders UserMenu', () => {
      render(<AppHeader />)
      expect(screen.getByTestId('user-menu')).toBeInTheDocument()
    })

    it('renders ThemeToggle', () => {
      render(<AppHeader />)
      expect(screen.getByTestId('theme-toggle')).toBeInTheDocument()
    })

    it('renders SettingsPanel', () => {
      render(<AppHeader />)
      expect(screen.getByTestId('settings-panel')).toBeInTheDocument()
    })
  })
})
