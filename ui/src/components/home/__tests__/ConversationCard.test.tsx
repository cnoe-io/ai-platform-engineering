/**
 * Unit tests for ConversationCard component
 *
 * Tests:
 * - Renders conversation title and relative timestamp
 * - Links to the correct chat URL
 * - Shows total messages count when provided
 * - Shows singular "message" when count is 1
 * - Shows shared badge with Users2 icon when isShared
 * - Shows "Shared by {name}" when sharedBy is provided
 * - Shows "Shared with {team}" when teamName is provided
 * - Shows generic "Shared" when isShared but no sharedBy/teamName
 * - Hides shared badge when isShared is false
 * - Shows "Untitled Conversation" when title is empty
 * - formatRelativeTime: "Just now", "Xm ago", "Xh ago", "Xd ago", date string
 */

import React from 'react'
import { render, screen } from '@testing-library/react'

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
  MessageSquare: (props: any) => <svg data-testid="icon-message-square" {...props} />,
  Users2: (props: any) => <svg data-testid="icon-users2" {...props} />,
  Clock: (props: any) => <svg data-testid="icon-clock" {...props} />,
}))

jest.mock('@/lib/utils', () => ({
  cn: (...args: any[]) => args.filter(Boolean).join(' '),
}))

// ============================================================================
// Imports — after mocks
// ============================================================================

import { ConversationCard, formatRelativeTime } from '../ConversationCard'

// ============================================================================
// Tests
// ============================================================================

describe('ConversationCard', () => {
  const baseProps = {
    id: 'conv-123',
    title: 'My Test Conversation',
    updatedAt: new Date().toISOString(),
  }

  it('renders the conversation title', () => {
    render(<ConversationCard {...baseProps} />)
    expect(screen.getByText('My Test Conversation')).toBeInTheDocument()
  })

  it('links to the correct chat URL', () => {
    render(<ConversationCard {...baseProps} />)
    const link = screen.getByTestId('conversation-card-conv-123')
    expect(link).toHaveAttribute('href', '/chat/conv-123')
  })

  it('renders "Untitled Conversation" when title is empty', () => {
    render(<ConversationCard {...baseProps} title="" />)
    expect(screen.getByText('Untitled Conversation')).toBeInTheDocument()
  })

  it('shows message count when totalMessages is provided', () => {
    render(<ConversationCard {...baseProps} totalMessages={5} />)
    expect(screen.getByText('5 messages')).toBeInTheDocument()
  })

  it('shows singular "message" when count is 1', () => {
    render(<ConversationCard {...baseProps} totalMessages={1} />)
    expect(screen.getByText('1 message')).toBeInTheDocument()
  })

  it('hides message count when totalMessages is 0', () => {
    render(<ConversationCard {...baseProps} totalMessages={0} />)
    expect(screen.queryByText(/message/)).not.toBeInTheDocument()
  })

  it('hides message count when totalMessages is not provided', () => {
    render(<ConversationCard {...baseProps} />)
    expect(screen.queryByText(/message/)).not.toBeInTheDocument()
  })

  it('shows shared badge when isShared is true', () => {
    render(<ConversationCard {...baseProps} isShared />)
    expect(screen.getByTestId('icon-users2')).toBeInTheDocument()
    expect(screen.getByText('Shared')).toBeInTheDocument()
  })

  it('shows "Shared by {name}" when sharedBy is provided', () => {
    render(<ConversationCard {...baseProps} isShared sharedBy="alice@test.com" />)
    expect(screen.getByText('Shared by alice@test.com')).toBeInTheDocument()
  })

  it('shows "Shared with {team}" when teamName is provided', () => {
    render(<ConversationCard {...baseProps} isShared teamName="SRE Team" />)
    expect(screen.getByText('Shared with SRE Team')).toBeInTheDocument()
  })

  it('prioritizes teamName over sharedBy', () => {
    render(
      <ConversationCard
        {...baseProps}
        isShared
        sharedBy="alice@test.com"
        teamName="SRE Team"
      />
    )
    expect(screen.getByText('Shared with SRE Team')).toBeInTheDocument()
    expect(screen.queryByText('Shared by alice@test.com')).not.toBeInTheDocument()
  })

  it('hides shared badge when isShared is false', () => {
    render(<ConversationCard {...baseProps} isShared={false} />)
    expect(screen.queryByTestId('icon-users2')).not.toBeInTheDocument()
  })

  it('renders the clock icon for timestamp', () => {
    render(<ConversationCard {...baseProps} />)
    expect(screen.getByTestId('icon-clock')).toBeInTheDocument()
  })

  it('renders the message square icon', () => {
    render(<ConversationCard {...baseProps} />)
    expect(screen.getByTestId('icon-message-square')).toBeInTheDocument()
  })
})

describe('formatRelativeTime', () => {
  it('returns "Just now" for times less than 1 minute ago', () => {
    const now = new Date()
    expect(formatRelativeTime(now)).toBe('Just now')
  })

  it('returns "Xm ago" for times less than 60 minutes ago', () => {
    const thirtyMinsAgo = new Date(Date.now() - 30 * 60000)
    expect(formatRelativeTime(thirtyMinsAgo)).toBe('30m ago')
  })

  it('returns "1m ago" for exactly 1 minute ago', () => {
    const oneMinAgo = new Date(Date.now() - 60000)
    expect(formatRelativeTime(oneMinAgo)).toBe('1m ago')
  })

  it('returns "Xh ago" for times less than 24 hours ago', () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 3600000)
    expect(formatRelativeTime(threeHoursAgo)).toBe('3h ago')
  })

  it('returns "Xd ago" for times less than 7 days ago', () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 86400000)
    expect(formatRelativeTime(twoDaysAgo)).toBe('2d ago')
  })

  it('returns locale date string for times 7+ days ago', () => {
    const tenDaysAgo = new Date(Date.now() - 10 * 86400000)
    const result = formatRelativeTime(tenDaysAgo)
    // Should be a date string, not "Xd ago"
    expect(result).not.toContain('d ago')
    expect(result).not.toBe('Just now')
  })

  it('accepts string dates', () => {
    const result = formatRelativeTime(new Date().toISOString())
    expect(result).toBe('Just now')
  })
})
