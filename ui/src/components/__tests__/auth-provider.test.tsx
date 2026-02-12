/**
 * Unit tests for AuthProvider component
 * Verifies SessionProvider receives correct refetch props for token refresh
 */

import React from 'react'
import { render } from '@testing-library/react'

jest.mock('next-auth/react', () => {
  const SessionProvider = jest.fn(({ children, ...props }: any) => {
    ;(SessionProvider as any).__lastProps = props
    return children
  })
  return { SessionProvider }
})

import { SessionProvider } from 'next-auth/react'
import { AuthProvider } from '../auth-provider'

test('passes refetchInterval and refetchOnWindowFocus to SessionProvider', () => {
  render(
    <AuthProvider>
      <div>child</div>
    </AuthProvider>
  )
  expect((SessionProvider as any).__lastProps.refetchInterval).toBe(240)
  expect((SessionProvider as any).__lastProps.refetchOnWindowFocus).toBe(true)
})
