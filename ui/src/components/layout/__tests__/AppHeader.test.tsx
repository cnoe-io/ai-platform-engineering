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
import { render, screen, fireEvent } from '@testing-library/react'

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
// Shared spy so admin-alert popover tests can assert programmatic
// navigation. Reset in beforeEach.
const mockRouterPush = jest.fn()
jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({
    push: mockRouterPush,
    replace: jest.fn(),
    back: jest.fn(),
    forward: jest.fn(),
    refresh: jest.fn(),
    prefetch: jest.fn(),
  }),
}))

// Controls the simulated container width in the ResizeObserver mock (jest.setup.js).
// Pass true to simulate a narrow container (triggers nav overflow / More button).
// Pass false to restore the default wide container (all items visible).
function setHeaderNavConstrained(constrained: boolean) {
  ;(global as any).__mockContainerWidth = constrained ? 0 : 2000
}

// Mock admin role hook
let mockIsAdmin = false
let mockCanAccessDynamicAgents = false
jest.mock('@/hooks/use-admin-role', () => ({
  useAdminRole: () => ({
    isAdmin: mockIsAdmin,
    canAccessDynamicAgents: mockCanAccessDynamicAgents,
  }),
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

let mockPlatformProbeStatus: 'healthy' | 'down' | 'checking' = 'healthy'
type MockPlatformProbe = {
  id: string
  label: string
  status: 'healthy' | 'down'
  detail: string
  target: string
  latency_ms: number
}
let mockPlatformProbes: MockPlatformProbe[] = [
  {
    id: 'keycloak',
    label: 'Keycloak',
    status: 'healthy',
    detail: 'HTTP 200',
    target: 'http://keycloak:7080',
    latency_ms: 12,
  },
]
jest.mock('@/hooks/use-platform-health-probes', () => ({
  usePlatformHealthProbes: () => ({
    status: mockPlatformProbeStatus,
    probes: mockPlatformProbes,
    summary: {
      total: mockPlatformProbes.length,
      healthy: mockPlatformProbes.filter((p) => p.status === 'healthy').length,
      down: mockPlatformProbes.filter((p) => p.status === 'down').length,
    },
    secondsUntilNextCheck: 30,
    checkNow: jest.fn(),
  }),
}))

// Mock version hook
jest.mock('@/hooks/use-version', () => ({
  useVersion: () => ({
    versionInfo: { version: '1.0.0', buildDate: '2026-02-10', gitCommit: 'abc1234' },
  }),
}))

const mockReleasePrompt = {
  open: false,
  isAdmin: false,
  releaseVersion: null as string | null,
  announcementId: null as string | null,
  release: null as any,
  showMigrationCta: true,
  toastNotification: null as any,
  markToastShown: jest.fn(),
  openMigrationAssistant: jest.fn(),
  skipUntilNextLogin: jest.fn(),
  dismissPermanently: jest.fn(),
  isLoading: false,
  isDismissing: false,
}
jest.mock('@/hooks/use-release-upgrade-prompt', () => ({
  useReleaseUpgradePrompt: () => mockReleasePrompt,
}))

let mockMigrationStatus = {
  status: null as any,
  isLoading: false,
}
jest.mock('@/hooks/use-migration-status', () => ({
  useMigrationStatus: () => mockMigrationStatus,
}))

let mockKeycloakHealth = {
  summary: null as any,
  isLoading: false,
}
jest.mock('@/hooks/use-keycloak-health-summary', () => ({
  useKeycloakHealthSummary: () => mockKeycloakHealth,
}))

jest.mock('@/components/release/ReleaseUpgradeDialog', () => ({
  ReleaseUpgradeDialog: ({ open, isAdmin, releaseVersion }: any) =>
    open ? (
      <div data-testid="release-upgrade-dialog">
        ReleaseUpgradeDialog {releaseVersion} {isAdmin ? 'admin' : 'user'}
      </div>
    ) : null,
}))

const mockToast = jest.fn()
jest.mock('@/components/ui/toast', () => ({
  useToast: () => ({ toast: mockToast }),
}))

// Mock config
let mockReportProblemEnabled = false
let mockDynamicAgentsEnabled = true
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
    get dynamicAgentsEnabled() { return mockDynamicAgentsEnabled },
    get ragEnabled() { return mockRagEnabled },
    get reportProblemEnabled() { return mockReportProblemEnabled },
  },
  getConfig: jest.fn((key: string) => {
    const configs: Record<string, any> = {
      appName: 'Test App',
      ssoEnabled: true,
      envBadge: '',
      get dynamicAgentsEnabled() { return mockDynamicAgentsEnabled },
      get ragEnabled() { return mockRagEnabled },
      get reportProblemEnabled() { return mockReportProblemEnabled },
    }
    return configs[key]
  }),
  getLogoFilterClass: jest.fn(() => ''),
}))

