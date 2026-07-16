/**
 * Unit tests for CapabilityCards component
 *
 * Tests:
 * - Renders Chat, Agents, Tools, Skills, Workflows, and Knowledge Bases cards when RAG is enabled
 * - Hides Knowledge Bases card when RAG is disabled
 * - Each card links to the correct route
 * - Each card renders title and description
 * - Renders data-testid for the container
 * - Renders individual card data-testids
 */

import React from 'react'
import { render, screen } from '@testing-library/react'

// assisted-by Codex Codex-sonnet-4-6

// ============================================================================
// Mocks
// ============================================================================

jest.mock('next/link', () => {
  // eslint-disable-next-line react/display-name
  return React.forwardRef(({ children, href, className, ...props }: unknown, ref: unknown) => (
    <a ref={ref} href={href} className={className} data-testid={props['data-testid'] || `link-${href}`} {...props}>
      {children}
    </a>
  ))
})

jest.mock('lucide-react', () => ({
  MessageSquare: (props: unknown) => <svg data-testid="icon-message-square" {...props} />,
  Bot: (props: unknown) => <svg data-testid="icon-bot" {...props} />,
  Server: (props: unknown) => <svg data-testid="icon-server" {...props} />,
  Zap: (props: unknown) => <svg data-testid="icon-zap" {...props} />,
  Workflow: (props: unknown) => <svg data-testid="icon-workflow" {...props} />,
  Database: (props: unknown) => <svg data-testid="icon-database" {...props} />,
  ArrowRight: (props: unknown) => <svg data-testid="icon-arrow-right" {...props} />,
}))

jest.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
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
    it('renders all 6 capability cards', () => {
      render(<CapabilityCards ragEnabled={true} />)
      expect(screen.getByTestId('capability-card-chat')).toBeInTheDocument()
      expect(screen.getByTestId('capability-card-agents')).toBeInTheDocument()
      expect(screen.getByTestId('capability-card-mcp-servers')).toBeInTheDocument()
      expect(screen.getByTestId('capability-card-skills')).toBeInTheDocument()
      expect(screen.getByTestId('capability-card-workflows')).toBeInTheDocument()
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

    it('Agents card links to /dynamic-agents', () => {
      render(<CapabilityCards ragEnabled={true} />)
      expect(screen.getByTestId('capability-card-agents')).toHaveAttribute('href', '/dynamic-agents')
    })

    it('Tools card links to the tools tab', () => {
      render(<CapabilityCards ragEnabled={true} />)
      expect(screen.getByTestId('capability-card-mcp-servers')).toHaveAttribute('href', '/dynamic-agents?tab=mcp-servers')
    })

    it('Workflows card links to /workflows', () => {
      render(<CapabilityCards ragEnabled={true} />)
      expect(screen.getByTestId('capability-card-workflows')).toHaveAttribute('href', '/workflows')
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

    it('renders Agents card title and description', () => {
      render(<CapabilityCards ragEnabled={true} />)
      expect(screen.getByText('Agents')).toBeInTheDocument()
      expect(screen.getByText(/Create and manage custom AI agents/)).toBeInTheDocument()
    })

    it('renders Tools card title and description', () => {
      render(<CapabilityCards ragEnabled={true} />)
      expect(screen.getByText('Tools')).toBeInTheDocument()
      expect(screen.getByText(/Connect agents to APIs/)).toBeInTheDocument()
    })

    it('renders Workflows card title and description', () => {
      render(<CapabilityCards ragEnabled={true} />)
      expect(screen.getByText('Workflows')).toBeInTheDocument()
      expect(screen.getByText(/Create and manage self-service workflows/)).toBeInTheDocument()
    })

    it('renders Knowledge Bases card title and description', () => {
      render(<CapabilityCards ragEnabled={true} />)
      expect(screen.getByText('Knowledge Bases')).toBeInTheDocument()
      expect(screen.getByText(/Search and explore your organization's knowledge/)).toBeInTheDocument()
    })

    it('renders the section heading', () => {
      render(<CapabilityCards ragEnabled={true} />)
      expect(screen.getByText('Start Here')).toBeInTheDocument()
    })
  })

  describe('with RAG disabled', () => {
    it('renders non-RAG cards but not Knowledge Bases', () => {
      render(<CapabilityCards ragEnabled={false} />)
      expect(screen.getByTestId('capability-card-chat')).toBeInTheDocument()
      expect(screen.getByTestId('capability-card-agents')).toBeInTheDocument()
      expect(screen.getByTestId('capability-card-mcp-servers')).toBeInTheDocument()
      expect(screen.getByTestId('capability-card-skills')).toBeInTheDocument()
      expect(screen.getByTestId('capability-card-workflows')).toBeInTheDocument()
      expect(screen.queryByTestId('capability-card-knowledge-bases')).not.toBeInTheDocument()
    })

    it('does not render Knowledge Bases text', () => {
      render(<CapabilityCards ragEnabled={false} />)
      expect(screen.queryByText('Knowledge Bases')).not.toBeInTheDocument()
    })
  })
})
