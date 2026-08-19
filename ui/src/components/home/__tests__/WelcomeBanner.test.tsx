/**
 * Unit tests for WelcomeBanner component
 *
 * Tests:
 * - Renders personalized greeting with user's first name (from useSession)
 * - Renders generic greeting when no session/name
 * - Uses "Good morning" before noon
 * - Uses "Good afternoon" between noon and 5pm
 * - Uses "Good evening" after 5pm
 * - Renders the data-testid for the banner
 * - Renders the tagline text
 */

import React from 'react'
import { render, screen } from '@testing-library/react'

// ============================================================================
// Mocks
// ============================================================================

jest.mock('lucide-react', () => ({
  Sparkles: (props: unknown) => <svg data-testid="icon-sparkles" {...props} />,
  Settings: (props: unknown) => <svg data-testid="icon-settings" {...props} />,
}))

jest.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}))

let mockSession: { data: { user?: { name?: string | null } } | null } = { data: null }
jest.mock('next-auth/react', () => ({
  useSession: () => mockSession,
}))

// ============================================================================
// Imports — after mocks
// ============================================================================

import { WelcomeBanner, getGreeting } from '../WelcomeBanner'

// ============================================================================
// Tests
// ============================================================================

describe('WelcomeBanner', () => {
  beforeEach(() => {
    mockSession = { data: null }
  })

  it('renders personalized greeting with first name', () => {
    mockSession = { data: { user: { name: 'Alice Johnson' } } }
    render(<WelcomeBanner />)
    expect(screen.getByText('Welcome back, Alice')).toBeInTheDocument()
  })

  it('renders personalized greeting for single name', () => {
    mockSession = { data: { user: { name: 'Bob' } } }
    render(<WelcomeBanner />)
    expect(screen.getByText('Welcome back, Bob')).toBeInTheDocument()
  })

  it('renders generic greeting when no session', () => {
    render(<WelcomeBanner />)
    expect(screen.getByText('Welcome to CAIPE')).toBeInTheDocument()
  })

  it('renders generic greeting when name is null', () => {
    mockSession = { data: { user: { name: null } } }
    render(<WelcomeBanner />)
    expect(screen.getByText('Welcome to CAIPE')).toBeInTheDocument()
  })

  it('renders the data-testid', () => {
    mockSession = { data: { user: { name: 'Test' } } }
    render(<WelcomeBanner />)
    expect(screen.getByTestId('welcome-banner')).toBeInTheDocument()
  })

  it('uses the breathing gradient without pointer-position overrides', () => {
    mockSession = { data: { user: { name: 'Test' } } }
    render(<WelcomeBanner />)
    const banner = screen.getByTestId('welcome-banner')
    expect(banner).toHaveClass('welcome-banner')
    expect(banner.style.getPropertyValue('--welcome-pointer-x')).toBe('')
    expect(banner.style.getPropertyValue('--welcome-pointer-y')).toBe('')
  })

  it('renders the sparkles icon', () => {
    render(<WelcomeBanner />)
    expect(screen.getByTestId('icon-sparkles')).toBeInTheDocument()
  })

  it('renders the tagline', () => {
    render(<WelcomeBanner />)
    expect(
      screen.getByText('What do you want to get done today?'),
    ).toBeInTheDocument()
  })

  it('renders preferences shortcut when callback provided', () => {
    const handler = jest.fn()
    mockSession = { data: { user: { name: 'Test' } } }
    render(<WelcomeBanner onOpenPreferences={handler} />)
    const btn = screen.getByTestId('preferences-shortcut')
    expect(btn).toBeInTheDocument()
    btn.click()
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('does not render preferences shortcut when no callback', () => {
    mockSession = { data: { user: { name: 'Test' } } }
    render(<WelcomeBanner />)
    expect(screen.queryByTestId('preferences-shortcut')).not.toBeInTheDocument()
  })

  it('renders a time-of-day greeting', () => {
    render(<WelcomeBanner />)
    const greetingEl = screen.getByTestId('welcome-banner')
    const text = greetingEl.textContent || ''
    expect(
      text.includes('Good morning') ||
      text.includes('Good afternoon') ||
      text.includes('Good evening')
    ).toBe(true)
  })
})

describe('getGreeting', () => {
  const originalDate = global.Date

  afterEach(() => {
    global.Date = originalDate
  })

  it('returns "Good morning" before noon', () => {
    jest.spyOn(global, 'Date').mockImplementation(
      () => ({ getHours: () => 9 }) as unknown
    )
    expect(getGreeting()).toBe('Good morning')
  })

  it('returns "Good afternoon" between noon and 5pm', () => {
    jest.spyOn(global, 'Date').mockImplementation(
      () => ({ getHours: () => 14 }) as unknown
    )
    expect(getGreeting()).toBe('Good afternoon')
  })

  it('returns "Good evening" after 5pm', () => {
    jest.spyOn(global, 'Date').mockImplementation(
      () => ({ getHours: () => 20 }) as unknown
    )
    expect(getGreeting()).toBe('Good evening')
  })

  it('returns "Good morning" at hour 0 (midnight)', () => {
    jest.spyOn(global, 'Date').mockImplementation(
      () => ({ getHours: () => 0 }) as unknown
    )
    expect(getGreeting()).toBe('Good morning')
  })

  it('returns "Good morning" at hour 11', () => {
    jest.spyOn(global, 'Date').mockImplementation(
      () => ({ getHours: () => 11 }) as unknown
    )
    expect(getGreeting()).toBe('Good morning')
  })

  it('returns "Good afternoon" at hour 12 (noon)', () => {
    jest.spyOn(global, 'Date').mockImplementation(
      () => ({ getHours: () => 12 }) as unknown
    )
    expect(getGreeting()).toBe('Good afternoon')
  })

  it('returns "Good afternoon" at hour 16', () => {
    jest.spyOn(global, 'Date').mockImplementation(
      () => ({ getHours: () => 16 }) as unknown
    )
    expect(getGreeting()).toBe('Good afternoon')
  })

  it('returns "Good evening" at hour 17', () => {
    jest.spyOn(global, 'Date').mockImplementation(
      () => ({ getHours: () => 17 }) as unknown
    )
    expect(getGreeting()).toBe('Good evening')
  })

  it('returns "Good evening" at hour 23', () => {
    jest.spyOn(global, 'Date').mockImplementation(
      () => ({ getHours: () => 23 }) as unknown
    )
    expect(getGreeting()).toBe('Good evening')
  })
})