jest.mock('@/components/ticket/ReportProblemDialog', () => ({
  ReportProblemDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="report-problem-dialog">ReportProblemDialog</div> : null,
}))

// Mock Link component
jest.mock('next/link', () => {
  const MockLink = React.forwardRef(({ children, href, className, ...props }: any, ref: any) => (
    <a ref={ref} href={href} className={className} data-testid={`link-${href}`} {...props}>{children}</a>
  ))
  MockLink.displayName = 'MockLink'
  return MockLink
})

// Mock UI components
jest.mock('@/components/ui/tooltip', () => {
  const TooltipTrigger = React.forwardRef(function MockTooltipTrigger(
    { children, asChild, ...props }: any,
    ref: any,
  ) {
    if (asChild && React.isValidElement(children)) {
      return children
    }
    return <div ref={ref} {...props}>{children}</div>
  })
  return {
    Tooltip: ({ children }: any) => <>{children}</>,
    TooltipContent: ({ children }: any) => <div>{children}</div>,
    TooltipProvider: ({ children }: any) => <>{children}</>,
    TooltipTrigger,
  }
})

// Popover mock that:
//   - Always renders PopoverContent so existing tests can scan for rows
//     without first clicking the trigger.
//   - Wires PopoverTrigger's onClick to call the most recently-seen
//     `onOpenChange` from <Popover>, so a focused regression test can
//     open the popover via a trigger click and then verify it closes
//     after a row click — the user-visible half of the "clicking the
//     alert doesn't do anything" bug.
//   - Records every value of the controlled `open` prop.
const popoverOpenProps: boolean[] = []
let lastPopoverState: {
  open: boolean
  onOpenChange?: (next: boolean) => void
} = { open: false }
jest.mock('@/components/ui/popover', () => {
  const Popover = ({ children, open, onOpenChange }: any) => {
    popoverOpenProps.push(Boolean(open))
    // eslint-disable-next-line react-hooks/globals
    lastPopoverState = { open: Boolean(open), onOpenChange }
    return <>{children}</>
  }
  const PopoverTrigger = React.forwardRef(function MockPopoverTrigger(
    { children, asChild, ...props }: any,
    ref: any,
  ) {
    const toggleOpen = () => {
      lastPopoverState.onOpenChange?.(!lastPopoverState.open)
    }
    if (asChild && React.isValidElement(children)) {
      const child = children as React.ReactElement<any>
      const originalClick = child.props.onClick
      const handleClick = (e: React.MouseEvent) => {
        originalClick?.(e)
        toggleOpen()
      }
      return React.cloneElement(child, { onClick: handleClick })
    }
    return (
      <div ref={ref} {...props} onClick={toggleOpen}>
        {children}
      </div>
    )
  })
  const PopoverContent = ({ children }: any) => <div>{children}</div>
  return {
    Popover,
    PopoverContent,
    PopoverTrigger,
  }
})

jest.mock('@/components/user-menu', () => ({
  UserMenu: () => (
    <div data-testid="user-menu" />
  ),
}))

jest.mock('@/components/settings-panel', () => ({
  SettingsPanel: () => (
    <div data-testid="settings-panel" />
  ),
}))

