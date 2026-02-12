/**
 * @jest-environment jsdom
 */
/**
 * Tests for RecycleBinDialog helper functions
 *
 * Covers:
 * - daysRemaining: calculates days until auto-purge
 * - formatDeletedAt: formats relative time since deletion
 */

import { daysRemaining, formatDeletedAt } from '../chat/RecycleBinDialog';

// ============================================================================
// daysRemaining
// ============================================================================

describe('daysRemaining', () => {
  it('returns 7 for a conversation deleted just now', () => {
    const now = new Date();
    const result = daysRemaining(now);
    expect(result).toBe(7);
  });

  it('returns 6 for a conversation deleted 1 day ago', () => {
    const oneDayAgo = new Date();
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);
    const result = daysRemaining(oneDayAgo);
    expect(result).toBe(6);
  });

  it('returns 1 for a conversation deleted 6 days ago', () => {
    const sixDaysAgo = new Date();
    sixDaysAgo.setDate(sixDaysAgo.getDate() - 6);
    const result = daysRemaining(sixDaysAgo);
    expect(result).toBe(1);
  });

  it('returns 0 for a conversation deleted exactly 7 days ago', () => {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const result = daysRemaining(sevenDaysAgo);
    expect(result).toBe(0);
  });

  it('returns 0 for a conversation deleted more than 7 days ago (never negative)', () => {
    const tenDaysAgo = new Date();
    tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
    const result = daysRemaining(tenDaysAgo);
    expect(result).toBe(0);
  });

  it('returns 0 for a conversation deleted 30 days ago', () => {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const result = daysRemaining(thirtyDaysAgo);
    expect(result).toBe(0);
  });

  it('handles string date input (ISO format)', () => {
    const now = new Date();
    const result = daysRemaining(now.toISOString());
    expect(result).toBe(7);
  });

  it('handles Date object input', () => {
    const now = new Date();
    const result = daysRemaining(now);
    expect(result).toBe(7);
  });

  it('returns 4 for a conversation deleted 3 days ago', () => {
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    const result = daysRemaining(threeDaysAgo);
    expect(result).toBe(4);
  });

  it('handles deletion a few hours ago (still 7 days)', () => {
    const fewHoursAgo = new Date();
    fewHoursAgo.setHours(fewHoursAgo.getHours() - 5);
    const result = daysRemaining(fewHoursAgo);
    expect(result).toBe(7);
  });
});

// ============================================================================
// formatDeletedAt
// ============================================================================

describe('formatDeletedAt', () => {
  it('returns "Just now" for deletion less than 1 minute ago', () => {
    const now = new Date();
    expect(formatDeletedAt(now)).toBe('Just now');
  });

  it('returns "Just now" for deletion 30 seconds ago', () => {
    const thirtySecsAgo = new Date(Date.now() - 30 * 1000);
    expect(formatDeletedAt(thirtySecsAgo)).toBe('Just now');
  });

  it('returns minutes format for deletion 5 minutes ago', () => {
    const fiveMinsAgo = new Date(Date.now() - 5 * 60 * 1000);
    expect(formatDeletedAt(fiveMinsAgo)).toBe('5m ago');
  });

  it('returns minutes format for deletion 59 minutes ago', () => {
    const fiftyNineMinsAgo = new Date(Date.now() - 59 * 60 * 1000);
    expect(formatDeletedAt(fiftyNineMinsAgo)).toBe('59m ago');
  });

  it('returns hours format for deletion 1 hour ago', () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    expect(formatDeletedAt(oneHourAgo)).toBe('1h ago');
  });

  it('returns hours format for deletion 23 hours ago', () => {
    const twentyThreeHoursAgo = new Date(Date.now() - 23 * 60 * 60 * 1000);
    expect(formatDeletedAt(twentyThreeHoursAgo)).toBe('23h ago');
  });

  it('returns days format for deletion 1 day ago', () => {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    expect(formatDeletedAt(oneDayAgo)).toBe('1d ago');
  });

  it('returns days format for deletion 5 days ago', () => {
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    expect(formatDeletedAt(fiveDaysAgo)).toBe('5d ago');
  });

  it('returns days format for deletion 7 days ago', () => {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    expect(formatDeletedAt(sevenDaysAgo)).toBe('7d ago');
  });

  it('handles string date input (ISO format)', () => {
    const fiveMinsAgo = new Date(Date.now() - 5 * 60 * 1000);
    expect(formatDeletedAt(fiveMinsAgo.toISOString())).toBe('5m ago');
  });

  it('handles 1 minute boundary', () => {
    const oneMinAgo = new Date(Date.now() - 60 * 1000);
    expect(formatDeletedAt(oneMinAgo)).toBe('1m ago');
  });
});
