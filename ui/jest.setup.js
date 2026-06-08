// Learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom'

// Mock window.matchMedia (only in jsdom; node env has no window)
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: jest.fn().mockImplementation(query => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: jest.fn(), // deprecated
      removeListener: jest.fn(), // deprecated
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    })),
  })
}

// Mock IntersectionObserver
global.IntersectionObserver = class IntersectionObserver {
  constructor() {}
  disconnect() {}
  observe() {}
  takeRecords() {
    return []
  }
  unobserve() {}
}

// Mock ResizeObserver.
// Tests can set global.__mockContainerWidth to control what offsetWidth
// the observed element returns, so nav overflow logic in AppHeader sees a
// realistic value. Defaults to 2000 (all items visible). Set to 0 to force
// the More dropdown to appear.
global.__mockContainerWidth = 2000
global.ResizeObserver = class ResizeObserver {
  constructor(callback) { this.callback = callback }
  disconnect() {}
  observe(target) {
    const w = global.__mockContainerWidth
    Object.defineProperty(target, 'offsetWidth', { configurable: true, get: () => w })
    // Do NOT call the callback here — avoids triggering side effects in
    // unrelated components (e.g. graph components that use DOMMatrixReadOnly).
    // AppHeader calls recompute() directly after observe(), so stubbing
    // offsetWidth is sufficient for the overflow calculation to work.
  }
  unobserve() {}
}

// Mock fetch for Node.js environment
global.fetch = jest.fn(() =>
  Promise.resolve({
    ok: true,
    status: 200,
    json: async () => ({}),
    text: async () => '',
  })
)

// Polyfill TextEncoder/TextDecoder for jsdom (used in a2a-client tests)
if (typeof global.TextEncoder === 'undefined') {
  const { TextEncoder, TextDecoder } = require('util')
  global.TextEncoder = TextEncoder
  global.TextDecoder = TextDecoder
}
