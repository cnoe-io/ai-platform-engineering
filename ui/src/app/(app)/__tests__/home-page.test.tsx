/**
 * Unit tests for the Home Page (app/(app)/page.tsx)
 *
 * The page itself is now a thin switcher between NewHomePage and
 * ClassicHomePage, keyed on the home-widgets-store's `experience` field.
 * Each layout has its own dedicated test file — here we only verify the
 * switch itself.
 *
 * Tests:
 * - AuthGuard: wraps page in AuthGuard
 * - Page structure: data-testid
 * - Calls home-widgets-store initialize() on mount
 * - Renders NewHomePage when experience is "new" (the default)
 * - Renders ClassicHomePage when experience is "classic"
 */

import React from 'react'
import { render, screen } from '@testing-library/react'

jest.mock('@/components/auth-guard', () => ({
  AuthGuard: ({ children }: unknown) => <div data-testid="auth-guard">{children}</div>,
}))

jest.mock('@/components/ui/scroll-area', () => ({
  ScrollArea: ({ children, ...props }: unknown) => (
    <div data-testid={props['data-testid'] || 'scroll-area'} {...props}>{children}</div>
  ),
}))

jest.mock('@/components/home/NewHomePage', () => ({
  NewHomePage: () => <div data-testid="new-home-page-stub" />,
}))

jest.mock('@/components/home/ClassicHomePage', () => ({
  ClassicHomePage: () => <div data-testid="classic-home-page-stub" />,
}))

const mockInitialize = jest.fn()
let mockExperience: 'new' | 'classic' = 'new'

jest.mock('@/store/home-widgets-store', () => ({
  useHomeWidgetsStore: (selector: (state: unknown) => unknown) =>
    selector({ experience: mockExperience, initialize: mockInitialize }),
}))

import HomePage from '../page'

describe('HomePage', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockExperience = 'new'
  })

  it('wraps the page in AuthGuard', () => {
    render(<HomePage />)
    expect(screen.getByTestId('auth-guard')).toBeInTheDocument()
  })

  it('renders with data-testid="home-page"', () => {
    render(<HomePage />)
    expect(screen.getByTestId('home-page')).toBeInTheDocument()
  })

  it('calls home-widgets-store initialize() on mount', () => {
    render(<HomePage />)
    expect(mockInitialize).toHaveBeenCalled()
  })

  it('renders NewHomePage when experience is "new"', () => {
    mockExperience = 'new'
    render(<HomePage />)
    expect(screen.getByTestId('new-home-page-stub')).toBeInTheDocument()
    expect(screen.queryByTestId('classic-home-page-stub')).not.toBeInTheDocument()
  })

  it('renders ClassicHomePage when experience is "classic"', () => {
    mockExperience = 'classic'
    render(<HomePage />)
    expect(screen.getByTestId('classic-home-page-stub')).toBeInTheDocument()
    expect(screen.queryByTestId('new-home-page-stub')).not.toBeInTheDocument()
  })
})
