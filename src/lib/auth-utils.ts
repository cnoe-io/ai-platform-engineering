/**
 * Auth utility functions for token validation and expiry checking
 */

/**
 * Check if a JWT token is expired or will expire soon
 *
 * @param expiresAt - Unix timestamp (in seconds) when token expires
 * @param bufferSeconds - How many seconds before expiry to consider token invalid (default: 60s)
 * @returns true if token is expired or will expire within buffer time
 */
export function isTokenExpired(expiresAt: number | undefined, bufferSeconds: number = 60): boolean {
  if (!expiresAt) {
    return true; // No expiry time means invalid token
  }

  const now = Math.floor(Date.now() / 1000); // Current time in seconds
  const expiryWithBuffer = expiresAt - bufferSeconds;

  return now >= expiryWithBuffer;
}

/**
 * Get the number of seconds until token expires
 *
 * @param expiresAt - Unix timestamp (in seconds) when token expires
 * @returns seconds until expiry (negative if already expired)
 */
export function getTimeUntilExpiry(expiresAt: number | undefined): number {
  if (!expiresAt) {
    return -1;
  }

  const now = Math.floor(Date.now() / 1000);
  return expiresAt - now;
}

/**
 * Format time until expiry in human-readable format
 *
 * @param seconds - seconds until expiry
 * @returns formatted string like "5 minutes", "2 hours", etc.
 */
export function formatTimeUntilExpiry(seconds: number): string {
  if (seconds <= 0) {
    return "expired";
  }

  if (seconds < 60) {
    return `${seconds} second${seconds !== 1 ? 's' : ''}`;
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} hour${hours !== 1 ? 's' : ''}`;
  }

  const days = Math.floor(hours / 24);
  return `${days} day${days !== 1 ? 's' : ''}`;
}

/**
 * Calculate when to start warning user about token expiry
 * Returns timestamp when warning should start (5 minutes before expiry)
 *
 * @param expiresAt - Unix timestamp (in seconds) when token expires
 * @returns Unix timestamp when to show warning (5 min before expiry)
 */
export function getWarningTimestamp(expiresAt: number | undefined): number | undefined {
  if (!expiresAt) {
    return undefined;
  }

  // Warn 5 minutes before expiry
  const warningBufferSeconds = 5 * 60;
  return expiresAt - warningBufferSeconds;
}
