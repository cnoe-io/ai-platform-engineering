/**
 * Unit tests for AppHeader component
 *
 * Nav tab visibility:
 * - Personal Insights tab is NOT in the nav pills (moved to user menu)
 * - Skills and Chat tabs are always visible
 * - Knowledge Bases tab is visible when RAG is enabled
 * - Admin tab is visible for admin users, disabled without MongoDB
 * - Active tab styling based on pathname
 *
 * Connection status badge (getCombinedStatus):
 * - "connected"        → both supervisor & RAG online (green)
 * - "checking"         → either service is checking (amber spinner)
 * - "rag-disconnected" → supervisor online, RAG offline (amber warning)
 * - "disconnected"     → supervisor offline (red), regardless of RAG
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

// Mock CAIPE health hook — status and storageMode are mutable per test
let mockStorageMode = 'mongodb'
let mockCaipeStatus: 'connected' | 'disconnected' | 'checking' = 'connected'
jest.mock('@/hooks/use-caipe-health', () => ({
  useCAIPEHealth: () => ({
    status: mockCaipeStatus,
    url: 'http://localhost:8080',
    secondsUntilNextCheck: 30,
    agents: [],
    tags: [],
    mongoDBStatus: 'connected',
    storageMode: mockStorageMode,
  }),
}))

// Mock RAG health hook — status and enabled are mutable per test
let mockRagEnabled = false
let mockRagStatus: 'connected' | 'disconnected' | 'checking' = 'connected'
jest.mock('@/hooks/use-rag-health', () => ({
  useRAGHealth: () => ({
    status: mockRagStatus,
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
    mockCaipeStatus = 'connected'
    mockRagStatus = 'connected'
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
    it('always shows Skills and Chat tabs', () => {
      render(<AppHeader />)
      expect(screen.getByText('Skills')).toBeInTheDocument()
      expect(screen.getByText(/Chat/)).toBeInTheDocument()
    })

    it('shows Skills as active on /skills', () => {
      mockPathname = '/skills'
      render(<AppHeader />)
      const link = screen.getByTestId('link-/skills')
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

// ============================================================================
// Connection status badge tests
// ============================================================================

describe('AppHeader — connection status badge', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockStorageMode = 'mongodb'
    mockPathname = '/chat'
    mockIsAdmin = false
    mockRagEnabled = false
    mockCaipeStatus = 'connected'
    mockRagStatus = 'connected'
    mockSession.status = 'authenticated' as const
    mockSession.data = { user: { name: 'Test User', email: 'test@test.com' } } as any
  })

  describe('green — Connected', () => {
    it('shows "Connected" when supervisor is online and RAG is disabled', () => {
      mockCaipeStatus = 'connected'
      mockRagEnabled = false
      render(<AppHeader />)
      expect(screen.getByText('Connected')).toBeInTheDocument()
    })

    it('shows "Connected" when both supervisor and RAG are online', () => {
      mockCaipeStatus = 'connected'
      mockRagEnabled = true
      mockRagStatus = 'connected'
      render(<AppHeader />)
      expect(screen.getByText('Connected')).toBeInTheDocument()
    })

    it('Connected badge has green styling', () => {
      mockCaipeStatus = 'connected'
      mockRagEnabled = false
      render(<AppHeader />)
      const badge = screen.getByText('Connected').closest('button')
      expect(badge?.className).toContain('green')
    })

    it('popover header shows "All Systems Live" when connected', () => {
      mockCaipeStatus = 'connected'
      mockRagEnabled = true
      mockRagStatus = 'connected'
      render(<AppHeader />)
      expect(screen.getByText('All Systems Live')).toBeInTheDocument()
    })

    it('popover footer shows "All systems operational" when connected', () => {
      mockCaipeStatus = 'connected'
      mockRagEnabled = false
      render(<AppHeader />)
      expect(screen.getByText('All systems operational')).toBeInTheDocument()
    })
  })

  describe('amber — Checking', () => {
    // The button AND popover badge both render "Checking" when in checking state,
    // so we use getAllByText and confirm the status button specifically.
    it('shows "Checking" when supervisor is in checking state', () => {
      mockCaipeStatus = 'checking'
      render(<AppHeader />)
      const matches = screen.getAllByText('Checking')
      expect(matches.length).toBeGreaterThan(0)
    })

    it('shows "Checking" when RAG is enabled and in checking state', () => {
      mockCaipeStatus = 'connected'
      mockRagEnabled = true
      mockRagStatus = 'checking'
      render(<AppHeader />)
      const matches = screen.getAllByText('Checking')
      expect(matches.length).toBeGreaterThan(0)
    })

    it('Checking status button has amber styling', () => {
      mockCaipeStatus = 'checking'
      render(<AppHeader />)
      // Find the status button (the one that is a <button> element)
      const statusButton = screen.getAllByText('Checking')
        .map(el => el.closest('button'))
        .find(Boolean)
      expect(statusButton?.className).toContain('amber')
    })

    it('supervisor checking takes priority over RAG connected', () => {
      mockCaipeStatus = 'checking'
      mockRagEnabled = true
      mockRagStatus = 'connected'
      render(<AppHeader />)
      const matches = screen.getAllByText('Checking')
      expect(matches.length).toBeGreaterThan(0)
    })

    it('supervisor checking takes priority over RAG disconnected', () => {
      mockCaipeStatus = 'checking'
      mockRagEnabled = true
      mockRagStatus = 'disconnected'
      render(<AppHeader />)
      // Still "Checking" — supervisor check takes priority
      const matches = screen.getAllByText('Checking')
      expect(matches.length).toBeGreaterThan(0)
      expect(screen.queryByText('RAG Disconnected')).not.toBeInTheDocument()
      expect(screen.queryByText('Disconnected')).not.toBeInTheDocument()
    })
  })

  describe('amber — RAG Disconnected (supervisor up, RAG down)', () => {
    it('shows "RAG Disconnected" when supervisor is online but RAG is offline', () => {
      mockCaipeStatus = 'connected'
      mockRagEnabled = true
      mockRagStatus = 'disconnected'
      render(<AppHeader />)
      expect(screen.getByText('RAG Disconnected')).toBeInTheDocument()
    })

    it('RAG Disconnected badge has amber styling, not red', () => {
      mockCaipeStatus = 'connected'
      mockRagEnabled = true
      mockRagStatus = 'disconnected'
      render(<AppHeader />)
      const badge = screen.getByText('RAG Disconnected').closest('button')
      expect(badge?.className).toContain('amber')
      expect(badge?.className).not.toContain('red')
    })

    it('does NOT show "Disconnected" when only RAG is offline', () => {
      mockCaipeStatus = 'connected'
      mockRagEnabled = true
      mockRagStatus = 'disconnected'
      render(<AppHeader />)
      expect(screen.queryByText('Disconnected')).not.toBeInTheDocument()
    })

    it('does NOT show "RAG Disconnected" when RAG is disabled (even if status is disconnected)', () => {
      mockCaipeStatus = 'connected'
      mockRagEnabled = false
      mockRagStatus = 'disconnected'
      render(<AppHeader />)
      // RAG is not enabled, so its status is ignored → "Connected"
      expect(screen.queryByText('RAG Disconnected')).not.toBeInTheDocument()
      expect(screen.getByText('Connected')).toBeInTheDocument()
    })

    it('popover header shows "RAG Offline" when supervisor up but RAG down', () => {
      mockCaipeStatus = 'connected'
      mockRagEnabled = true
      mockRagStatus = 'disconnected'
      render(<AppHeader />)
      expect(screen.getByText('RAG Offline')).toBeInTheDocument()
    })

    it('popover footer shows "RAG server unavailable" when supervisor up but RAG down', () => {
      mockCaipeStatus = 'connected'
      mockRagEnabled = true
      mockRagStatus = 'disconnected'
      render(<AppHeader />)
      expect(screen.getByText('RAG server unavailable')).toBeInTheDocument()
    })

    it('does NOT show "Issues Detected" when only RAG is offline', () => {
      mockCaipeStatus = 'connected'
      mockRagEnabled = true
      mockRagStatus = 'disconnected'
      render(<AppHeader />)
      expect(screen.queryByText('Issues Detected')).not.toBeInTheDocument()
    })
  })

  describe('red — Disconnected (supervisor down)', () => {
    it('shows "Disconnected" when supervisor is offline', () => {
      mockCaipeStatus = 'disconnected'
      render(<AppHeader />)
      expect(screen.getByText('Disconnected')).toBeInTheDocument()
    })

    it('Disconnected badge has red styling', () => {
      mockCaipeStatus = 'disconnected'
      render(<AppHeader />)
      const badge = screen.getByText('Disconnected').closest('button')
      expect(badge?.className).toContain('red')
      expect(badge?.className).not.toContain('amber')
    })

    it('shows "Disconnected" (red) when supervisor is offline even if RAG is online', () => {
      mockCaipeStatus = 'disconnected'
      mockRagEnabled = true
      mockRagStatus = 'connected'
      render(<AppHeader />)
      expect(screen.getByText('Disconnected')).toBeInTheDocument()
      expect(screen.queryByText('RAG Disconnected')).not.toBeInTheDocument()
    })

    it('shows "Disconnected" (red) when both supervisor and RAG are offline', () => {
      mockCaipeStatus = 'disconnected'
      mockRagEnabled = true
      mockRagStatus = 'disconnected'
      render(<AppHeader />)
      expect(screen.getByText('Disconnected')).toBeInTheDocument()
      expect(screen.queryByText('RAG Disconnected')).not.toBeInTheDocument()
    })

    it('popover header shows "Issues Detected" when supervisor is offline', () => {
      mockCaipeStatus = 'disconnected'
      render(<AppHeader />)
      expect(screen.getByText('Issues Detected')).toBeInTheDocument()
    })

    it('popover footer shows "Check logs for details" when supervisor is offline', () => {
      mockCaipeStatus = 'disconnected'
      render(<AppHeader />)
      expect(screen.getByText('Check logs for details')).toBeInTheDocument()
    })
  })

  describe('status priority ordering', () => {
    it('checking > disconnected: supervisor checking beats RAG disconnected', () => {
      mockCaipeStatus = 'checking'
      mockRagEnabled = true
      mockRagStatus = 'disconnected'
      render(<AppHeader />)
      const matches = screen.getAllByText('Checking')
      expect(matches.length).toBeGreaterThan(0)
    })

    it('supervisor-disconnected > rag-disconnected: full outage beats partial', () => {
      mockCaipeStatus = 'disconnected'
      mockRagEnabled = true
      mockRagStatus = 'disconnected'
      render(<AppHeader />)
      expect(screen.getByText('Disconnected')).toBeInTheDocument()
      expect(screen.queryByText('RAG Disconnected')).not.toBeInTheDocument()
    })

    it('rag-disconnected > connected: partial outage beats healthy', () => {
      mockCaipeStatus = 'connected'
      mockRagEnabled = true
      mockRagStatus = 'disconnected'
      render(<AppHeader />)
      expect(screen.getByText('RAG Disconnected')).toBeInTheDocument()
      expect(screen.queryByText('Connected')).not.toBeInTheDocument()
    })
  })
})
