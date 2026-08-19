/**
 * Unit tests for NewHomePage
 *
 * Tests:
 * - Renders the toggle link and every enabled content block as a widget
 * - Clicking the toggle switches the experience back to "classic"
 * - No content widgets render when none are enabled
 * - Enabled widget ids render their registered component, wrapped for removal
 * - "Add widget" control lists only widgets not yet enabled
 * - Clicking an "Add widget" entry calls addWidget with that id
 */

import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'

jest.mock('lucide-react', () => {
  // eslint-disable-next-line react/display-name
  const stub = (name: string) => (props: unknown) => <svg data-testid={`icon-${name}`} {...props} />
  return new Proxy({}, { get: (_t, prop: string) => stub(prop) })
})

jest.mock('@/components/home/widget-registry', () => ({
  HOME_WIDGET_COMPONENTS: {
    heroComposer: () => <div data-testid="widget-body-heroComposer" />,
    quickStart: () => <div data-testid="widget-body-quickStart" />,
    shortcuts: () => <div data-testid="widget-body-shortcuts" />,
    recentChats: () => <div data-testid="widget-body-recentChats" />,
  },
}))

const mockAddWidget = jest.fn()
const mockRemoveWidget = jest.fn()
const mockSetExperience = jest.fn()
let mockWidgets: string[] = ['heroComposer', 'quickStart']
let mockAvailableToAdd: Array<{ id: string; label: string }> = [
  { id: 'shortcuts', label: 'Shortcuts' },
  { id: 'recentChats', label: 'Recent Chats' },
]

const mockReorderWidgets = jest.fn()

function mockStoreStateBase() {
  return {
    widgets: mockWidgets,
    addWidget: mockAddWidget,
    removeWidget: mockRemoveWidget,
    reorderWidgets: mockReorderWidgets,
    setExperience: mockSetExperience,
    availableToAdd: () => mockAvailableToAdd,
  }
}

jest.mock('@/store/home-widgets-store', () => {
  const useHomeWidgetsStore = (selector: (state: unknown) => unknown) => selector(mockStoreStateBase())
  useHomeWidgetsStore.getState = () => mockStoreStateBase()
  return { useHomeWidgetsStore }
})

let capturedOnDragEnd: ((event: { active: { id: string }; over: { id: string } | null }) => void) | null = null
jest.mock('@dnd-kit/core', () => ({
  DndContext: ({ children, onDragEnd }: { children: React.ReactNode; onDragEnd: typeof capturedOnDragEnd }) => {
    capturedOnDragEnd = onDragEnd
    return <>{children}</>
  },
  closestCenter: jest.fn(),
  PointerSensor: jest.fn(),
  KeyboardSensor: jest.fn(),
  useSensor: jest.fn(),
  useSensors: jest.fn(() => []),
}))

jest.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: jest.fn(),
    setActivatorNodeRef: jest.fn(),
    transform: null,
    transition: undefined,
    isDragging: false,
  }),
  sortableKeyboardCoordinates: jest.fn(),
  verticalListSortingStrategy: 'vertical',
}))

jest.mock('@dnd-kit/utilities', () => ({
  CSS: { Transform: { toString: () => undefined } },
}))

import { NewHomePage } from '../NewHomePage'

