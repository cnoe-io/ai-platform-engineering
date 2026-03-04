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
let mockCanViewAdmin = false
jest.mock('@/hooks/use-admin-role', () => ({
  useAdminRole: () => ({ isAdmin: mockIsAdmin, canViewAdmin: mockCanViewAdmin }),
}))

// Mock chat store
let mockStreamingConversations = new Map<string, any>()
let mockUnviewedConversations = new Set<string>()
let mockInputRequiredConversations = new Set<string>()
jest.mock('@/store/chat-store', () => ({
  useChatStore: jest.fn(() => ({
    isStreaming: mockStreamingConversations.size > 0,
    streamingConversations: mockStreamingConversations,
    unviewedConversations: mockUnviewedConversations,
    inputRequiredConversations: mockInputRequiredConversations,
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
    envBadge: '',
    get ragEnabled() { return mockRagEnabled },
  },
  getConfig: jest.fn((key: string) => {
    const configs: Record<string, any> = {
      appName: 'Test App',
      ssoEnabled: true,
      envBadge: '',
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
    mockCanViewAdmin = false
    mockRagEnabled = false
    mockCaipeStatus = 'connected'
    mockRagStatus = 'connected'
    mockStreamingConversations = new Map()
    mockUnviewedConversations = new Set()
    mockInputRequiredConversations = new Set()
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
      mockCanViewAdmin = true
      render(<AppHeader />)
      expect(screen.getByText('Admin')).toBeInTheDocument()
    })

    it('shows Admin tab for non-admin authenticated users (readonly)', () => {
      mockIsAdmin = false
      mockCanViewAdmin = true
      render(<AppHeader />)
      expect(screen.getByText('Admin')).toBeInTheDocument()
    })

    it('does NOT show Admin tab for unauthenticated users', () => {
      mockIsAdmin = false
      mockCanViewAdmin = false
      render(<AppHeader />)
      expect(screen.queryByTestId('link-/admin')).not.toBeInTheDocument()
    })

    it('Admin tab is clickable when MongoDB is configured (admin user)', () => {
      mockIsAdmin = true
      mockCanViewAdmin = true
      mockStorageMode = 'mongodb'
      render(<AppHeader />)
      expect(screen.getByTestId('link-/admin')).toBeInTheDocument()
    })

    it('Admin tab is clickable when MongoDB is configured (non-admin user)', () => {
      mockIsAdmin = false
      mockCanViewAdmin = true
      mockStorageMode = 'mongodb'
      render(<AppHeader />)
      expect(screen.getByTestId('link-/admin')).toBeInTheDocument()
    })

    it('Admin tab is disabled when MongoDB is not configured', () => {
      mockIsAdmin = true
      mockCanViewAdmin = true
      mockStorageMode = 'localStorage'
      render(<AppHeader />)
      expect(screen.getByText('Admin')).toBeInTheDocument()
      expect(screen.queryByTestId('link-/admin')).not.toBeInTheDocument()
    })

    it('Admin tab shows red styling when active for admin user', () => {
      mockIsAdmin = true
      mockCanViewAdmin = true
      mockPathname = '/admin'
      mockStorageMode = 'mongodb'
      render(<AppHeader />)
      const link = screen.getByTestId('link-/admin')
      expect(link.className).toContain('bg-red-500')
    })

    it('Admin tab shows primary styling when active for non-admin user', () => {
      mockIsAdmin = false
      mockCanViewAdmin = true
      mockPathname = '/admin'
      mockStorageMode = 'mongodb'
      render(<AppHeader />)
      const link = screen.getByTestId('link-/admin')
      expect(link.className).toContain('bg-primary')
      expect(link.className).not.toContain('bg-red-500')
    })
  })

  describe('environment badge', () => {
    it('does NOT show an environment badge when envBadge is empty', () => {
      render(<AppHeader />)
      expect(screen.queryByText('Preview')).not.toBeInTheDocument()
      expect(screen.queryByText('Dev')).not.toBeInTheDocument()
      expect(screen.queryByText('Prod')).not.toBeInTheDocument()
    })
  })

  describe('right-side elements', () => {
    it('renders UserMenu', () => {
      render(<AppHeader />)
      expect(screen.getByTestId('user-menu')).toBeInTheDocument()
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
    mockCanViewAdmin = false
    mockRagEnabled = false
    mockCaipeStatus = 'connected'
    mockRagStatus = 'connected'
    mockStreamingConversations = new Map()
    mockUnviewedConversations = new Set()
    mockInputRequiredConversations = new Set()
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

// ============================================================================
// Chat tab notification dot tests
// ============================================================================

describe('AppHeader — Chat tab notification dots', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockStorageMode = 'mongodb'
    mockPathname = '/skills'
    mockIsAdmin = false
    mockCanViewAdmin = false
    mockRagEnabled = false
    mockCaipeStatus = 'connected'
    mockRagStatus = 'connected'
    mockStreamingConversations = new Map()
    mockUnviewedConversations = new Set()
    mockInputRequiredConversations = new Set()
    mockSession.status = 'authenticated' as const
    mockSession.data = { user: { name: 'Test User', email: 'test@test.com' } } as any
  })

  it('shows green badge with count on Chat tab when conversations are streaming', () => {
    mockStreamingConversations = new Map([
      ['conv-1', { conversationId: 'conv-1', messageId: 'msg-1', client: {} }],
    ])

    render(<AppHeader />)

    const chatLink = screen.getByTestId('link-/chat')
    const pingDot = chatLink.querySelector('.animate-ping')
    expect(pingDot).toBeInTheDocument()
    expect(pingDot?.className).toContain('bg-emerald-400')

    const badge = chatLink.querySelector('.bg-emerald-500')
    expect(badge).toBeInTheDocument()
    expect(badge?.textContent).toBe('1')
  })

  it('shows green badge with correct count for multiple streaming conversations', () => {
    mockStreamingConversations = new Map([
      ['conv-1', { conversationId: 'conv-1', messageId: 'msg-1', client: {} }],
      ['conv-2', { conversationId: 'conv-2', messageId: 'msg-2', client: {} }],
    ])

    render(<AppHeader />)

    const chatLink = screen.getByTestId('link-/chat')
    const badge = chatLink.querySelector('.bg-emerald-500')
    expect(badge?.textContent).toBe('2')
  })

  it('shows blue badge with count on Chat tab when there are unviewed conversations', () => {
    mockUnviewedConversations = new Set(['conv-1'])

    render(<AppHeader />)

    const chatLink = screen.getByTestId('link-/chat')
    const blueBadge = chatLink.querySelector('.bg-blue-500')
    expect(blueBadge).toBeInTheDocument()
    expect(blueBadge?.textContent).toBe('1')
  })

  it('shows blue badge with correct count for multiple unviewed conversations', () => {
    mockUnviewedConversations = new Set(['conv-1', 'conv-2', 'conv-3'])

    render(<AppHeader />)

    const chatLink = screen.getByTestId('link-/chat')
    const blueBadge = chatLink.querySelector('.bg-blue-500')
    expect(blueBadge?.textContent).toBe('3')
  })

  it('green badge takes priority over blue badge when both streaming and unviewed exist', () => {
    mockStreamingConversations = new Map([
      ['conv-1', { conversationId: 'conv-1', messageId: 'msg-1', client: {} }],
    ])
    mockUnviewedConversations = new Set(['conv-2'])

    render(<AppHeader />)

    const chatLink = screen.getByTestId('link-/chat')
    const greenBadge = chatLink.querySelector('.bg-emerald-500')
    const blueBadge = chatLink.querySelector('.bg-blue-500')
    expect(greenBadge).toBeInTheDocument()
    expect(blueBadge).not.toBeInTheDocument()
  })

  it('shows amber badge with count on Chat tab when conversations need input', () => {
    mockInputRequiredConversations = new Set(['conv-1'])

    render(<AppHeader />)

    const chatLink = screen.getByTestId('link-/chat')
    const amberBadge = chatLink.querySelector('.bg-amber-500')
    expect(amberBadge).toBeInTheDocument()
    expect(amberBadge?.textContent).toBe('1')
  })

  it('shows amber badge with correct count for multiple input-required conversations', () => {
    mockInputRequiredConversations = new Set(['conv-1', 'conv-2'])

    render(<AppHeader />)

    const chatLink = screen.getByTestId('link-/chat')
    const amberBadge = chatLink.querySelector('.bg-amber-500')
    expect(amberBadge?.textContent).toBe('2')
  })

  it('green badge takes priority over amber badge', () => {
    mockStreamingConversations = new Map([
      ['conv-1', { conversationId: 'conv-1', messageId: 'msg-1', client: {} }],
    ])
    mockInputRequiredConversations = new Set(['conv-2'])

    render(<AppHeader />)

    const chatLink = screen.getByTestId('link-/chat')
    expect(chatLink.querySelector('.bg-emerald-500')).toBeInTheDocument()
    expect(chatLink.querySelector('.bg-amber-500')).not.toBeInTheDocument()
  })

  it('amber badge takes priority over blue badge', () => {
    mockInputRequiredConversations = new Set(['conv-1'])
    mockUnviewedConversations = new Set(['conv-2'])

    render(<AppHeader />)

    const chatLink = screen.getByTestId('link-/chat')
    expect(chatLink.querySelector('.bg-amber-500')).toBeInTheDocument()
    expect(chatLink.querySelector('.bg-blue-500')).not.toBeInTheDocument()
  })

  it('shows no notification badge when nothing is streaming, input-required, or unviewed', () => {
    render(<AppHeader />)

    const chatLink = screen.getByTestId('link-/chat')
    const greenBadge = chatLink.querySelector('.bg-emerald-500')
    const amberBadge = chatLink.querySelector('.bg-amber-500')
    const blueBadge = chatLink.querySelector('.bg-blue-500')
    expect(greenBadge).not.toBeInTheDocument()
    expect(amberBadge).not.toBeInTheDocument()
    expect(blueBadge).not.toBeInTheDocument()
  })
})
