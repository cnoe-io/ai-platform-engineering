import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const mockShareDialog = jest.fn(() => null)

jest.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}))

jest.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: any) => <>{children}</>,
  TooltipContent: ({ children }: any) => <>{children}</>,
  TooltipProvider: ({ children }: any) => <>{children}</>,
  TooltipTrigger: ({ children }: any) => <>{children}</>,
}))

jest.mock('lucide-react', () => ({
  Check: (props: any) => <span data-testid="icon-check" {...props} />,
  Globe: (props: any) => <span data-testid="icon-globe" {...props} />,
  Users2: (props: any) => <span data-testid="icon-users2" {...props} />,
}))

jest.mock('../ShareDialog', () => ({
  ShareDialog: (props: any) => {
    mockShareDialog(props)
    return props.open ? <div data-testid="share-dialog" /> : null
  },
}))

import { ShareButton } from '../ShareButton'

describe('ShareButton', () => {
  const writeText = jest.fn().mockResolvedValue(undefined)

  beforeEach(() => {
    jest.clearAllMocks()
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
  })

  it('copies the link for read-only shared recipients', async () => {
    render(
      <ShareButton
        conversationId="conv-recipient"
        conversationTitle="Recipient Chat"
        isOwner={false}
        isSharedWithViewer
        sharedBy="owner@test.com"
        accessLevel="shared_readonly"
      />,
    )

    expect(screen.getByRole('button', { name: 'Shared by owner@test.com' })).toBeInTheDocument()
    expect(screen.getByText('Shared by owner@test.com')).toBeInTheDocument()
    expect(screen.getByText('Click to copy link')).toBeInTheDocument()
    expect(screen.getByTestId('icon-users2')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Shared by owner@test.com' }))

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/chat/conv-recipient`)
    })
    expect(screen.queryByTestId('share-dialog')).not.toBeInTheDocument()
    expect(mockShareDialog).not.toHaveBeenCalled()
  })

  it('opens sharing details for edit-mode shared recipients', async () => {
    render(
      <ShareButton
        conversationId="conv-edit-recipient"
        conversationTitle="Editable Recipient Chat"
        isOwner={false}
        isSharedWithViewer
        sharedBy="owner@test.com"
        accessLevel="shared"
      />,
    )

    expect(screen.getByRole('button', { name: 'Shared by owner@test.com' })).toBeInTheDocument()
    expect(screen.getByText('Shared by owner@test.com')).toBeInTheDocument()
    expect(screen.queryByText('Click to copy link')).not.toBeInTheDocument()
    expect(screen.getByTestId('icon-users2')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Shared by owner@test.com' }))

    await waitFor(() => expect(screen.getByTestId('share-dialog')).toBeInTheDocument())
    expect(writeText).not.toHaveBeenCalled()
    expect(mockShareDialog).toHaveBeenLastCalledWith(expect.objectContaining({
      canManageSharing: false,
      open: true,
      sharedBy: 'owner@test.com',
    }))
  })

  it('opens the share dialog for owners', () => {
    render(
      <ShareButton
        conversationId="conv-owner"
        conversationTitle="Owner Chat"
        isOwner
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Share conversation' }))

    expect(screen.getByTestId('share-dialog')).toBeInTheDocument()
    expect(screen.getByTestId('icon-users2')).toBeInTheDocument()
  })
})
