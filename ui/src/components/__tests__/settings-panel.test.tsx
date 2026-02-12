/**
 * Unit tests for SettingsPanel component
 *
 * Tests:
 * - Loads preferences from localStorage on mount (fast cache)
 * - Attempts to load from server (MongoDB) and overrides localStorage
 * - Falls back to localStorage if server is unavailable
 * - Syncs changes to both localStorage and server (debounced)
 * - Handles font size, font family, theme, and gradient theme changes
 * - Shows sync status indicator (syncing, synced, error)
 * - Applies DOM attributes (data-font-size, data-font-family, gradient CSS vars)
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

// ============================================================================
// Mocks
// ============================================================================

// Mock next-themes
const mockSetTheme = jest.fn();
let mockTheme = 'dark';
jest.mock('next-themes', () => ({
  useTheme: () => ({
    theme: mockTheme,
    setTheme: (t: string) => {
      mockTheme = t;
      mockSetTheme(t);
    },
  }),
}));

// Mock framer-motion to simplify animation testing
jest.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

// Mock api-client
const mockGetSettings = jest.fn();
const mockUpdatePreferences = jest.fn();
jest.mock('@/lib/api-client', () => ({
  apiClient: {
    getSettings: (...args: any[]) => mockGetSettings(...args),
    updatePreferences: (...args: any[]) => mockUpdatePreferences(...args),
  },
}));

// Mock createPortal to render in place (not in document.body)
jest.mock('react-dom', () => ({
  ...jest.requireActual('react-dom'),
  createPortal: (node: any) => node,
}));

// ============================================================================
// Helpers
// ============================================================================

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: jest.fn((key: string) => store[key] || null),
    setItem: jest.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: jest.fn((key: string) => {
      delete store[key];
    }),
    clear: jest.fn(() => {
      store = {};
    }),
    get _store() {
      return store;
    },
  };
})();

Object.defineProperty(window, 'localStorage', { value: localStorageMock });

function resetMocks() {
  jest.clearAllMocks();
  jest.useFakeTimers();
  localStorageMock.clear();
  mockTheme = 'dark';
  mockGetSettings.mockReset();
  mockUpdatePreferences.mockReset();
  // Default: server unavailable (localStorage-only mode)
  mockGetSettings.mockRejectedValue(new Error('Not configured'));
  mockUpdatePreferences.mockResolvedValue({});
}

// Import after mocks
import { SettingsPanel } from '../settings-panel';

// ============================================================================
// Tests
// ============================================================================

describe('SettingsPanel', () => {
  beforeEach(resetMocks);

  afterEach(() => {
    jest.useRealTimers();
  });

  // --------------------------------------------------------------------------
  // Rendering
  // --------------------------------------------------------------------------

  describe('Rendering', () => {
    it('renders the UI Personalization button', async () => {
      await act(async () => {
        render(<SettingsPanel />);
      });

      const button = screen.getByTitle('UI Personalization');
      expect(button).toBeInTheDocument();
    });

    it('opens the panel when button is clicked', async () => {
      await act(async () => {
        render(<SettingsPanel />);
      });

      const button = screen.getByTitle('UI Personalization');
      await act(async () => {
        fireEvent.click(button);
      });

      expect(screen.getByText('UI Personalization')).toBeInTheDocument();
      expect(screen.getByText('Font Size')).toBeInTheDocument();
      expect(screen.getByText('Font Family')).toBeInTheDocument();
      expect(screen.getByText('Theme')).toBeInTheDocument();
      expect(screen.getByText('Gradient Theme')).toBeInTheDocument();
      expect(screen.getByText('Preview')).toBeInTheDocument();
    });
  });

  // --------------------------------------------------------------------------
  // localStorage Loading
  // --------------------------------------------------------------------------

  describe('localStorage Loading', () => {
    it('loads font_size from localStorage on mount', async () => {
      localStorageMock.setItem('caipe-font-size', 'large');

      await act(async () => {
        render(<SettingsPanel />);
      });

      expect(localStorageMock.getItem).toHaveBeenCalledWith('caipe-font-size');
      expect(document.body.getAttribute('data-font-size')).toBe('large');
    });

    it('loads font_family from localStorage on mount', async () => {
      localStorageMock.setItem('caipe-font-family', 'ibm-plex');

      await act(async () => {
        render(<SettingsPanel />);
      });

      expect(localStorageMock.getItem).toHaveBeenCalledWith('caipe-font-family');
      expect(document.body.getAttribute('data-font-family')).toBe('ibm-plex');
    });

    it('loads gradient_theme from localStorage on mount', async () => {
      localStorageMock.setItem('caipe-gradient-theme', 'ocean');

      await act(async () => {
        render(<SettingsPanel />);
      });

      expect(localStorageMock.getItem).toHaveBeenCalledWith('caipe-gradient-theme');
      expect(document.documentElement.getAttribute('data-gradient-theme')).toBe('ocean');
    });

    it('applies default gradient theme when none saved', async () => {
      await act(async () => {
        render(<SettingsPanel />);
      });

      expect(document.documentElement.getAttribute('data-gradient-theme')).toBe('default');
    });
  });

  // --------------------------------------------------------------------------
  // Server Loading (MongoDB sync)
  // --------------------------------------------------------------------------

  describe('Server Loading', () => {
    it('overrides localStorage with server preferences', async () => {
      localStorageMock.setItem('caipe-font-size', 'small');

      mockGetSettings.mockResolvedValue({
        preferences: {
          font_size: 'x-large',
          font_family: 'source-sans',
          gradient_theme: 'sunset',
          theme: 'nord',
        },
      });

      await act(async () => {
        render(<SettingsPanel />);
      });

      // Wait for async server load
      await act(async () => {
        jest.runAllTimers();
      });

      await waitFor(() => {
        // Server values should override localStorage
        expect(localStorageMock.setItem).toHaveBeenCalledWith('caipe-font-size', 'x-large');
        expect(localStorageMock.setItem).toHaveBeenCalledWith('caipe-font-family', 'source-sans');
        expect(localStorageMock.setItem).toHaveBeenCalledWith('caipe-gradient-theme', 'sunset');
      });

      expect(document.body.getAttribute('data-font-size')).toBe('x-large');
      expect(document.body.getAttribute('data-font-family')).toBe('source-sans');
      expect(document.documentElement.getAttribute('data-gradient-theme')).toBe('sunset');
      expect(mockSetTheme).toHaveBeenCalledWith('nord');
    });

    it('keeps localStorage values when server is unavailable', async () => {
      localStorageMock.setItem('caipe-font-size', 'large');
      localStorageMock.setItem('caipe-font-family', 'ibm-plex');
      mockGetSettings.mockRejectedValue(new Error('Network error'));

      await act(async () => {
        render(<SettingsPanel />);
      });

      await act(async () => {
        jest.runAllTimers();
      });

      // Should still have localStorage values applied
      expect(document.body.getAttribute('data-font-size')).toBe('large');
      expect(document.body.getAttribute('data-font-family')).toBe('ibm-plex');
    });

    it('ignores invalid server preference values', async () => {
      localStorageMock.setItem('caipe-font-size', 'medium');

      mockGetSettings.mockResolvedValue({
        preferences: {
          font_size: 'giant', // not a valid option
          font_family: 'comic-sans', // not a valid option
          gradient_theme: 'rainbow', // not a valid option
          theme: 'matrix', // not a valid option
        },
      });

      await act(async () => {
        render(<SettingsPanel />);
      });

      await act(async () => {
        jest.runAllTimers();
      });

      // Should keep the localStorage value since server values are invalid
      expect(document.body.getAttribute('data-font-size')).toBe('medium');
    });
  });

  // --------------------------------------------------------------------------
  // User Interactions - Font Size
  // --------------------------------------------------------------------------

  describe('Font Size Changes', () => {
    it('updates font size and saves to localStorage', async () => {
      await act(async () => {
        render(<SettingsPanel />);
      });

      // Open panel
      await act(async () => {
        fireEvent.click(screen.getByTitle('UI Personalization'));
      });

      // Click "Large" font size
      const largeButton = screen.getByText('Large');
      await act(async () => {
        fireEvent.click(largeButton);
      });

      expect(localStorageMock.setItem).toHaveBeenCalledWith('caipe-font-size', 'large');
      expect(document.body.getAttribute('data-font-size')).toBe('large');
    });

    it('syncs font size to server (debounced)', async () => {
      mockUpdatePreferences.mockResolvedValue({});

      await act(async () => {
        render(<SettingsPanel />);
      });

      await act(async () => {
        fireEvent.click(screen.getByTitle('UI Personalization'));
      });

      await act(async () => {
        fireEvent.click(screen.getByText('Large'));
      });

      // Should not sync immediately (debounced)
      expect(mockUpdatePreferences).not.toHaveBeenCalled();

      // Fast-forward debounce timer (500ms)
      await act(async () => {
        jest.advanceTimersByTime(500);
      });

      expect(mockUpdatePreferences).toHaveBeenCalledWith({ font_size: 'large' });
    });
  });

  // --------------------------------------------------------------------------
  // User Interactions - Font Family
  // --------------------------------------------------------------------------

  describe('Font Family Changes', () => {
    it('updates font family and saves to localStorage', async () => {
      await act(async () => {
        render(<SettingsPanel />);
      });

      await act(async () => {
        fireEvent.click(screen.getByTitle('UI Personalization'));
      });

      await act(async () => {
        fireEvent.click(screen.getByText('IBM Plex'));
      });

      expect(localStorageMock.setItem).toHaveBeenCalledWith('caipe-font-family', 'ibm-plex');
      expect(document.body.getAttribute('data-font-family')).toBe('ibm-plex');
    });

    it('syncs font family to server', async () => {
      mockUpdatePreferences.mockResolvedValue({});

      await act(async () => {
        render(<SettingsPanel />);
      });

      await act(async () => {
        fireEvent.click(screen.getByTitle('UI Personalization'));
      });

      await act(async () => {
        fireEvent.click(screen.getByText('Source Sans'));
      });

      await act(async () => {
        jest.advanceTimersByTime(500);
      });

      expect(mockUpdatePreferences).toHaveBeenCalledWith({ font_family: 'source-sans' });
    });
  });

  // --------------------------------------------------------------------------
  // User Interactions - Theme
  // --------------------------------------------------------------------------

  describe('Theme Changes', () => {
    it('changes theme via next-themes and syncs to server', async () => {
      mockUpdatePreferences.mockResolvedValue({});

      await act(async () => {
        render(<SettingsPanel />);
      });

      await act(async () => {
        fireEvent.click(screen.getByTitle('UI Personalization'));
      });

      await act(async () => {
        fireEvent.click(screen.getByText('Midnight'));
      });

      expect(mockSetTheme).toHaveBeenCalledWith('midnight');

      await act(async () => {
        jest.advanceTimersByTime(500);
      });

      expect(mockUpdatePreferences).toHaveBeenCalledWith({ theme: 'midnight' });
    });
  });

  // --------------------------------------------------------------------------
  // User Interactions - Gradient Theme
  // --------------------------------------------------------------------------

  describe('Gradient Theme Changes', () => {
    it('updates gradient theme CSS vars and saves to localStorage', async () => {
      await act(async () => {
        render(<SettingsPanel />);
      });

      await act(async () => {
        fireEvent.click(screen.getByTitle('UI Personalization'));
      });

      // Click the "Sunset" gradient option
      await act(async () => {
        fireEvent.click(screen.getByText('Sunset (Orange → Pink)'));
      });

      expect(localStorageMock.setItem).toHaveBeenCalledWith('caipe-gradient-theme', 'sunset');
      expect(document.documentElement.getAttribute('data-gradient-theme')).toBe('sunset');
      // CSS custom properties should be set
      expect(document.documentElement.style.getPropertyValue('--gradient-from')).toBe('hsl(30,80%,55%)');
      expect(document.documentElement.style.getPropertyValue('--gradient-to')).toBe('hsl(340,70%,55%)');
    });

    it('syncs gradient theme to server', async () => {
      mockUpdatePreferences.mockResolvedValue({});

      await act(async () => {
        render(<SettingsPanel />);
      });

      await act(async () => {
        fireEvent.click(screen.getByTitle('UI Personalization'));
      });

      await act(async () => {
        fireEvent.click(screen.getByText('Ocean (Cyan → Blue)'));
      });

      await act(async () => {
        jest.advanceTimersByTime(500);
      });

      expect(mockUpdatePreferences).toHaveBeenCalledWith({ gradient_theme: 'ocean' });
    });
  });

  // --------------------------------------------------------------------------
  // Debounce Behavior
  // --------------------------------------------------------------------------

  describe('Debounce Behavior', () => {
    it('debounces rapid changes and only syncs the last value', async () => {
      mockUpdatePreferences.mockResolvedValue({});

      await act(async () => {
        render(<SettingsPanel />);
      });

      await act(async () => {
        fireEvent.click(screen.getByTitle('UI Personalization'));
      });

      // Rapidly change font size 3 times
      await act(async () => {
        fireEvent.click(screen.getByText('Small'));
      });

      await act(async () => {
        jest.advanceTimersByTime(200); // Not yet at 500ms
      });

      await act(async () => {
        fireEvent.click(screen.getByText('Large'));
      });

      await act(async () => {
        jest.advanceTimersByTime(200); // Still not at 500ms from last change
      });

      await act(async () => {
        fireEvent.click(screen.getByText('Extra Large'));
      });

      // Now wait for debounce
      await act(async () => {
        jest.advanceTimersByTime(500);
      });

      // Should only call once with the final value
      expect(mockUpdatePreferences).toHaveBeenCalledTimes(1);
      expect(mockUpdatePreferences).toHaveBeenCalledWith({ font_size: 'x-large' });
    });
  });

  // --------------------------------------------------------------------------
  // Sync Error Handling
  // --------------------------------------------------------------------------

  describe('Sync Error Handling', () => {
    it('does not throw when server sync fails', async () => {
      mockUpdatePreferences.mockRejectedValue(new Error('Server down'));

      await act(async () => {
        render(<SettingsPanel />);
      });

      await act(async () => {
        fireEvent.click(screen.getByTitle('UI Personalization'));
      });

      // Should not throw
      await act(async () => {
        fireEvent.click(screen.getByText('Large'));
      });

      await act(async () => {
        jest.advanceTimersByTime(500);
      });

      // localStorage should still have the value despite server failure
      expect(localStorageMock.setItem).toHaveBeenCalledWith('caipe-font-size', 'large');
      expect(document.body.getAttribute('data-font-size')).toBe('large');
    });
  });
});
