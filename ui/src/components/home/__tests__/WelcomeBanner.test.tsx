/**
 * Unit tests for WelcomeBanner component
 *
 * Tests:
 * - Renders personalized greeting with user's first name
 * - Renders generic greeting when no name provided
 * - Renders generic greeting when name is null
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
  Sparkles: (props: any) => <svg data-testid="icon-sparkles" {...props} />,
  Settings: (props: any) => <svg data-testid="icon-settings" {...props} />,
}))

jest.mock('@/lib/utils', () => ({
  cn: (...args: any[]) => args.filter(Boolean).join(' '),
}))

// ============================================================================
// Imports — after mocks
// ============================================================================

import { WelcomeBanner, getGreeting } from '../WelcomeBanner'

// ============================================================================
// Tests
// ============================================================================

describe('WelcomeBanner', () => {
  it('renders personalized greeting with first name', () => {
    render(<WelcomeBanner userName="Alice Johnson" />)
    expect(screen.getByText('Welcome back, Alice')).toBeInTheDocument()
  })

  it('renders personalized greeting for single name', () => {
    render(<WelcomeBanner userName="Bob" />)
    expect(screen.getByText('Welcome back, Bob')).toBeInTheDocument()
  })

  it('renders generic greeting when no name provided', () => {
    render(<WelcomeBanner />)
    expect(screen.getByText('Welcome to CAIPE')).toBeInTheDocument()
  })

  it('renders generic greeting when name is null', () => {
    render(<WelcomeBanner userName={null} />)
    expect(screen.getByText('Welcome to CAIPE')).toBeInTheDocument()
  })

  it('renders the data-testid', () => {
    render(<WelcomeBanner userName="Test" />)
    expect(screen.getByTestId('welcome-banner')).toBeInTheDocument()
  })

  it('renders the sparkles icon', () => {
    render(<WelcomeBanner />)
    expect(screen.getByTestId('icon-sparkles')).toBeInTheDocument()
  })

  it('renders the tagline', () => {
    render(<WelcomeBanner />)
    expect(screen.getByText('Your AI-powered platform engineering assistant')).toBeInTheDocument()
  })

  it('renders preferences shortcut when callback provided', () => {
    const handler = jest.fn()
    render(<WelcomeBanner userName="Test" onOpenPreferences={handler} />)
    const btn = screen.getByTestId('preferences-shortcut')
    expect(btn).toBeInTheDocument()
    btn.click()
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('does not render preferences shortcut when no callback', () => {
    render(<WelcomeBanner userName="Test" />)
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
      () => ({ getHours: () => 9 }) as any
    )
    expect(getGreeting()).toBe('Good morning')
  })

  it('returns "Good afternoon" between noon and 5pm', () => {
    jest.spyOn(global, 'Date').mockImplementation(
      () => ({ getHours: () => 14 }) as any
    )
    expect(getGreeting()).toBe('Good afternoon')
  })

  it('returns "Good evening" after 5pm', () => {
    jest.spyOn(global, 'Date').mockImplementation(
      () => ({ getHours: () => 20 }) as any
    )
    expect(getGreeting()).toBe('Good evening')
  })

  it('returns "Good morning" at hour 0 (midnight)', () => {
    jest.spyOn(global, 'Date').mockImplementation(
      () => ({ getHours: () => 0 }) as any
    )
    expect(getGreeting()).toBe('Good morning')
  })

  it('returns "Good morning" at hour 11', () => {
    jest.spyOn(global, 'Date').mockImplementation(
      () => ({ getHours: () => 11 }) as any
    )
    expect(getGreeting()).toBe('Good morning')
  })

  it('returns "Good afternoon" at hour 12 (noon)', () => {
    jest.spyOn(global, 'Date').mockImplementation(
      () => ({ getHours: () => 12 }) as any
    )
    expect(getGreeting()).toBe('Good afternoon')
  })

  it('returns "Good afternoon" at hour 16', () => {
    jest.spyOn(global, 'Date').mockImplementation(
      () => ({ getHours: () => 16 }) as any
    )
    expect(getGreeting()).toBe('Good afternoon')
  })

  it('returns "Good evening" at hour 17', () => {
    jest.spyOn(global, 'Date').mockImplementation(
      () => ({ getHours: () => 17 }) as any
    )
    expect(getGreeting()).toBe('Good evening')
  })

  it('returns "Good evening" at hour 23', () => {
    jest.spyOn(global, 'Date').mockImplementation(
      () => ({ getHours: () => 23 }) as any
    )
    expect(getGreeting()).toBe('Good evening')
  })
})
