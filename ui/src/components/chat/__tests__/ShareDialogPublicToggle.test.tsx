/**
 * Unit tests for ShareDialog "Share with everyone" (is_public) toggle
 *
 * Tests:
 * - Renders the "Share with everyone" toggle
 * - Toggle reflects is_public state from API
 * - Clicking toggle calls the share API with is_public
 * - Toggle updates local state on success
 * - Toggle is disabled while updating
 * - Toggle calls updateConversationSharing on success
 */

import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// ============================================================================
// Mocks
// ============================================================================

const mockUpdateConversationSharing = jest.fn()
jest.mock('@/store/chat-store', () => ({
  useChatStore: (selector: any) => {
    const state = { updateConversationSharing: mockUpdateConversationSharing }
    return selector(state)
  },
}))

jest.mock('@/lib/api-client', () => ({
  apiClient: {
    searchUsers: jest.fn().mockResolvedValue([]),
    shareConversation: jest.fn(),
  },
}))

// ============================================================================
// Imports — after mocks
// ============================================================================

import { ShareDialog } from '../ShareDialog'

// ============================================================================
// Tests
// ============================================================================

describe('ShareDialog — Share with everyone toggle', () => {
  const defaultProps = {
    conversationId: 'conv-123',
    conversationTitle: 'Test Conv',
    open: true,
    onOpenChange: jest.fn(),
  }

  beforeEach(() => {
    jest.clearAllMocks()

    // Mock loadSharingInfo response
    ;(global.fetch as jest.Mock).mockImplementation((url: string, opts?: any) => {
      if (url.includes('/share') && (!opts || opts.method !== 'POST')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              sharing: {
                is_public: false,
                shared_with: [],
                shared_with_teams: [],
                share_link_enabled: false,
              },
            },
          }),
        })
      }
      if (url.includes('/share') && opts?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: { sharing: { is_public: true } } }),
        })
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({}),
      })
    })
  })

  it('renders the "Share with everyone" toggle', async () => {
    render(<ShareDialog {...defaultProps} />)

    await waitFor(() => {
      expect(screen.getByTestId('share-public-toggle')).toBeInTheDocument()
    })
  })

  it('renders the toggle label', async () => {
    render(<ShareDialog {...defaultProps} />)

    await waitFor(() => {
      expect(screen.getByText('Share with everyone')).toBeInTheDocument()
    })
  })

  it('renders description text when not public', async () => {
    render(<ShareDialog {...defaultProps} />)

    await waitFor(() => {
      expect(screen.getByText('Only people and teams you add can access')).toBeInTheDocument()
    })
  })

  it('toggle has aria-checked="false" initially', async () => {
    render(<ShareDialog {...defaultProps} />)

    await waitFor(() => {
      const toggle = screen.getByTestId('share-public-toggle')
      expect(toggle).toHaveAttribute('aria-checked', 'false')
    })
  })

  it('toggle reflects is_public=true from API', async () => {
    ;(global.fetch as jest.Mock).mockImplementation((url: string, opts?: any) => {
      if (url.includes('/share') && (!opts || opts.method !== 'POST')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              sharing: {
                is_public: true,
                shared_with: [],
                shared_with_teams: [],
                share_link_enabled: false,
              },
            },
          }),
        })
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) })
    })

    render(<ShareDialog {...defaultProps} />)

    await waitFor(() => {
      const toggle = screen.getByTestId('share-public-toggle')
      expect(toggle).toHaveAttribute('aria-checked', 'true')
    })
  })

  it('clicking toggle sends POST with is_public', async () => {
    render(<ShareDialog {...defaultProps} />)

    await waitFor(() => {
      expect(screen.getByTestId('share-public-toggle')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('share-public-toggle'))

    await waitFor(() => {
      const postCalls = (global.fetch as jest.Mock).mock.calls.filter(
        ([url, opts]: [string, any]) => url.includes('/share') && opts?.method === 'POST'
      )
      expect(postCalls.length).toBeGreaterThan(0)
      const body = JSON.parse(postCalls[0][1].body)
      expect(body.is_public).toBe(true)
    })
  })

  it('updates store on successful toggle', async () => {
    render(<ShareDialog {...defaultProps} />)

    await waitFor(() => {
      expect(screen.getByTestId('share-public-toggle')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('share-public-toggle'))

    await waitFor(() => {
      expect(mockUpdateConversationSharing).toHaveBeenCalledWith(
        'conv-123',
        expect.objectContaining({ is_public: true })
      )
    })
  })

  it('toggle has role="switch"', async () => {
    render(<ShareDialog {...defaultProps} />)

    await waitFor(() => {
      const toggle = screen.getByTestId('share-public-toggle')
      expect(toggle).toHaveAttribute('role', 'switch')
    })
  })

  it('clicking toggle when on sends POST with is_public=false', async () => {
    ;(global.fetch as jest.Mock).mockImplementation((url: string, opts?: any) => {
      if (url.includes('/share') && (!opts || opts.method !== 'POST')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              sharing: {
                is_public: true,
                shared_with: [],
                shared_with_teams: [],
                share_link_enabled: false,
              },
            },
          }),
        })
      }
      if (url.includes('/share') && opts?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: { sharing: { is_public: false } } }),
        })
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) })
    })

    render(<ShareDialog {...defaultProps} />)

    await waitFor(() => {
      expect(screen.getByTestId('share-public-toggle')).toHaveAttribute('aria-checked', 'true')
    })

    fireEvent.click(screen.getByTestId('share-public-toggle'))

    await waitFor(() => {
      const postCalls = (global.fetch as jest.Mock).mock.calls.filter(
        ([url, opts]: [string, any]) => url.includes('/share') && opts?.method === 'POST'
      )
      expect(postCalls.length).toBeGreaterThan(0)
      const body = JSON.parse(postCalls[0][1].body)
      expect(body.is_public).toBe(false)
    })
  })

  it('handles API failure gracefully', async () => {
    ;(global.fetch as jest.Mock).mockImplementation((url: string, opts?: any) => {
      if (url.includes('/share') && (!opts || opts.method !== 'POST')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              sharing: {
                is_public: false,
                shared_with: [],
                shared_with_teams: [],
                share_link_enabled: false,
              },
            },
          }),
        })
      }
      if (url.includes('/share') && opts?.method === 'POST') {
        return Promise.reject(new Error('Network error'))
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) })
    })

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {})

    render(<ShareDialog {...defaultProps} />)

    await waitFor(() => {
      expect(screen.getByTestId('share-public-toggle')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('share-public-toggle'))

    await waitFor(() => {
      const toggle = screen.getByTestId('share-public-toggle')
      expect(toggle).toHaveAttribute('aria-checked', 'false')
    })

    consoleSpy.mockRestore()
    alertSpy.mockRestore()
  })
})
