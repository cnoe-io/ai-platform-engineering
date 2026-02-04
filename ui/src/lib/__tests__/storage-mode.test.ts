/**
 * Tests for storage mode detection and MongoDB availability checking
 */

import {
  isMongoDBAvailable,
  getStorageMode,
  invalidateStorageModeCache,
  getCachedStorageMode,
} from '../storage-mode';

describe('storage-mode', () => {
  beforeEach(() => {
    // Clear cache before each test
    invalidateStorageModeCache();
    global.fetch = jest.fn();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('isMongoDBAvailable', () => {
    it('should return true when MongoDB is available and returns valid data', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: [] }),
      });

      const result = await isMongoDBAvailable();

      expect(result).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/chat/conversations?page=1&page_size=1',
        {
          method: 'GET',
          headers: { 'Cache-Control': 'no-cache' },
        }
      );
    });

    it('should return false when MongoDB returns success: false', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: false, error: 'MongoDB error' }),
      });

      const result = await isMongoDBAvailable();

      expect(result).toBe(false);
    });

    it('should return false when API returns 503 (MongoDB not configured)', async () => {
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => ({ code: 'MONGODB_NOT_CONFIGURED', message: 'Not configured' }),
      });

      const result = await isMongoDBAvailable();

      expect(result).toBe(false);
      expect(consoleLogSpy).toHaveBeenCalledWith(
        '[StorageMode] MongoDB not configured - using localStorage mode'
      );

      consoleLogSpy.mockRestore();
    });

    it('should return false when API returns non-ok status', async () => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const result = await isMongoDBAvailable();

      expect(result).toBe(false);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        '[StorageMode] MongoDB backend unavailable, using localStorage only'
      );

      consoleWarnSpy.mockRestore();
    });

    it('should return false when JSON parsing fails', async () => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => {
          throw new Error('Invalid JSON');
        },
      });

      const result = await isMongoDBAvailable();

      expect(result).toBe(false);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        '[StorageMode] Invalid JSON response from backend:',
        expect.any(Error)
      );

      consoleWarnSpy.mockRestore();
    });

    it('should return false when fetch throws an error', async () => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

      const result = await isMongoDBAvailable();

      expect(result).toBe(false);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        '[StorageMode] Failed to check MongoDB availability:',
        expect.any(Error)
      );

      consoleWarnSpy.mockRestore();
    });

    it('should cache the result and not re-check within 60 seconds', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: [] }),
      });

      // First call
      const result1 = await isMongoDBAvailable();
      expect(result1).toBe(true);
      expect(global.fetch).toHaveBeenCalledTimes(1);

      // Second call immediately (should use cache)
      const result2 = await isMongoDBAvailable();
      expect(result2).toBe(true);
      expect(global.fetch).toHaveBeenCalledTimes(1); // Not called again

      // Third call (should still use cache)
      const result3 = await isMongoDBAvailable();
      expect(result3).toBe(true);
      expect(global.fetch).toHaveBeenCalledTimes(1); // Still not called again
    });
  });

  describe('getStorageMode', () => {
    it('should return "mongodb" when MongoDB is available', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: [] }),
      });

      const mode = await getStorageMode();

      expect(mode).toBe('mongodb');
    });

    it('should return "localStorage" when MongoDB is unavailable', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 503,
      });

      const mode = await getStorageMode();

      expect(mode).toBe('localStorage');
    });
  });

  describe('invalidateStorageModeCache', () => {
    it('should clear the cache and force re-check', async () => {
      // First check
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: [] }),
      });
      await isMongoDBAvailable();
      expect(global.fetch).toHaveBeenCalledTimes(1);

      // Second check (cached, no new fetch)
      await isMongoDBAvailable();
      expect(global.fetch).toHaveBeenCalledTimes(1);

      // Invalidate cache
      invalidateStorageModeCache();

      // Third check (should fetch again)
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: [] }),
      });
      await isMongoDBAvailable();
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('getCachedStorageMode', () => {
    it('should return null when no check has been performed', () => {
      const mode = getCachedStorageMode();
      expect(mode).toBeNull();
    });

    it('should return "mongodb" after successful check', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: [] }),
      });

      await isMongoDBAvailable();
      const mode = getCachedStorageMode();

      expect(mode).toBe('mongodb');
    });

    it('should return "localStorage" after failed check', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 503,
      });

      await isMongoDBAvailable();
      const mode = getCachedStorageMode();

      expect(mode).toBe('localStorage');
    });
  });
});