jest.mock('@/components/ui/button', () => ({
  Button: React.forwardRef(function MockButton({ children, ...props }: any, ref: any) {
    return (
    <button ref={ref} {...props}>{children}</button>
    )
  }),
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

beforeEach(() => {
  mockMigrationStatus = {
    status: null,
    isLoading: false,
  }
  mockKeycloakHealth = {
    summary: null,
    isLoading: false,
  }
  mockRouterPush.mockReset()
  popoverOpenProps.length = 0
  lastPopoverState = { open: false }
})

describe('AppHeader — nav tabs', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockStorageMode = 'mongodb'
    mockPathname = '/chat'
    mockIsAdmin = false
    mockCanAccessDynamicAgents = false
    mockRagEnabled = false
    mockDynamicAgentsEnabled = true
    mockReportProblemEnabled = false
    mockCaipeStatus = 'connected'
    mockRagStatus = 'connected'
    setHeaderNavConstrained(false)
    mockStreamingConversations = new Map()
    mockUnviewedConversations = new Set()
    mockInputRequiredConversations = new Set()
    mockSession.status = 'authenticated' as const
    mockSession.data = { user: { name: 'Test User', email: 'test@test.com' } } as any
    mockReleasePrompt.open = false
    mockReleasePrompt.isAdmin = false
    mockReleasePrompt.releaseVersion = null
    mockReleasePrompt.announcementId = null
    mockReleasePrompt.release = null
    mockReleasePrompt.showMigrationCta = true
    mockReleasePrompt.toastNotification = null
    mockReleasePrompt.markToastShown.mockClear()
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

  describe('Home tab', () => {
    function getHomeNavPill() {
      const homeLinks = screen.getAllByTestId('link-/')
      return homeLinks.find(el => el.textContent?.includes('Home'))!
    }

    it('shows Home tab', () => {
      render(<AppHeader />)
      expect(screen.getByText('Home')).toBeInTheDocument()
    })

    it('Home nav pill links to /', () => {
      render(<AppHeader />)
      const pill = getHomeNavPill()
      expect(pill).toBeDefined()
      expect(pill.getAttribute('href')).toBe('/')
    })

    it('Home has active styling when pathname is /', () => {
      mockPathname = '/'
      render(<AppHeader />)
      const pill = getHomeNavPill()
      expect(pill.className).toContain('text-white')
    })

    it('Home does not have active styling on other paths', () => {
      mockPathname = '/chat'
      render(<AppHeader />)
      const pill = getHomeNavPill()
      expect(pill.className).toContain('text-muted-foreground')
    })
  })

  describe('core tabs', () => {
    it('always shows Skills and Chat tabs', () => {
      render(<AppHeader />)
      expect(screen.getByText('Skills')).toBeInTheDocument()
      expect(screen.getByText(/Chat/)).toBeInTheDocument()
    })

    it('collapses nav items into More dropdown and keeps right cluster intact on narrow widths', () => {
      setHeaderNavConstrained(true)
      mockStorageMode = 'mongodb'
      mockDynamicAgentsEnabled = true
      mockIsAdmin = true
      mockReportProblemEnabled = true

      render(<AppHeader />)

      // Nav items overflow into More
      expect(screen.getByRole('button', { name: /more navigation/i })).toHaveTextContent('More')
      // All items still accessible (inside the always-open popover mock)
      expect(screen.getByText('Home')).toBeInTheDocument()
      expect(screen.getByText(/Chat/)).toBeInTheDocument()
      expect(screen.getByText('Skills')).toBeInTheDocument()
      expect(screen.getByTestId('link-/dynamic-agents')).toBeInTheDocument()
      expect(screen.getByTestId('link-/admin')).toBeInTheDocument()
      // Right cluster: status stays icon-only circle, Report a Problem keeps its label
      expect(screen.getByRole('button', { name: /system status: connected/i })).toHaveClass('w-8')
      expect(screen.getByText('Report a Problem')).toBeInTheDocument()
      expect(screen.getByTestId('settings-panel')).toBeInTheDocument()
      expect(screen.getByTestId('user-menu')).toBeInTheDocument()
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

    it('shows Knowledge Bases tab only when RAG is enabled', () => {
      mockRagEnabled = true
      const { rerender } = render(<AppHeader />)
      expect(screen.getByText('Knowledge Bases')).toBeInTheDocument()

      mockRagEnabled = false
      rerender(<AppHeader />)
      expect(screen.queryByText('Knowledge Bases')).not.toBeInTheDocument()
    })

    it('shows Agents when Dynamic Agents are enabled even without legacy AD group access', () => {
      mockCanAccessDynamicAgents = false
      mockStorageMode = 'mongodb'
      mockDynamicAgentsEnabled = true

      render(<AppHeader />)

      expect(screen.getByText('Agents')).toBeInTheDocument()
      expect(screen.getByTestId('link-/dynamic-agents')).toBeInTheDocument()
    })
  })

  describe('admin tab', () => {
    it('shows Admin tab for admin users', () => {
      mockIsAdmin = true
      render(<AppHeader />)
      expect(screen.getByText('Admin')).toBeInTheDocument()
    })

    it('shows Admin tab for non-admin authenticated users (readonly)', () => {
      mockIsAdmin = false
      render(<AppHeader />)
      expect(screen.getByText('Admin')).toBeInTheDocument()
    })

    it('does NOT show Admin tab for unauthenticated users', () => {
      mockIsAdmin = false
      mockSession.status = 'unauthenticated'
      mockSession.data = null
      render(<AppHeader />)
      expect(screen.queryByTestId('link-/admin')).not.toBeInTheDocument()
    })

    it('Admin tab is clickable when MongoDB is configured (admin user)', () => {
      mockIsAdmin = true
      mockStorageMode = 'mongodb'
      render(<AppHeader />)
      expect(screen.getByTestId('link-/admin')).toBeInTheDocument()
    })

    it('Admin tab is clickable when MongoDB is configured (non-admin user)', () => {
      mockIsAdmin = false
      mockStorageMode = 'mongodb'
      render(<AppHeader />)
      expect(screen.getByTestId('link-/admin')).toBeInTheDocument()
    })

    it('Admin tab is disabled when MongoDB is not configured', () => {
      mockIsAdmin = true
      mockStorageMode = 'localStorage'
      render(<AppHeader />)
      expect(screen.getByText('Admin')).toBeInTheDocument()
      expect(screen.queryByTestId('link-/admin')).not.toBeInTheDocument()
    })

    it('Admin tab shows red styling when active for admin user', () => {
      mockIsAdmin = true
      mockPathname = '/admin'
      mockStorageMode = 'mongodb'
      render(<AppHeader />)
      const link = screen.getByTestId('link-/admin')
      expect(link.className).toContain('bg-red-500')
    })

    it('Admin tab shows primary styling when active for non-admin user', () => {
      mockIsAdmin = false
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
    mockRagEnabled = false
    mockCaipeStatus = 'connected'
    mockRagStatus = 'connected'
    mockPlatformProbeStatus = 'healthy'
    mockPlatformProbes = [
      {
        id: 'keycloak',
        label: 'Keycloak',
        status: 'healthy',
        detail: 'HTTP 200',
        target: 'http://keycloak:7080',
        latency_ms: 12,
      },
    ]
    mockStreamingConversations = new Map()
    mockUnviewedConversations = new Set()
    mockInputRequiredConversations = new Set()
    mockSession.status = 'authenticated' as const
    mockSession.data = { user: { name: 'Test User', email: 'test@test.com' } } as any
  })

  describe('green — Connected', () => {
    it('shows icon-only green button with correct popover content when all systems are up', () => {
      mockCaipeStatus = 'connected'
      mockRagEnabled = true
      mockRagStatus = 'connected'
      render(<AppHeader />)

      const btn = screen.getByRole('button', { name: /system status: connected/i })
      // Icon-only: no visible "Connected" label text (AnimatePresence hides it)
      expect(btn).toBeInTheDocument()
      expect(btn.className).toContain('green')
      expect(btn.className).toContain('w-8') // fixed-size circle, not pill
      expect(screen.queryByText('Connected')).not.toBeInTheDocument()
      // Popover content reflects healthy state
      expect(screen.getByText('All Systems Live')).toBeInTheDocument()
      expect(screen.getByText('All systems operational')).toBeInTheDocument()
      expect(screen.getByText('Platform Probes')).toBeInTheDocument()
      expect(screen.getByText('Keycloak')).toBeInTheDocument()
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

    it('shows "Checking" when platform probes are still checking', () => {
      mockCaipeStatus = 'connected'
      mockPlatformProbeStatus = 'checking'
      mockPlatformProbes = []
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
      // RAG is not enabled, so its status is ignored → Connected (icon-only, no label text)
      expect(screen.queryByText('RAG Disconnected')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: /system status: connected/i })).toBeInTheDocument()
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

    it('shows "Disconnected" when a platform dependency probe is down', () => {
      mockCaipeStatus = 'connected'
      mockPlatformProbeStatus = 'down'
      mockPlatformProbes = [
        {
          id: 'openfga',
          label: 'OpenFGA',
          status: 'down',
          detail: 'HTTP 503',
          target: 'http://openfga:8080/healthz',
          latency_ms: 20,
        },
      ]
      render(<AppHeader />)
      expect(screen.getByText('Disconnected')).toBeInTheDocument()
      expect(screen.getByText('OpenFGA')).toBeInTheDocument()
      expect(screen.getByText('DOWN')).toBeInTheDocument()
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
      expect(screen.queryByRole('button', { name: /system status: connected/i })).not.toBeInTheDocument()
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

  it('mounts the release upgrade dialog for authenticated sessions', () => {
    mockReleasePrompt.open = true
    mockReleasePrompt.isAdmin = true
    mockReleasePrompt.releaseVersion = '0.5.1'

    render(<AppHeader />)

    expect(screen.getByTestId('release-upgrade-dialog')).toHaveTextContent('0.5.1 admin')
  })

  it('shows the managed release notes toast once when configured', () => {
    mockReleasePrompt.releaseVersion = '0.6.0'
    mockReleasePrompt.toastNotification = {
      id: '0.6.0:revision-2',
      message: 'Release notes for 0.6.0 are available.',
      duration: 12000,
    }

    render(<AppHeader />)

    expect(mockToast).toHaveBeenCalledWith(
      'Release notes for 0.6.0 are available.',
      'info',
      12000,
    )
    expect(mockReleasePrompt.markToastShown).toHaveBeenCalled()
  })

  // ---------------------------------------------------------------------------
  // Unified admin alerts popover — replaces both the four per-source chips
  // that used to crowd the header right cluster AND the earlier "single
  // deep-link to the highest-severity source" pill. The new pill is a
  // popover trigger; clicking it opens a list of every active alert with
  // its own GuardedLink to the relevant admin tab so users can choose
  // exactly which one they want to fix.
  // ---------------------------------------------------------------------------

  // The trigger is now a <button> (Popover trigger), not a link. We give
  // it a stable data-testid because GuardedLink doesn't forward IDs.
  const triggerSelector = 'header-admin-alerts-trigger'

  // Helper: scan the popover panel for an alert row. Each row is a
  // <button> with an accessible "open ... tab to fix" name and a stable
  // data-testid. We deliberately do NOT render rows as anchors anymore —
  // see the comment on `alertsPopoverOpen` in AppHeader.tsx for why
  // navigation is programmatic via router.push().
  function findAlertRow(label: string): HTMLElement | null {
    const rows = screen.queryAllByRole('button', { name: /open .* tab to fix/i })
    return rows.find((row) => (row.textContent ?? '').includes(label)) ?? null
  }

  it('hides the admin alerts pill from non-admin users even when migrations are blocking', () => {
    mockMigrationStatus = {
      isLoading: false,
      status: {
        release: '0.5.1',
        pending_required_count: 3,
        blocking_required_count: 2,
        is_blocking: true,
        override_active: false,
      },
    }

    render(<AppHeader />)

    expect(screen.getByRole('button', { name: /system status: connected/i })).toBeInTheDocument()
    expect(screen.queryByTestId(triggerSelector)).not.toBeInTheDocument()
  })

  it('shows the admin alerts pill for blocking migrations with red styling and a row that deep-links to the Migrations tab', () => {
    mockIsAdmin = true
    mockMigrationStatus = {
      isLoading: false,
      status: {
        release: '0.5.1',
        pending_required_count: 3,
        blocking_required_count: 2,
        is_blocking: true,
        override_active: false,
      },
    }

    render(<AppHeader />)

    expect(screen.getByRole('button', { name: /system status: connected/i })).toBeInTheDocument()
    const trigger = screen.getByTestId(triggerSelector)
    expect(trigger.tagName).toBe('BUTTON')
    expect(trigger.textContent ?? '').toContain('Alerts:')
    expect(trigger.textContent ?? '').toContain('2')
    // Blocking migrations are a red-severity source — the trigger inherits
    // the worst severity across visible sources.
    expect(trigger.className).toMatch(/text-red-500/)
    // The hover label is now a CTA ("Click to see the list..."), not a
    // single destination — confirm the breakdown is still embedded.
    expect(trigger.getAttribute('title') ?? '').toContain('Migrations required: 2')
    expect(trigger.getAttribute('title') ?? '').toMatch(/Click to see the list/i)

    // The popover panel (mocked to always render) should contain exactly
    // one row, linking to the migrations tab.
    const row = findAlertRow('Migrations required')
    expect(row).not.toBeNull()
    expect(row?.textContent ?? '').toContain('2')
    // Regression for "clicking the alert doesn't do anything": rows are
    // <button>s that programmatically push the route. Verify that the
    // click handler actually fires and targets the migrations tab.
    fireEvent.click(row!)
    expect(mockRouterPush).toHaveBeenCalledWith('/admin?cat=security&tab=migrations')
  })

  it('shows the admin alerts pill for version-metadata bootstrap (amber-severity)', () => {
    mockIsAdmin = true
    mockMigrationStatus = {
      isLoading: false,
      status: {
        release: '0.5.1',
        pending_required_count: 0,
        blocking_required_count: 0,
        is_blocking: false,
        override_active: false,
        needs_version_bootstrap: true,
        version_bootstrap_required_count: 2,
        requires_attention: true,
      },
    }

    render(<AppHeader />)

    const trigger = screen.getByTestId(triggerSelector)
    expect(trigger.textContent ?? '').toContain('2')
    expect(trigger.className).toMatch(/text-amber-500/)
    expect(trigger.getAttribute('title') ?? '').toContain('Version metadata needed: 2')

    const row = findAlertRow('Version metadata needed')
    expect(row).not.toBeNull()
    fireEvent.click(row!)
    expect(mockRouterPush).toHaveBeenCalledWith('/admin?cat=security&tab=migrations')
  })

  it('renders one popover row per active admin alert source and picks worst severity for the trigger', () => {
    mockIsAdmin = true
    mockMigrationStatus = {
      isLoading: false,
      status: {
        release: '0.5.1',
        pending_required_count: 0,
        blocking_required_count: 0,
        is_blocking: false,
        override_active: false,
        needs_version_bootstrap: true,
        version_bootstrap_required_count: 1,
        requires_attention: true,
      },
    }
    mockKeycloakHealth = {
      isLoading: false,
      summary: {
        configured: true,
        reachable: false,
        realm: 'caipe',
        invariants: null,
        has_issues: true,
        cached: false,
        fetched_at: '2026-05-24T13:00:00.000Z',
      },
    }

    render(<AppHeader />)

    const trigger = screen.getByTestId(triggerSelector)
    // Keycloak unreachable (red) + version metadata bootstrap (amber, 1) → total 2, red wins on the trigger.
    expect(trigger.textContent ?? '').toContain('2')
    expect(trigger.className).toMatch(/text-red-500/)
    const title = trigger.getAttribute('title') ?? ''
    expect(title).toContain('Keycloak realm caipe unreachable')
    expect(title).toContain('Version metadata needed: 1')

    // Both rows must be navigable from the popover, each linking to its
    // own admin tab. This is the regression fix for "clicking Alerts only
    // navigates to one place": previously, the version-metadata source
    // was silently suppressed in favor of the keycloak deep-link.
    const keycloakRow = findAlertRow('Keycloak realm caipe unreachable')
    expect(keycloakRow).not.toBeNull()
    expect(keycloakRow?.className ?? '').toMatch(/text-red-500/)

    const versionRow = findAlertRow('Version metadata needed')
    expect(versionRow).not.toBeNull()
    expect(versionRow?.className ?? '').toMatch(/text-amber-500/)

    // Each row navigates independently — clicking the keycloak row
    // must push the Keycloak tab and clicking the version row must
    // push the Migrations tab (no cross-talk).
    fireEvent.click(keycloakRow!)
    expect(mockRouterPush).toHaveBeenLastCalledWith('/admin?cat=security&tab=keycloak')
    fireEvent.click(versionRow!)
    expect(mockRouterPush).toHaveBeenLastCalledWith('/admin?cat=security&tab=migrations')
    expect(mockRouterPush).toHaveBeenCalledTimes(2)
  })

  it('labels Keycloak admin authorization errors without calling the realm unreachable', () => {
    mockIsAdmin = true
    mockKeycloakHealth = {
      isLoading: false,
      summary: {
        configured: true,
        reachable: true,
        status: 'admin_authorization_error',
        realm: 'caipe',
        invariants: null,
        has_issues: true,
        cached: false,
        fetched_at: '2026-05-24T13:00:00.000Z',
      },
    }

    render(<AppHeader />)

    const trigger = screen.getByTestId(triggerSelector)
    expect(trigger.textContent ?? '').toContain('1')
    const title = trigger.getAttribute('title') ?? ''
    expect(title).toContain('Keycloak admin API authorization failed')
    expect(title).not.toContain('unreachable')
    expect(findAlertRow('Keycloak admin API authorization failed')).not.toBeNull()
  })

  it('shows the admin alerts pill for failing Keycloak invariants with a row that deep-links to the Keycloak tab', () => {
    mockIsAdmin = true
    mockKeycloakHealth = {
      isLoading: false,
      summary: {
        configured: true,
        reachable: true,
        realm: 'caipe',
        invariants: {
          total: 18,
          passing: 14,
          failing: 4,
          unknown: 0,
          reconcile_now_recommended: true,
        },
        has_issues: true,
        cached: false,
        fetched_at: '2026-05-24T13:00:00.000Z',
      },
    }

    render(<AppHeader />)

    const trigger = screen.getByTestId(triggerSelector)
    expect(trigger.textContent ?? '').toContain('4')
    expect(trigger.className).toMatch(/text-amber-500/)
    expect(trigger.getAttribute('title') ?? '').toMatch(/Keycloak invariants? failing: 4/)

    const row = findAlertRow('Keycloak invariant')
    expect(row).not.toBeNull()
    expect(row?.textContent ?? '').toContain('4')
    fireEvent.click(row!)
    expect(mockRouterPush).toHaveBeenCalledWith('/admin?cat=security&tab=keycloak')
  })

  it('hides the admin alerts pill when no admin alert sources are active', () => {
    mockIsAdmin = true
    mockMigrationStatus = {
      isLoading: false,
      status: {
        release: '0.5.1',
        pending_required_count: 0,
        blocking_required_count: 0,
        is_blocking: false,
        override_active: false,
      },
    }
    mockKeycloakHealth = {
      isLoading: false,
      summary: {
        configured: true,
        reachable: true,
        realm: 'caipe',
        invariants: {
          total: 18,
          passing: 18,
          failing: 0,
          unknown: 0,
          reconcile_now_recommended: false,
        },
        has_issues: false,
        cached: false,
        fetched_at: '2026-05-24T13:00:00.000Z',
      },
    }

    render(<AppHeader />)

    expect(screen.queryByTestId(triggerSelector)).not.toBeInTheDocument()
    expect(screen.queryAllByRole('button', { name: /open .* tab to fix/i })).toHaveLength(0)
  })

  it('dismisses the alerts popover and pushes the route in a single click — regression for "clicking the alert doesn\'t do anything"', () => {
    // Reproduces the bug where rows were anchored `<a>` elements inside
    // a popover whose own outside-click listener unmounted the `<a>`
    // before the browser dispatched the click event — leaving the
    // user staring at an unchanged page. The fix: rows are buttons,
    // navigation is programmatic, and we close the popover *after*
    // pushing. This test pins both halves of that contract.
    mockIsAdmin = true
    mockKeycloakHealth = {
      isLoading: false,
      summary: {
        configured: true,
        reachable: true,
        realm: 'caipe',
        invariants: {
          total: 18,
          passing: 14,
          failing: 4,
          unknown: 0,
          reconcile_now_recommended: true,
        },
        has_issues: true,
        cached: false,
        fetched_at: '2026-05-24T13:00:00.000Z',
      },
    }

    render(<AppHeader />)

    // Open the popover via its controlled trigger so we can observe
    // a subsequent close transition. The mock's <PopoverTrigger> just
    // passes through, so we click the inner <button> which carries
    // the onClick that flips `alertsPopoverOpen` to true.
    const trigger = screen.getByTestId(triggerSelector)
    fireEvent.click(trigger)
    expect(popoverOpenProps).toContain(true)
    popoverOpenProps.length = 0 // discard the open transition

    const row = findAlertRow('Keycloak invariant')
    expect(row).not.toBeNull()
    fireEvent.click(row!)

    expect(mockRouterPush).toHaveBeenCalledWith('/admin?cat=security&tab=keycloak')
    // …AND AppHeader sets alertsPopoverOpen to false on the same
    // click, so the user lands on the destination tab without a
    // dangling floating layer.
    expect(popoverOpenProps).toContain(false)
  })

  it('hides the admin alerts pill for non-admin sessions even when Keycloak has_issues', () => {
    mockIsAdmin = false
    mockKeycloakHealth = {
      isLoading: false,
      summary: {
        configured: true,
        reachable: true,
        realm: 'caipe',
        invariants: {
          total: 18,
          passing: 14,
          failing: 4,
          unknown: 0,
          reconcile_now_recommended: true,
        },
        has_issues: true,
        cached: false,
        fetched_at: '2026-05-24T13:00:00.000Z',
      },
    }

    render(<AppHeader />)

    expect(screen.queryByTestId(triggerSelector)).not.toBeInTheDocument()
  })
})

// ============================================================================
// Report a Problem button
// ============================================================================

describe('AppHeader — Report a Problem button', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockStorageMode = 'mongodb'
    mockPathname = '/chat'
    mockIsAdmin = false
    mockRagEnabled = false
    mockReportProblemEnabled = false
    mockCaipeStatus = 'connected'
    mockRagStatus = 'connected'
    mockStreamingConversations = new Map()
    mockUnviewedConversations = new Set()
    mockInputRequiredConversations = new Set()
    mockSession.status = 'authenticated' as const
    mockSession.data = { user: { name: 'Test User', email: 'test@test.com' } } as any
  })

  it('does NOT show "Report a Problem" button when reportProblemEnabled is false', () => {
    mockReportProblemEnabled = false
    render(<AppHeader />)
    expect(screen.queryByText('Report a Problem')).not.toBeInTheDocument()
  })

  it('shows "Report a Problem" button when reportProblemEnabled is true', () => {
    mockReportProblemEnabled = true
    render(<AppHeader />)
    expect(screen.getByText('Report a Problem')).toBeInTheDocument()
  })

  it('opens ReportProblemDialog when "Report a Problem" is clicked', () => {
    mockReportProblemEnabled = true
    render(<AppHeader />)
    const btn = screen.getByText('Report a Problem')
    fireEvent.click(btn)
    expect(screen.getByTestId('report-problem-dialog')).toBeInTheDocument()
  })
})
