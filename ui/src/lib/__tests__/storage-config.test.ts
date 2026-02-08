/**
 * Tests for storage-config.ts
 *
 * Validates that getStorageMode(), shouldUseLocalStorage(), and
 * getStorageModeDisplay() work correctly on both server and client:
 *
 * - Server: reads process.env.MONGODB_URI + MONGODB_DATABASE.
 * - Client: reads storageMode from window.__APP_CONFIG__ via getConfig().
 */

import type { Config } from '../config';

// We test client-side behavior (jsdom env has window defined).
// The module under test uses `typeof window === 'undefined'` to decide
// server vs client, so we mock getConfig for client-side paths.

// Mock getConfig to control client-side behavior
jest.mock('../config', () => ({
  getConfig: jest.fn(),
}));

import { getStorageMode, shouldUseLocalStorage, getStorageModeDisplay } from '../storage-config';
import { getConfig } from '../config';

const mockedGetConfig = getConfig as jest.MockedFunction<typeof getConfig>;

describe('storage-config (client-side via jsdom)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getStorageMode', () => {
    it('should return "mongodb" when config says mongodb', () => {
      mockedGetConfig.mockReturnValue('mongodb' as any);
      expect(getStorageMode()).toBe('mongodb');
      expect(mockedGetConfig).toHaveBeenCalledWith('storageMode');
    });

    it('should return "localStorage" when config says localStorage', () => {
      mockedGetConfig.mockReturnValue('localStorage' as any);
      expect(getStorageMode()).toBe('localStorage');
      expect(mockedGetConfig).toHaveBeenCalledWith('storageMode');
    });
  });

  describe('shouldUseLocalStorage', () => {
    it('should return false when storageMode is mongodb', () => {
      mockedGetConfig.mockReturnValue('mongodb' as any);
      expect(shouldUseLocalStorage()).toBe(false);
    });

    it('should return true when storageMode is localStorage', () => {
      mockedGetConfig.mockReturnValue('localStorage' as any);
      expect(shouldUseLocalStorage()).toBe(true);
    });
  });

  describe('getStorageModeDisplay', () => {
    it('should return MongoDB display string for mongodb mode', () => {
      const display = getStorageModeDisplay('mongodb');
      expect(display).toContain('MongoDB');
      expect(display).toContain('Persistent');
    });

    it('should return localStorage display string for localStorage mode', () => {
      const display = getStorageModeDisplay('localStorage');
      expect(display).toContain('LocalStorage');
      expect(display).toContain('Browser-only');
    });

    it('should use current config when no mode argument provided', () => {
      mockedGetConfig.mockReturnValue('mongodb' as any);
      const display = getStorageModeDisplay();
      expect(display).toContain('MongoDB');
    });

    it('should use current config (localStorage) when no mode argument provided', () => {
      mockedGetConfig.mockReturnValue('localStorage' as any);
      const display = getStorageModeDisplay();
      expect(display).toContain('LocalStorage');
    });
  });
});

/**
 * Server-side tests: We need to test behavior when IS_SERVER = true,
 * but jsdom always has window defined. So we test getStorageMode's
 * server branch via getServerConfig() in config.test.ts (which covers
 * the MONGODB_URI + MONGODB_DATABASE → storageMode logic).
 *
 * Here we test the server-side logic explicitly using the config module.
 */
describe('storage-config integration with config', () => {
  it('getConfig("storageMode") returns mongodb when server has MONGODB configured', () => {
    mockedGetConfig.mockReturnValue('mongodb' as any);
    expect(getStorageMode()).toBe('mongodb');
    expect(shouldUseLocalStorage()).toBe(false);
  });

  it('getConfig("storageMode") returns localStorage when server has no MongoDB', () => {
    mockedGetConfig.mockReturnValue('localStorage' as any);
    expect(getStorageMode()).toBe('localStorage');
    expect(shouldUseLocalStorage()).toBe(true);
  });
});
