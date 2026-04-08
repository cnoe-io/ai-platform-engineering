/**
 * Unit tests for SharedConversations component
 *
 * Tests:
 * - Renders section heading
 * - Renders all three tabs (Shared with me, Team, Everyone)
 * - Default active tab is "Shared with me"
 * - Switching tabs shows the correct content
 * - Shows empty state for each tab when empty
 * - Each tab shows correct empty message
 * - Shows loading skeletons
 * - Renders conversation cards with shared badge
 * - Tab switching clears old content and shows new content
 */

import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'

// ============================================================================
// Mocks
// ============================================================================

jest.mock('next/link', () => {
  return React.forwardRef(({ children, href, className, ...props }: any, ref: any) => (
    <a ref={ref} href={href} className={className} data-testid={props['data-testid'] || `link-${href}`} {...props}>
      {children}
    </a>
  ))
})

jest.mock('lucide-react', () => ({
  Users2: (props: any) => <svg data-testid="icon-users2" {...props} />,
  Globe: (props: any) => <svg data-testid="icon-globe" {...props} />,
  Users: (props: any) => <svg data-testid="icon-users" {...props} />,
  MessageSquare: (props: any) => <svg data-testid="icon-message-square" {...props} />,
  Clock: (props: any) => <svg data-testid="icon-clock" {...props} />,
}))

jest.mock('@/lib/utils', () => ({
  cn: (...args: any[]) => args.filter(Boolean).join(' '),
  formatRelativeTimeCompact: (date: any) => 'Just now',
}))

// ============================================================================
// Imports — after mocks
// ============================================================================

import { SharedConversations } from '../SharedConversations'

// ============================================================================
// Helpers
// ============================================================================

function makeItems(prefix: string, count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}-${i}`,
    title: `${prefix} Chat ${i + 1}`,
    updatedAt: new Date().toISOString(),
    totalMessages: 5,
  }))
}

const defaultProps = {
  sharedWithMe: [],
  sharedWithTeam: [],
  sharedWithEveryone: [],
  loading: false,
}

// ============================================================================
// Tests
// ============================================================================

describe('SharedConversations', () => {
  it('renders the section heading', () => {
    render(<SharedConversations {...defaultProps} />)
    expect(screen.getByText('Shared Conversations')).toBeInTheDocument()
  })

  it('renders data-testid', () => {
    render(<SharedConversations {...defaultProps} />)
    expect(screen.getByTestId('shared-conversations')).toBeInTheDocument()
  })

  it('renders all three tabs', () => {
    render(<SharedConversations {...defaultProps} />)
    expect(screen.getByTestId('shared-tab-shared-with-me')).toBeInTheDocument()
    expect(screen.getByTestId('shared-tab-team')).toBeInTheDocument()
    expect(screen.getByTestId('shared-tab-everyone')).toBeInTheDocument()
  })

  it('renders tab labels', () => {
    render(<SharedConversations {...defaultProps} />)
    expect(screen.getByText('Shared with me')).toBeInTheDocument()
    expect(screen.getByText('Team')).toBeInTheDocument()
    expect(screen.getByText('Everyone')).toBeInTheDocument()
  })

  describe('loading state', () => {
    it('shows skeletons when loading', () => {
      render(<SharedConversations {...defaultProps} loading={true} />)
      const skeletons = screen.getAllByTestId('skeleton')
      expect(skeletons.length).toBe(3)
    })
  })

  describe('empty states', () => {
    it('shows "Shared with me" empty message by default', () => {
      render(<SharedConversations {...defaultProps} />)
      expect(screen.getByTestId('shared-empty')).toBeInTheDocument()
      expect(screen.getByText('No conversations shared with you yet.')).toBeInTheDocument()
    })

    it('shows "Team" empty message when Team tab is active', () => {
      render(<SharedConversations {...defaultProps} />)
      fireEvent.click(screen.getByTestId('shared-tab-team'))
      expect(screen.getByText('No team-shared conversations yet.')).toBeInTheDocument()
    })

    it('shows "Everyone" empty message when Everyone tab is active', () => {
      render(<SharedConversations {...defaultProps} />)
      fireEvent.click(screen.getByTestId('shared-tab-everyone'))
      expect(screen.getByText('No publicly shared conversations yet.')).toBeInTheDocument()
    })
  })

  describe('with data', () => {
    it('renders shared-with-me conversations by default', () => {
      render(
        <SharedConversations
          {...defaultProps}
          sharedWithMe={makeItems('me', 2)}
        />
      )
      expect(screen.getByText('me Chat 1')).toBeInTheDocument()
      expect(screen.getByText('me Chat 2')).toBeInTheDocument()
    })

    it('renders team conversations when Team tab is clicked', () => {
      render(
        <SharedConversations
          {...defaultProps}
          sharedWithMe={makeItems('me', 1)}
          sharedWithTeam={makeItems('team', 2)}
        />
      )
      fireEvent.click(screen.getByTestId('shared-tab-team'))
      expect(screen.getByText('team Chat 1')).toBeInTheDocument()
      expect(screen.getByText('team Chat 2')).toBeInTheDocument()
      expect(screen.queryByText('me Chat 1')).not.toBeInTheDocument()
    })

    it('renders public conversations when Everyone tab is clicked', () => {
      render(
        <SharedConversations
          {...defaultProps}
          sharedWithEveryone={makeItems('public', 3)}
        />
      )
      fireEvent.click(screen.getByTestId('shared-tab-everyone'))
      expect(screen.getByText('public Chat 1')).toBeInTheDocument()
      expect(screen.getByText('public Chat 2')).toBeInTheDocument()
      expect(screen.getByText('public Chat 3')).toBeInTheDocument()
    })

    it('switching tabs updates visible conversations', () => {
      render(
        <SharedConversations
          {...defaultProps}
          sharedWithMe={makeItems('me', 1)}
          sharedWithTeam={makeItems('team', 1)}
          sharedWithEveryone={makeItems('public', 1)}
        />
      )

      // Default: shared with me
      expect(screen.getByText('me Chat 1')).toBeInTheDocument()

      // Switch to team
      fireEvent.click(screen.getByTestId('shared-tab-team'))
      expect(screen.queryByText('me Chat 1')).not.toBeInTheDocument()
      expect(screen.getByText('team Chat 1')).toBeInTheDocument()

      // Switch to everyone
      fireEvent.click(screen.getByTestId('shared-tab-everyone'))
      expect(screen.queryByText('team Chat 1')).not.toBeInTheDocument()
      expect(screen.getByText('public Chat 1')).toBeInTheDocument()

      // Switch back to shared with me
      fireEvent.click(screen.getByTestId('shared-tab-shared-with-me'))
      expect(screen.getByText('me Chat 1')).toBeInTheDocument()
    })

    it('does not show empty state when items exist', () => {
      render(
        <SharedConversations
          {...defaultProps}
          sharedWithMe={makeItems('me', 1)}
        />
      )
      expect(screen.queryByTestId('shared-empty')).not.toBeInTheDocument()
    })
  })
})
