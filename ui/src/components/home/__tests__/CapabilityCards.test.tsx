/**
 * Unit tests for CapabilityCards component
 *
 * Tests:
 * - Renders Chat, Skills, and Knowledge Bases cards when RAG is enabled
 * - Hides Knowledge Bases card when RAG is disabled
 * - Each card links to the correct route
 * - Each card renders title and description
 * - Renders data-testid for the container
 * - Renders individual card data-testids
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
  Zap: (props: any) => <svg data-testid="icon-zap" {...props} />,
  Database: (props: any) => <svg data-testid="icon-database" {...props} />,
  ArrowRight: (props: any) => <svg data-testid="icon-arrow-right" {...props} />,
}))

jest.mock('@/lib/utils', () => ({
  cn: (...args: any[]) => args.filter(Boolean).join(' '),
}))

// ============================================================================
// Imports — after mocks
// ============================================================================

import { CapabilityCards } from '../CapabilityCards'

// ============================================================================
// Tests
// ============================================================================

describe('CapabilityCards', () => {
  describe('with RAG enabled', () => {
    it('renders all 3 capability cards', () => {
      render(<CapabilityCards ragEnabled={true} />)
      expect(screen.getByTestId('capability-card-chat')).toBeInTheDocument()
      expect(screen.getByTestId('capability-card-skills')).toBeInTheDocument()
      expect(screen.getByTestId('capability-card-knowledge-bases')).toBeInTheDocument()
    })

    it('renders the container testid', () => {
      render(<CapabilityCards ragEnabled={true} />)
      expect(screen.getByTestId('capability-cards')).toBeInTheDocument()
    })

    it('Chat card links to /chat', () => {
      render(<CapabilityCards ragEnabled={true} />)
      expect(screen.getByTestId('capability-card-chat')).toHaveAttribute('href', '/chat')
    })

    it('Skills card links to /skills', () => {
      render(<CapabilityCards ragEnabled={true} />)
      expect(screen.getByTestId('capability-card-skills')).toHaveAttribute('href', '/skills')
    })

    it('Knowledge Bases card links to /knowledge-bases', () => {
      render(<CapabilityCards ragEnabled={true} />)
      expect(screen.getByTestId('capability-card-knowledge-bases')).toHaveAttribute('href', '/knowledge-bases')
    })

    it('renders Chat card title and description', () => {
      render(<CapabilityCards ragEnabled={true} />)
      expect(screen.getByText('Chat')).toBeInTheDocument()
      expect(screen.getByText(/Have natural conversations with AI agents/)).toBeInTheDocument()
    })

    it('renders Skills card title and description', () => {
      render(<CapabilityCards ragEnabled={true} />)
      expect(screen.getByText('Skills')).toBeInTheDocument()
      expect(screen.getByText(/Browse and run pre-built agent workflows/)).toBeInTheDocument()
    })

    it('renders Knowledge Bases card title and description', () => {
      render(<CapabilityCards ragEnabled={true} />)
      expect(screen.getByText('Knowledge Bases')).toBeInTheDocument()
      expect(screen.getByText(/Search and explore your organization's knowledge/)).toBeInTheDocument()
    })

    it('renders the section heading', () => {
      render(<CapabilityCards ragEnabled={true} />)
      expect(screen.getByText('Platform Capabilities')).toBeInTheDocument()
    })
  })

  describe('with RAG disabled', () => {
    it('renders only Chat and Skills cards', () => {
      render(<CapabilityCards ragEnabled={false} />)
      expect(screen.getByTestId('capability-card-chat')).toBeInTheDocument()
      expect(screen.getByTestId('capability-card-skills')).toBeInTheDocument()
      expect(screen.queryByTestId('capability-card-knowledge-bases')).not.toBeInTheDocument()
    })

    it('does not render Knowledge Bases text', () => {
      render(<CapabilityCards ragEnabled={false} />)
      expect(screen.queryByText('Knowledge Bases')).not.toBeInTheDocument()
    })
  })
})
