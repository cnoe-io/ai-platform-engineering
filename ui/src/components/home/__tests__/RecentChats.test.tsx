/**
 * Unit tests for RecentChats component
 *
 * Tests:
 * - Renders conversation cards when conversations exist
 * - Limits displayed conversations to maxItems
 * - Shows loading skeletons when loading
 * - Shows empty state when no conversations
 * - Empty state has "Start a new chat" link
 * - Shows "New Chat" link in header
 * - Renders data-testid for the section
 * - Defaults maxItems to 6
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
  Plus: (props: any) => <svg data-testid="icon-plus" {...props} />,
  Users2: (props: any) => <svg data-testid="icon-users2" {...props} />,
  Clock: (props: any) => <svg data-testid="icon-clock" {...props} />,
}))

jest.mock('@/lib/utils', () => ({
  cn: (...args: any[]) => args.filter(Boolean).join(' '),
}))

// ============================================================================
// Imports — after mocks
// ============================================================================

import { RecentChats } from '../RecentChats'

// ============================================================================
// Helpers
// ============================================================================

function makeConversations(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `conv-${i}`,
    title: `Conversation ${i + 1}`,
    updatedAt: new Date(Date.now() - i * 3600000).toISOString(),
    totalMessages: (i + 1) * 3,
  }))
}

// ============================================================================
// Tests
// ============================================================================

describe('RecentChats', () => {
  it('renders the section heading', () => {
    render(<RecentChats conversations={[]} loading={false} />)
    expect(screen.getByText('Recent Chats')).toBeInTheDocument()
  })

  it('renders data-testid', () => {
    render(<RecentChats conversations={[]} loading={false} />)
    expect(screen.getByTestId('recent-chats')).toBeInTheDocument()
  })

  it('renders the "New Chat" link', () => {
    render(<RecentChats conversations={[]} loading={false} />)
    expect(screen.getByTestId('new-chat-link')).toBeInTheDocument()
    expect(screen.getByTestId('new-chat-link')).toHaveAttribute('href', '/chat')
  })

  describe('loading state', () => {
    it('shows skeleton loaders when loading', () => {
      render(<RecentChats conversations={[]} loading={true} />)
      const skeletons = screen.getAllByTestId('skeleton')
      expect(skeletons.length).toBe(3)
    })

    it('does not render conversation cards when loading', () => {
      render(<RecentChats conversations={makeConversations(3)} loading={true} />)
      expect(screen.queryByText('Conversation 1')).not.toBeInTheDocument()
    })
  })

  describe('empty state', () => {
    it('shows empty state message when no conversations', () => {
      render(<RecentChats conversations={[]} loading={false} />)
      expect(screen.getByTestId('recent-chats-empty')).toBeInTheDocument()
      expect(screen.getByText('No conversations yet')).toBeInTheDocument()
    })

    it('has a "Start a new chat" link in empty state', () => {
      render(<RecentChats conversations={[]} loading={false} />)
      expect(screen.getByText('Start a new chat')).toBeInTheDocument()
    })
  })

  describe('with conversations', () => {
    it('renders conversation cards', () => {
      render(<RecentChats conversations={makeConversations(3)} loading={false} />)
      expect(screen.getByText('Conversation 1')).toBeInTheDocument()
      expect(screen.getByText('Conversation 2')).toBeInTheDocument()
      expect(screen.getByText('Conversation 3')).toBeInTheDocument()
    })

    it('limits to maxItems (default 6)', () => {
      render(<RecentChats conversations={makeConversations(10)} loading={false} />)
      expect(screen.getByText('Conversation 1')).toBeInTheDocument()
      expect(screen.getByText('Conversation 6')).toBeInTheDocument()
      expect(screen.queryByText('Conversation 7')).not.toBeInTheDocument()
    })

    it('respects custom maxItems', () => {
      render(<RecentChats conversations={makeConversations(10)} loading={false} maxItems={2} />)
      expect(screen.getByText('Conversation 1')).toBeInTheDocument()
      expect(screen.getByText('Conversation 2')).toBeInTheDocument()
      expect(screen.queryByText('Conversation 3')).not.toBeInTheDocument()
    })

    it('renders fewer cards if conversations < maxItems', () => {
      render(<RecentChats conversations={makeConversations(2)} loading={false} maxItems={6} />)
      expect(screen.getByText('Conversation 1')).toBeInTheDocument()
      expect(screen.getByText('Conversation 2')).toBeInTheDocument()
    })

    it('does not show empty state when conversations exist', () => {
      render(<RecentChats conversations={makeConversations(1)} loading={false} />)
      expect(screen.queryByTestId('recent-chats-empty')).not.toBeInTheDocument()
    })
  })
})
