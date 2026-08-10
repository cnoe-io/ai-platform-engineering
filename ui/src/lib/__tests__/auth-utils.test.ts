/**
 * Unit tests for auth-utils.ts
 * Tests JWT token expiry validation and formatting utilities
 */

import {
  isTokenExpired,
  getTimeUntilExpiry,
  formatTimeUntilExpiry,
  getWarningTimestamp,
} from '../auth-utils'

describe('auth-utils', () => {
  // Mock Date.now() for consistent testing
  const mockNow = 1700000000000 // Nov 14, 2023 22:13:20 GMT

  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(mockNow)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('isTokenExpired', () => {
    it('should return true if expiresAt is undefined', () => {
      expect(isTokenExpired(undefined)).toBe(true)
    })

    it('should return true if token is already expired', () => {
      const expiredTimestamp = Math.floor(mockNow / 1000) - 100 // 100 seconds ago
      expect(isTokenExpired(expiredTimestamp)).toBe(true)
    })

    it('should return false if token is still valid', () => {
      const futureTimestamp = Math.floor(mockNow / 1000) + 600 // 10 minutes from now
      expect(isTokenExpired(futureTimestamp)).toBe(false)
    })

    it('should respect buffer time parameter', () => {
      const timestamp = Math.floor(mockNow / 1000) + 30 // 30 seconds from now

      // With default 60s buffer, should be considered expired
      expect(isTokenExpired(timestamp, 60)).toBe(true)

      // With 20s buffer, should not be expired
      expect(isTokenExpired(timestamp, 20)).toBe(false)
    })

    it('should default to 60 second buffer', () => {
      const timestamp = Math.floor(mockNow / 1000) + 30 // 30 seconds from now
      expect(isTokenExpired(timestamp)).toBe(true) // default 60s buffer
    })

    it('should handle exact expiry time with buffer', () => {
      const timestamp = Math.floor(mockNow / 1000) + 60 // exactly 60 seconds from now
      expect(isTokenExpired(timestamp, 60)).toBe(true) // Should be expired (>= check)
    })
  })

  describe('getTimeUntilExpiry', () => {
    it('should return -1 if expiresAt is undefined', () => {
      expect(getTimeUntilExpiry(undefined)).toBe(-1)
    })

    it('should return negative value if token is expired', () => {
      const expiredTimestamp = Math.floor(mockNow / 1000) - 100
      expect(getTimeUntilExpiry(expiredTimestamp)).toBe(-100)
    })

    it('should return correct positive seconds until expiry', () => {
      const futureTimestamp = Math.floor(mockNow / 1000) + 300 // 5 minutes from now
      expect(getTimeUntilExpiry(futureTimestamp)).toBe(300)
    })

    it('should return 0 at exact expiry time', () => {
      const nowTimestamp = Math.floor(mockNow / 1000)
      expect(getTimeUntilExpiry(nowTimestamp)).toBe(0)
    })
  })

  describe('formatTimeUntilExpiry', () => {
    it('should return "expired" for negative seconds', () => {
      expect(formatTimeUntilExpiry(-1)).toBe('expired')
      expect(formatTimeUntilExpiry(-100)).toBe('expired')
    })

    it('should format seconds correctly', () => {
      expect(formatTimeUntilExpiry(1)).toBe('1 second')
      expect(formatTimeUntilExpiry(30)).toBe('30 seconds')
      expect(formatTimeUntilExpiry(59)).toBe('59 seconds')
    })

    it('should format minutes correctly', () => {
      expect(formatTimeUntilExpiry(60)).toBe('1 minute')
      expect(formatTimeUntilExpiry(90)).toBe('1 minute') // rounds down
      expect(formatTimeUntilExpiry(120)).toBe('2 minutes')
      expect(formatTimeUntilExpiry(300)).toBe('5 minutes')
      expect(formatTimeUntilExpiry(3599)).toBe('59 minutes')
    })

    it('should format hours correctly', () => {
      expect(formatTimeUntilExpiry(3600)).toBe('1 hour')
      expect(formatTimeUntilExpiry(7200)).toBe('2 hours')
      expect(formatTimeUntilExpiry(10800)).toBe('3 hours')
      expect(formatTimeUntilExpiry(86399)).toBe('23 hours')
    })

    it('should format days correctly', () => {
      expect(formatTimeUntilExpiry(86400)).toBe('1 day')
      expect(formatTimeUntilExpiry(172800)).toBe('2 days')
      expect(formatTimeUntilExpiry(259200)).toBe('3 days')
    })

    it('should handle singular vs plural correctly', () => {
      expect(formatTimeUntilExpiry(1)).toBe('1 second')  // singular
      expect(formatTimeUntilExpiry(2)).toBe('2 seconds') // plural
      expect(formatTimeUntilExpiry(60)).toBe('1 minute')   // singular
      expect(formatTimeUntilExpiry(120)).toBe('2 minutes') // plural
      expect(formatTimeUntilExpiry(3600)).toBe('1 hour')     // singular
      expect(formatTimeUntilExpiry(7200)).toBe('2 hours')    // plural
      expect(formatTimeUntilExpiry(86400)).toBe('1 day')      // singular
      expect(formatTimeUntilExpiry(172800)).toBe('2 days')    // plural
    })
  })

  describe('getWarningTimestamp', () => {
    it('should return undefined if expiresAt is undefined', () => {
      expect(getWarningTimestamp(undefined)).toBeUndefined()
    })

    it('should return timestamp 5 minutes before expiry', () => {
      const expiresAt = Math.floor(mockNow / 1000) + 600 // 10 minutes from now
      const warningTime = getWarningTimestamp(expiresAt)

      expect(warningTime).toBeDefined()
      expect(warningTime).toBe(expiresAt - 300) // 5 minutes (300 seconds) before expiry
    })

    it('should handle immediate expiry', () => {
      const expiresAt = Math.floor(mockNow / 1000) // expires now
      const warningTime = getWarningTimestamp(expiresAt)

      expect(warningTime).toBe(expiresAt - 300) // 5 minutes before (in the past)
    })

    it('should handle far future expiry', () => {
      const expiresAt = Math.floor(mockNow / 1000) + 86400 // 24 hours from now
      const warningTime = getWarningTimestamp(expiresAt)

      expect(warningTime).toBe(expiresAt - 300)
    })
  })

  describe('Integration scenarios', () => {
    it('should correctly identify token state at different time points', () => {
      const expiresAt = Math.floor(mockNow / 1000) + 600 // 10 minutes from now
      const warningTime = getWarningTimestamp(expiresAt)!

      // At current time (10 min before expiry)
      expect(isTokenExpired(expiresAt)).toBe(false)
      expect(getTimeUntilExpiry(expiresAt)).toBe(600)

      // Simulate 5 minutes passing (now at warning threshold)
      jest.spyOn(Date, 'now').mockReturnValue(mockNow + 300000) // +5 min
      const now5min = Math.floor(Date.now() / 1000)
      expect(now5min).toBe(warningTime) // Should be at warning time
      expect(isTokenExpired(expiresAt)).toBe(false)
      expect(getTimeUntilExpiry(expiresAt)).toBe(300) // 5 min remaining

      // Simulate 9 minutes passing (1 min before expiry, within buffer)
      jest.spyOn(Date, 'now').mockReturnValue(mockNow + 540000) // +9 min
      expect(isTokenExpired(expiresAt, 60)).toBe(true) // Within 60s buffer
      expect(getTimeUntilExpiry(expiresAt)).toBe(60) // 1 min remaining

      // Simulate 10 minutes passing (at expiry)
      jest.spyOn(Date, 'now').mockReturnValue(mockNow + 600000) // +10 min
      expect(isTokenExpired(expiresAt, 0)).toBe(true)
      expect(getTimeUntilExpiry(expiresAt)).toBe(0)
      expect(formatTimeUntilExpiry(getTimeUntilExpiry(expiresAt))).toBe('expired')
    })

    it('should handle typical token lifecycle', () => {
      // Token expires in 1 hour
      const expiresAt = Math.floor(mockNow / 1000) + 3600

      // Initial state: fresh token
      expect(isTokenExpired(expiresAt)).toBe(false)
      expect(formatTimeUntilExpiry(getTimeUntilExpiry(expiresAt))).toBe('1 hour')

      // 55 minutes pass
      jest.spyOn(Date, 'now').mockReturnValue(mockNow + 3300000)
      expect(isTokenExpired(expiresAt)).toBe(false)
      expect(formatTimeUntilExpiry(getTimeUntilExpiry(expiresAt))).toBe('5 minutes')

      // At warning threshold (5 min before expiry)
      jest.spyOn(Date, 'now').mockReturnValue(mockNow + 3300000)
      const warningTime = getWarningTimestamp(expiresAt)!
      const currentTime = Math.floor(Date.now() / 1000)
      expect(currentTime).toBe(warningTime)

      // 59 minutes pass (within 60s buffer)
      jest.spyOn(Date, 'now').mockReturnValue(mockNow + 3540000)
      expect(isTokenExpired(expiresAt, 60)).toBe(true) // Should refresh

      // 60 minutes pass (expired)
      jest.spyOn(Date, 'now').mockReturnValue(mockNow + 3600000)
      expect(isTokenExpired(expiresAt, 0)).toBe(true)
      expect(formatTimeUntilExpiry(getTimeUntilExpiry(expiresAt))).toBe('expired')
    })
  })
})