describe('NewHomePage', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockWidgets = ['heroComposer', 'quickStart']
    mockAvailableToAdd = [
      { id: 'shortcuts', label: 'Shortcuts' },
      { id: 'recentChats', label: 'Recent Chats' },
    ]
  })

  it('renders the composer and quick start as removable, sortable widgets', () => {
    render(<NewHomePage />)
    expect(screen.getByTestId('home-widget-heroComposer')).toBeInTheDocument()
    expect(screen.getByTestId('widget-body-heroComposer')).toBeInTheDocument()
    expect(screen.getByTestId('home-widget-drag-heroComposer')).toBeInTheDocument()
    expect(screen.getByTestId('home-widget-remove-heroComposer')).toBeInTheDocument()
    expect(screen.getByTestId('home-widget-quickStart')).toBeInTheDocument()
    expect(screen.getByTestId('widget-body-quickStart')).toBeInTheDocument()
  })

  it('renders "Powered by caipe.io" footer', () => {
    render(<NewHomePage />)
    const link = screen.getByText('caipe.io')
    expect(link.closest('a')).toHaveAttribute('href', 'https://caipe.io')
  })

  it('renders a toggle back to the classic experience', () => {
    render(<NewHomePage />)
    fireEvent.click(screen.getByTestId('switch-to-classic-home'))
    expect(mockSetExperience).toHaveBeenCalledWith('classic')
  })

  describe('widgets', () => {
    it('renders no content blocks when all widgets are disabled', () => {
      mockWidgets = []
      render(<NewHomePage />)
      expect(screen.queryByTestId('widget-body-heroComposer')).not.toBeInTheDocument()
      expect(screen.queryByTestId('widget-body-quickStart')).not.toBeInTheDocument()
      expect(screen.queryByTestId('widget-body-shortcuts')).not.toBeInTheDocument()
      expect(screen.queryByTestId('widget-body-recentChats')).not.toBeInTheDocument()
    })

    it('renders enabled widgets wrapped for removal', () => {
      mockWidgets = ['shortcuts', 'recentChats']
      render(<NewHomePage />)
      expect(screen.getByTestId('home-widget-shortcuts')).toBeInTheDocument()
      expect(screen.getByTestId('widget-body-shortcuts')).toBeInTheDocument()
      expect(screen.getByTestId('home-widget-recentChats')).toBeInTheDocument()
      expect(screen.getByTestId('widget-body-recentChats')).toBeInTheDocument()
    })

    it('removes any content widget through the shared frame control', () => {
      render(<NewHomePage />)
      fireEvent.click(screen.getByTestId('home-widget-remove-heroComposer'))
      expect(mockRemoveWidget).toHaveBeenCalledWith('heroComposer')
    })

    it('renders enabled widgets in the order they were added', () => {
      mockWidgets = ['recentChats', 'shortcuts']
      render(<NewHomePage />)
      const order = screen
        .getAllByTestId(/^home-widget-(?!remove-|drag-)/)
        .map((el) => el.dataset.testid)
      expect(order).toEqual(['home-widget-recentChats', 'home-widget-shortcuts'])
    })

    it('gives each enabled widget a drag handle', () => {
      mockWidgets = ['recentChats', 'shortcuts']
      render(<NewHomePage />)
      expect(screen.getByTestId('home-widget-drag-recentChats')).toBeInTheDocument()
      expect(screen.getByTestId('home-widget-drag-shortcuts')).toBeInTheDocument()
    })
  })

  describe('drag to reorder', () => {
    it('reorders widgets when a drag ends over a different widget', () => {
      mockWidgets = ['recentChats', 'shortcuts']
      render(<NewHomePage />)

      capturedOnDragEnd?.({ active: { id: 'recentChats' }, over: { id: 'shortcuts' } })

      expect(mockReorderWidgets).toHaveBeenCalledWith(['shortcuts', 'recentChats'])
    })

    it('does not reorder when dropped on itself or outside a droppable', () => {
      mockWidgets = ['recentChats', 'shortcuts']
      render(<NewHomePage />)

      capturedOnDragEnd?.({ active: { id: 'recentChats' }, over: { id: 'recentChats' } })
      capturedOnDragEnd?.({ active: { id: 'recentChats' }, over: null })

      expect(mockReorderWidgets).not.toHaveBeenCalled()
    })
  })

  describe('add widget control', () => {
    it('lists only widgets not yet enabled', () => {
      mockWidgets = ['shortcuts']
      mockAvailableToAdd = [
        { id: 'recentChats', label: 'Recent Chats' },
      ]
      render(<NewHomePage />)
      fireEvent.click(screen.getByTestId('add-widget-trigger'))
      expect(screen.getByTestId('add-widget-recentChats')).toBeInTheDocument()
      expect(screen.queryByTestId('add-widget-shortcuts')).not.toBeInTheDocument()
    })

    it('hides the add-widget control when nothing is left to add', () => {
      mockAvailableToAdd = []
      render(<NewHomePage />)
      expect(screen.queryByTestId('add-widget-trigger')).not.toBeInTheDocument()
    })

    it('calls addWidget with the clicked widget id', () => {
      render(<NewHomePage />)
      fireEvent.click(screen.getByTestId('add-widget-trigger'))
      fireEvent.click(screen.getByTestId('add-widget-recentChats'))
      expect(mockAddWidget).toHaveBeenCalledWith('recentChats')
    })
  })
})
