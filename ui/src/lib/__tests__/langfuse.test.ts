/**
 * Tests for Langfuse feedback client utilities
 * Covers checkFeedbackStatus, submitFeedback, formatFeedbackSummary
 */

const mockFetch = jest.fn();
global.fetch = mockFetch;

jest.spyOn(console, 'log').mockImplementation(() => {});
jest.spyOn(console, 'error').mockImplementation(() => {});
jest.spyOn(console, 'debug').mockImplementation(() => {});

import {
  checkFeedbackStatus,
  submitFeedback,
  formatFeedbackSummary,
  type FeedbackRequest,
} from '../langfuse';

describe('checkFeedbackStatus', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('returns { enabled, host } on success', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ enabled: true, host: 'https://langfuse.example.com' }),
    });

    const result = await checkFeedbackStatus();

    expect(mockFetch).toHaveBeenCalledWith('/api/feedback', { method: 'GET' });
    expect(result).toEqual({ enabled: true, host: 'https://langfuse.example.com' });
  });

  it('returns { enabled: false, host: null } on non-ok response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
    });

    const result = await checkFeedbackStatus();

    expect(result).toEqual({ enabled: false, host: null });
  });

  it('returns { enabled: false, host: null } on network error', async () => {
    mockFetch.mockRejectedValue(new Error('Network failure'));

    const result = await checkFeedbackStatus();

    expect(result).toEqual({ enabled: false, host: null });
  });
});

describe('submitFeedback', () => {
  const baseFeedback: FeedbackRequest = {
    traceId: 'trace-123',
    messageId: 'msg-456',
    feedbackType: 'like',
  };

  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('sends POST with correct body', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, message: 'Thanks!' }),
    });

    await submitFeedback({
      ...baseFeedback,
      reason: 'helpful',
      additionalFeedback: 'Great response',
      conversationId: 'conv-789',
    });

    expect(mockFetch).toHaveBeenCalledWith('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        traceId: 'trace-123',
        messageId: 'msg-456',
        feedbackType: 'like',
        reason: 'helpful',
        additionalFeedback: 'Great response',
        conversationId: 'conv-789',
      }),
    });
  });

  it('returns success response', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        message: 'Feedback submitted',
        langfuseEnabled: true,
      }),
    });

    const result = await submitFeedback(baseFeedback);

    expect(result).toEqual({
      success: true,
      message: 'Feedback submitted',
      langfuseEnabled: true,
    });
  });

  it('returns failure when response not ok', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      json: async () => ({ success: false, message: 'Rate limited' }),
    });

    const result = await submitFeedback(baseFeedback);

    expect(result).toEqual({
      success: false,
      message: 'Rate limited',
    });
  });

  it('returns failure with default message when response not ok and no message', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      json: async () => ({}),
    });

    const result = await submitFeedback(baseFeedback);

    expect(result).toEqual({
      success: false,
      message: 'Failed to submit feedback',
    });
  });

  it('returns failure with error message on network error', async () => {
    mockFetch.mockRejectedValue(new Error('Failed to fetch'));

    const result = await submitFeedback(baseFeedback);

    expect(result).toEqual({
      success: false,
      message: 'Failed to fetch',
    });
  });

  it('returns "Network error" for non-Error thrown', async () => {
    mockFetch.mockRejectedValue('string error');

    const result = await submitFeedback(baseFeedback);

    expect(result).toEqual({
      success: false,
      message: 'Network error',
    });
  });

  it('includes all fields (traceId, messageId, feedbackType, reason, etc.)', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, message: 'OK' }),
    });

    await submitFeedback({
      traceId: 't1',
      messageId: 'm1',
      feedbackType: 'dislike',
      reason: 'incorrect',
      additionalFeedback: 'The answer was wrong',
      conversationId: 'c1',
    });

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody).toEqual({
      traceId: 't1',
      messageId: 'm1',
      feedbackType: 'dislike',
      reason: 'incorrect',
      additionalFeedback: 'The answer was wrong',
      conversationId: 'c1',
    });
  });
});

describe('formatFeedbackSummary', () => {
  it('"like" → "Positive"', () => {
    expect(formatFeedbackSummary('like')).toBe('Positive');
  });

  it('"dislike" → "Negative"', () => {
    expect(formatFeedbackSummary('dislike')).toBe('Negative');
  });

  it('with reason → includes reason in parens', () => {
    expect(formatFeedbackSummary('like', 'helpful')).toBe('Positive (helpful)');
    expect(formatFeedbackSummary('dislike', 'incorrect')).toBe('Negative (incorrect)');
  });

  it('with additionalFeedback → includes after dash', () => {
    expect(formatFeedbackSummary('like', undefined, 'Great job!')).toBe('Positive - Great job!');
  });

  it('with both reason and additionalFeedback', () => {
    expect(formatFeedbackSummary('dislike', 'wrong', 'Need more details')).toBe(
      'Negative (wrong) - Need more details'
    );
  });

  it('without reason or additionalFeedback', () => {
    expect(formatFeedbackSummary('like')).toBe('Positive');
    expect(formatFeedbackSummary('dislike')).toBe('Negative');
  });
});
