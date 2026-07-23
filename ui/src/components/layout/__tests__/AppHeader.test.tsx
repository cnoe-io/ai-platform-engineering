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
 * - "connected"        → platform and RAG probes online (green)
 * - "checking"         → either service is checking (amber spinner)
 * - "rag-disconnected" → platform online, RAG offline (amber warning)
 * - "disconnected"     → platform offline (red), regardless of RAG
 */

import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'

// ============================================================================
// Mocks — must be before imports
// ============================================================================

const mockSession = {
  data: { user: { name: 'Test User', email: 'test@test.com' } } as unknown,
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
  ;(global as unknown).__mockContainerWidth = constrained ? 0 : 2000
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
let mockStreamingConversations = new Map<string, unknown>()
let mockUnviewedConversations = new Set<string>()
let mockInputRequiredConversations = new Set<string>()
jest.mock('@/store/chat-store', () => ({
  resolveChatNavigationPath: jest.fn(
    ({ activeConversationId }: { activeConversationId?: string | null }) =>
      activeConversationId ? `/chat/${activeConversationId}` : '/chat',
  ),
  useChatStore: jest.fn(() => ({
    isStreaming: mockStreamingConversations.size > 0,
    streamingConversations: mockStreamingConversations,
    unviewedConversations: mockUnviewedConversations,
    inputRequiredConversations: mockInputRequiredConversations,
    conversations: [],
    activeConversationId: null,
  })),
}))

// Mock Dynamic Agents runtime health — status is mutable per test
let mockStorageMode = 'mongodb'
let mockRuntimeStatus: 'connected' | 'disconnected' | 'checking' = 'connected'
jest.mock('@/hooks/use-agent-runtime-health', () => ({
  useAgentRuntimeHealth: () => ({
    status: mockRuntimeStatus,
    checkNow: jest.fn(),
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

let mockPlatformProbeStatus: 'healthy' | 'degraded' | 'down' | 'checking' = 'healthy'
type MockPlatformProbe = {
  id: string
  label: string
  group: 'runtime' | 'knowledge' | 'identity' | 'observability' | 'messaging'
  status: 'healthy' | 'degraded' | 'down' | 'disabled'
  required: boolean
  description: string
  detail: string
  latency_ms: number | null
}
let mockPlatformProbes: MockPlatformProbe[] = [
  {
    id: 'chat-runtime',
    label: 'Chat Runtime',
    group: 'runtime',
    status: 'healthy',
    required: true,
    description: 'Checks the runtime health endpoint used by the chat experience.',
    detail: 'Runtime reachable',
    latency_ms: 12,
  },
]
jest.mock('@/hooks/use-platform-health-probes', () => ({
  usePlatformHealthProbes: () => ({
    status: mockPlatformProbeStatus,
    capabilities: mockPlatformProbes,
    summary: {
      total: mockPlatformProbes.length,
      healthy: mockPlatformProbes.filter((p) => p.status === 'healthy').length,
      degraded: mockPlatformProbes.filter((p) => p.status === 'degraded').length,
      down: mockPlatformProbes.filter((p) => p.status === 'down').length,
      disabled: mockPlatformProbes.filter((p) => p.status === 'disabled').length,
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
  release: null as unknown,
  releaseMarkdown: null as unknown,
  skipUntilNextLogin: jest.fn(),
  dismissPermanently: jest.fn(),
  isLoading: false,
  isDismissing: false,
}
jest.mock('@/hooks/use-release-upgrade-prompt', () => ({
  useReleaseUpgradePrompt: () => mockReleasePrompt,
}))

let mockMigrationStatus = {
  status: null as unknown,
  isLoading: false,
}
jest.mock('@/hooks/use-migration-status', () => ({
  useMigrationStatus: () => mockMigrationStatus,
}))

let mockKeycloakHealth = {
  summary: null as unknown,
  isLoading: false,
}
jest.mock('@/hooks/use-keycloak-health-summary', () => ({
  useKeycloakHealthSummary: () => mockKeycloakHealth,
}))

jest.mock('@/components/release/ReleaseUpgradeDialog', () => ({
  ReleaseUpgradeDialog: ({ open, isAdmin, releaseVersion }: unknown) =>
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
    get storageMode() { return mockStorageMode },
    get ragEnabled() { return mockRagEnabled },
    get reportProblemEnabled() { return mockReportProblemEnabled },
  },
  getConfig: jest.fn((key: string) => {
    const configs: Record<string, unknown> = {
      appName: 'Test App',
      ssoEnabled: true,
      envBadge: '',
      get storageMode() { return mockStorageMode },
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
  const MockLink = React.forwardRef(({ children, href, className, ...props }: unknown, ref: unknown) => (
    <a ref={ref} href={href} className={className} data-testid={`link-${href}`} {...props}>{children}</a>
  ))
  MockLink.displayName = 'MockLink'
  return MockLink
})

// Mock UI components
jest.mock('@/components/ui/tooltip', () => {
  const TooltipTrigger = React.forwardRef(function MockTooltipTrigger(
    { children, asChild, ...props }: unknown,
    ref: unknown,
  ) {
    if (asChild && React.isValidElement(children)) {
      return children
    }
    return <div ref={ref} {...props}>{children}</div>
  })
  return {
    Tooltip: ({ children }: unknown) => <>{children}</>,
    TooltipContent: ({ children }: unknown) => <div>{children}</div>,
    TooltipProvider: ({ children }: unknown) => <>{children}</>,
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
  const Popover = ({ children, open, onOpenChange }: unknown) => {
    popoverOpenProps.push(Boolean(open))
    // eslint-disable-next-line react-hooks/globals
    lastPopoverState = { open: Boolean(open), onOpenChange }
    return <>{children}</>
  }
  const PopoverTrigger = React.forwardRef(function MockPopoverTrigger(
    { children, asChild, ...props }: unknown,
    ref: unknown,
  ) {
    const toggleOpen = () => {
      lastPopoverState.onOpenChange?.(!lastPopoverState.open)
    }
    if (asChild && React.isValidElement(children)) {
      const child = children as React.ReactElement<unknown>
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
  const PopoverContent = ({ children }: unknown) => <div>{children}</div>
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
  Button: React.forwardRef(function MockButton({ children, ...props }: unknown, ref: unknown) {
    return (
    <button ref={ref} {...props}>{children}</button>
    )
  }),
}))

jest.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
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
    mockReportProblemEnabled = false
    mockRuntimeStatus = 'connected'
    mockRagStatus = 'connected'
    setHeaderNavConstrained(false)
    mockStreamingConversations = new Map()
    mockUnviewedConversations = new Set()
    mockInputRequiredConversations = new Set()
    mockSession.status = 'authenticated' as const
    mockSession.data = { user: { name: 'Test User', email: 'test@test.com' } } as unknown
    mockReleasePrompt.open = false
    mockReleasePrompt.isAdmin = false
    mockReleasePrompt.releaseVersion = null
    mockReleasePrompt.release = null
    mockReleasePrompt.releaseMarkdown = null
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

    it('marks Home as the current page when pathname is /', () => {
      mockPathname = '/'
      render(<AppHeader />)
      const pill = getHomeNavPill()
      expect(pill).toHaveAttribute('aria-current', 'page')
    })

    it('does not mark Home as current on other paths', () => {
      mockPathname = '/chat'
      render(<AppHeader />)
      const pill = getHomeNavPill()
      expect(pill).not.toHaveAttribute('aria-current')
    })

  })

  describe('core tabs', () => {
    it('always shows Skills and Chat tabs', () => {
      render(<AppHeader />)
      expect(screen.getByText('Skills')).toBeInTheDocument()
      expect(screen.getByTestId('link-/chat')).toHaveTextContent('Chat')
    })

    it('collapses nav items into More dropdown and keeps right cluster intact on narrow widths', () => {
      setHeaderNavConstrained(true)
      mockStorageMode = 'mongodb'
      mockIsAdmin = true
      mockReportProblemEnabled = true

      render(<AppHeader />)

      // Nav items overflow into More
      const moreButton = screen.getByRole('button', {
        name: /more navigation; chat is current/i,
      })
      expect(moreButton).toHaveTextContent('More')
      // All items still accessible (inside the always-open popover mock)
      expect(screen.getByText('Home')).toBeInTheDocument()
      expect(screen.getByTestId('link-/chat')).toHaveTextContent('Chat')
      expect(screen.getByText('Skills')).toBeInTheDocument()
      expect(screen.getByTestId('link-/dynamic-agents')).toBeInTheDocument()
      expect(screen.getByTestId('link-/admin')).toBeInTheDocument()
      // Right cluster: status stays icon-only circle, Report a Problem keeps its label
      expect(screen.getByRole('button', { name: /system status: healthy/i })).toHaveClass('w-8')
      expect(screen.getByText('Report a Problem')).toBeInTheDocument()
      expect(screen.getByTestId('settings-panel')).toBeInTheDocument()
      expect(screen.getByTestId('user-menu')).toBeInTheDocument()
    })

    it('shows Skills as active on /skills', () => {
      mockPathname = '/skills'
      render(<AppHeader />)
      const link = screen.getByTestId('link-/skills')
      expect(link).toHaveAttribute('aria-current', 'page')
    })

    it('shows Chat as active on /chat', () => {
      mockPathname = '/chat'
      render(<AppHeader />)
      const link = screen.getByTestId('link-/chat')
      expect(link).toHaveAttribute('aria-current', 'page')
    })

    it('shows Knowledge Bases tab only when RAG is enabled', () => {
      mockRagEnabled = true
      const { rerender } = render(<AppHeader />)
      expect(screen.getByText('Knowledge Bases')).toBeInTheDocument()

      mockRagEnabled = false
      rerender(<AppHeader />)
      expect(screen.queryByText('Knowledge Bases')).not.toBeInTheDocument()
    })

    it('shows Agents in MongoDB mode even without AD group access', () => {
      mockCanAccessDynamicAgents = false
      mockStorageMode = 'mongodb'

      render(<AppHeader />)

      expect(screen.getByTestId('link-/dynamic-agents')).toBeInTheDocument()
      expect(screen.getByTestId('link-/dynamic-agents')).toHaveTextContent('Agents')
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

    it('marks Admin as current on a nested Admin route for an admin user', () => {
      mockIsAdmin = true
      mockPathname = '/admin/security/ai-review'
      mockStorageMode = 'mongodb'
      render(<AppHeader />)
      const link = screen.getByTestId('link-/admin')
      expect(link).toHaveAttribute('aria-current', 'page')
    })

    it('marks Admin as current on a nested Admin route for a read-only user', () => {
      mockIsAdmin = false
      mockPathname = '/admin/people/users'
      mockStorageMode = 'mongodb'
      render(<AppHeader />)
      const link = screen.getByTestId('link-/admin')
      expect(link).toHaveAttribute('aria-current', 'page')
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
    mockRuntimeStatus = 'connected'
    mockRagStatus = 'connected'
    mockPlatformProbeStatus = 'healthy'
    mockPlatformProbes = [
      {
        id: 'chat-runtime',
        label: 'Chat Runtime',
        group: 'runtime',
        status: 'healthy',
        required: true,
        description: 'Checks the runtime health endpoint used by the chat experience.',
        detail: 'Runtime reachable',
        latency_ms: 12,
      },
    ]
    mockStreamingConversations = new Map()
    mockUnviewedConversations = new Set()
    mockInputRequiredConversations = new Set()
    mockSession.status = 'authenticated' as const
    mockSession.data = { user: { name: 'Test User', email: 'test@test.com' } } as unknown
  })

  describe('green — Connected', () => {
    it('shows icon-only green button with correct popover content when all systems are up', () => {
      mockRuntimeStatus = 'connected'
      mockRagEnabled = true
      mockRagStatus = 'connected'
      render(<AppHeader />)

      const btn = screen.getByRole('button', { name: /system status: healthy/i })
      // Header button remains icon-only when healthy.
      expect(btn).toBeInTheDocument()
      expect(btn.className).toContain('green')
      expect(btn.className).toContain('w-8') // fixed-size circle, not pill
      expect(screen.getByText('System Status')).toBeInTheDocument()
      expect(screen.getByText('Platform')).toBeInTheDocument()
      expect(screen.getAllByText('Chat Runtime').length).toBeGreaterThan(0)
    })

    it('shows enabled messaging integrations in the health popover', () => {
      mockPlatformProbes = [
        ...mockPlatformProbes,
        {
          id: 'slack-integration',
          label: 'Slack',
          group: 'messaging',
          status: 'healthy',
          required: false,
          description: 'Checks Slack integration availability.',
          detail: 'Slack ready',
          latency_ms: 18,
        },
        {
          id: 'webex-integration',
          label: 'Webex',
          group: 'messaging',
          status: 'degraded',
          required: false,
          description: 'Checks Webex bot admin access and space discovery prerequisites.',
          detail: 'Webex integration token is not configured on the UI service; fetch failed',
          latency_ms: 15,
        },
      ]
      mockPlatformProbeStatus = 'degraded'

      render(<AppHeader />)

      expect(screen.getByRole('button', { name: /system status: degraded/i })).toBeInTheDocument()
      expect(screen.getAllByText('Slack').length).toBeGreaterThan(0)
      expect(screen.getAllByText('Webex').length).toBeGreaterThan(0)
      expect(screen.queryByText('Slack ready')).not.toBeInTheDocument()
      expect(screen.getByText('Webex integration token is not configured on the UI service; fetch failed')).toBeInTheDocument()
      const webexDetail = screen.getByRole('button', { name: /expand webex details/i })
      expect(webexDetail).toHaveAttribute('aria-expanded', 'false')
      expect(webexDetail).toHaveClass('overflow-hidden', 'text-ellipsis', 'whitespace-nowrap')
      fireEvent.click(webexDetail)
      expect(webexDetail).toHaveAttribute('aria-expanded', 'true')
      expect(webexDetail).toHaveClass('whitespace-normal', 'break-words')
      expect(webexDetail).not.toHaveClass('overflow-hidden')
    })

    it('links admins from the health popover to the Admin health tab', () => {
      mockIsAdmin = true
      mockRuntimeStatus = 'connected'
      render(<AppHeader />)

      const link = screen.getByRole('link', { name: /open admin health status/i })
      expect(link).toHaveAttribute('href', '/admin/operations/health')
      expect(mockRouterPush).not.toHaveBeenCalled()
    })

    it('keeps the same simplified health popover for non-admins', () => {
      mockIsAdmin = false
      mockRuntimeStatus = 'connected'
      render(<AppHeader />)

      expect(screen.queryByRole('button', { name: /full health report/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /open health dashboard/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('link', { name: /open admin health status/i })).not.toBeInTheDocument()
      expect(screen.getByText('System Status')).toBeInTheDocument()
      expect(screen.getAllByText('Chat Runtime').length).toBeGreaterThan(0)
    })
  })

  describe('amber — Checking', () => {
    // The button AND popover badge both render "Checking" when in checking state,
    // so we use getAllByText and confirm the status button specifically.
    it('shows "Checking" when the platform probe is in checking state', () => {
      mockRuntimeStatus = 'checking'
      render(<AppHeader />)
      const matches = screen.getAllByText('Checking')
      expect(matches.length).toBeGreaterThan(0)
    })

    it('shows "Checking" when RAG is enabled and in checking state', () => {
      mockRuntimeStatus = 'connected'
      mockRagEnabled = true
      mockRagStatus = 'checking'
      render(<AppHeader />)
      const matches = screen.getAllByText('Checking')
      expect(matches.length).toBeGreaterThan(0)
    })

    it('shows "Checking" when platform probes are still checking', () => {
      mockRuntimeStatus = 'connected'
      mockPlatformProbeStatus = 'checking'
      mockPlatformProbes = []
      render(<AppHeader />)
      const matches = screen.getAllByText('Checking')
      expect(matches.length).toBeGreaterThan(0)
    })

    it('Checking status button has amber styling', () => {
      mockRuntimeStatus = 'checking'
      render(<AppHeader />)
      // Find the status button (the one that is a <button> element)
      const statusButton = screen.getAllByText('Checking')
        .map(el => el.closest('button'))
        .find(Boolean)
      expect(statusButton?.className).toContain('amber')
    })

    it('platform checking takes priority over RAG connected', () => {
      mockRuntimeStatus = 'checking'
      mockRagEnabled = true
      mockRagStatus = 'connected'
      render(<AppHeader />)
      const matches = screen.getAllByText('Checking')
      expect(matches.length).toBeGreaterThan(0)
    })

    it('platform checking takes priority over RAG disconnected', () => {
      mockRuntimeStatus = 'checking'
      mockRagEnabled = true
      mockRagStatus = 'disconnected'
      render(<AppHeader />)
      // Still "Checking" — the platform probe takes priority.
      const matches = screen.getAllByText('Checking')
      expect(matches.length).toBeGreaterThan(0)
      expect(screen.queryByText('RAG Disconnected')).not.toBeInTheDocument()
      expect(screen.queryByText('Disconnected')).not.toBeInTheDocument()
    })
  })

  describe('amber — Degraded (platform up, RAG down)', () => {
    it('shows "Degraded" when the platform is online but RAG is offline', () => {
      mockRuntimeStatus = 'connected'
      mockRagEnabled = true
      mockRagStatus = 'disconnected'
      render(<AppHeader />)
      expect(screen.getByRole('button', { name: /system status: degraded/i })).toBeInTheDocument()
    })

    it('Degraded badge has amber styling, not red', () => {
      mockRuntimeStatus = 'connected'
      mockRagEnabled = true
      mockRagStatus = 'disconnected'
      render(<AppHeader />)
      const badge = screen.getByRole('button', { name: /system status: degraded/i })
      expect(badge?.className).toContain('amber')
      expect(badge?.className).not.toContain('red')
    })

    it('does NOT show "Disconnected" when only RAG is offline', () => {
      mockRuntimeStatus = 'connected'
      mockRagEnabled = true
      mockRagStatus = 'disconnected'
      render(<AppHeader />)
      expect(screen.queryByText('Disconnected')).not.toBeInTheDocument()
    })

    it('does NOT show "RAG Disconnected" when RAG is disabled (even if status is disconnected)', () => {
      mockRuntimeStatus = 'connected'
      mockRagEnabled = false
      mockRagStatus = 'disconnected'
      render(<AppHeader />)
      // RAG is not enabled, so its status is ignored → Healthy (icon-only, no label text)
      expect(screen.queryByText('RAG Disconnected')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: /system status: healthy/i })).toBeInTheDocument()
    })

    it('popover badge shows "Degraded" when runtime is up but RAG is down', () => {
      mockRuntimeStatus = 'connected'
      mockRagEnabled = true
      mockRagStatus = 'disconnected'
      render(<AppHeader />)
      expect(screen.getAllByText('Degraded').length).toBeGreaterThan(0)
    })
  })

  describe('red — Degraded (platform down)', () => {
    it('shows "Degraded" when the platform is offline', () => {
      mockRuntimeStatus = 'disconnected'
      render(<AppHeader />)
      expect(screen.getByRole('button', { name: /system status: degraded/i })).toBeInTheDocument()
    })

    it('shows "Degraded" when required platform capability is down', () => {
      mockRuntimeStatus = 'connected'
      mockPlatformProbeStatus = 'down'
      mockPlatformProbes = [
        {
          id: 'chat-runtime',
          label: 'Chat Runtime',
          group: 'runtime',
          status: 'down',
          required: true,
          description: 'Checks the runtime health endpoint used by the chat experience.',
          detail: 'HTTP 503',
          latency_ms: 20,
        },
      ]
      render(<AppHeader />)
      expect(screen.getByRole('button', { name: /system status: degraded/i })).toBeInTheDocument()
      expect(screen.getAllByText('Chat Runtime').length).toBeGreaterThan(0)
      expect(screen.getAllByText('Down').length).toBeGreaterThan(0)
    })

    it('Degraded badge has red styling for platform outages', () => {
      mockRuntimeStatus = 'disconnected'
      render(<AppHeader />)
      const badge = screen.getByRole('button', { name: /system status: degraded/i })
      expect(badge?.className).toContain('red')
      expect(badge?.className).not.toContain('amber')
    })

    it('shows "Degraded" (red) when the platform is offline even if RAG is online', () => {
      mockRuntimeStatus = 'disconnected'
      mockRagEnabled = true
      mockRagStatus = 'connected'
      render(<AppHeader />)
      expect(screen.getByRole('button', { name: /system status: degraded/i })).toBeInTheDocument()
      expect(screen.queryByText('RAG Disconnected')).not.toBeInTheDocument()
    })

    it('shows "Degraded" (red) when both the platform and RAG are offline', () => {
      mockRuntimeStatus = 'disconnected'
      mockRagEnabled = true
      mockRagStatus = 'disconnected'
      render(<AppHeader />)
      expect(screen.getByRole('button', { name: /system status: degraded/i })).toBeInTheDocument()
      expect(screen.queryByText('RAG Disconnected')).not.toBeInTheDocument()
    })

    it('popover badge shows "Degraded" when the platform is offline', () => {
      mockRuntimeStatus = 'disconnected'
      render(<AppHeader />)
      expect(screen.getAllByText('Degraded').length).toBeGreaterThan(0)
    })
  })

  describe('status priority ordering', () => {
    it('checking > disconnected: platform checking beats RAG disconnected', () => {
      mockRuntimeStatus = 'checking'
      mockRagEnabled = true
      mockRagStatus = 'disconnected'
      render(<AppHeader />)
      const matches = screen.getAllByText('Checking')
      expect(matches.length).toBeGreaterThan(0)
    })

    it('platform-disconnected > rag-disconnected: full outage beats partial', () => {
      mockRuntimeStatus = 'disconnected'
      mockRagEnabled = true
      mockRagStatus = 'disconnected'
      render(<AppHeader />)
      expect(screen.getByRole('button', { name: /system status: degraded/i })).toBeInTheDocument()
      expect(screen.queryByText('RAG Disconnected')).not.toBeInTheDocument()
    })

    it('rag-disconnected > connected: partial outage beats healthy', () => {
      mockRuntimeStatus = 'connected'
      mockRagEnabled = true
      mockRagStatus = 'disconnected'
      render(<AppHeader />)
      expect(screen.getByRole('button', { name: /system status: degraded/i })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /system status: healthy/i })).not.toBeInTheDocument()
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
    mockRuntimeStatus = 'connected'
    mockRagStatus = 'connected'
    mockStreamingConversations = new Map()
    mockUnviewedConversations = new Set()
    mockInputRequiredConversations = new Set()
    mockSession.status = 'authenticated' as const
    mockSession.data = { user: { name: 'Test User', email: 'test@test.com' } } as unknown
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

  // ---------------------------------------------------------------------------
  // Unified admin alerts popover — the pill is a popover trigger; clicking
  // it opens a list of every active alert with its own GuardedLink to the
  // relevant admin tab so users can choose exactly which one they want to fix.
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

    expect(screen.getByRole('button', { name: /system status: healthy/i })).toBeInTheDocument()
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

    expect(screen.getByRole('button', { name: /system status: healthy/i })).toBeInTheDocument()
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
    expect(mockRouterPush).toHaveBeenCalledWith('/admin/security/migrations')
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
    expect(mockRouterPush).toHaveBeenCalledWith('/admin/security/migrations')
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
    // own admin tab so lower-severity alerts remain visible and actionable.
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
    expect(mockRouterPush).toHaveBeenLastCalledWith('/admin/security/keycloak')
    fireEvent.click(versionRow!)
    expect(mockRouterPush).toHaveBeenLastCalledWith('/admin/security/migrations')
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
    expect(mockRouterPush).toHaveBeenCalledWith('/admin/security/keycloak')
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

    expect(mockRouterPush).toHaveBeenCalledWith('/admin/security/keycloak')
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
    mockRuntimeStatus = 'connected'
    mockRagStatus = 'connected'
    mockStreamingConversations = new Map()
    mockUnviewedConversations = new Set()
    mockInputRequiredConversations = new Set()
    mockSession.status = 'authenticated' as const
    mockSession.data = { user: { name: 'Test User', email: 'test@test.com' } } as unknown
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
