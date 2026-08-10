/**
 * Langfuse feedback client utilities
 * 
 * This module provides client-side functions for sending user feedback
 * to the server-side API, which then forwards to Langfuse.
 * 
 * The actual Langfuse communication happens server-side to keep
 * the secret key secure.
 * 
 * @see https://langfuse.com/docs/observability/features/user-feedback
 */

// Feedback request interface matching the API
export interface FeedbackRequest {
  traceId: string;
  messageId: string;
  feedbackType: "like" | "dislike";
  reason?: string;
  additionalFeedback?: string;
  conversationId?: string;
}

// Feedback response interface
export interface FeedbackResponse {
  success: boolean;
  message: string;
  langfuseEnabled?: boolean;
}

// Feedback status response
export interface FeedbackStatusResponse {
  enabled: boolean;
  host: string | null;
}

/**
 * Check if Langfuse feedback is enabled on the server
 */
export const checkFeedbackStatus = async (): Promise<FeedbackStatusResponse> => {
  try {
    const response = await fetch("/api/feedback", {
      method: "GET",
    });
    
    if (!response.ok) {
      return { enabled: false, host: null };
    }
    
    return await response.json();
  } catch (error) {
    console.error("[Langfuse] Failed to check feedback status:", error);
    return { enabled: false, host: null };
  }
};

/**
 * Send user feedback to the server-side API
 * 
 * @param feedback - The feedback data to submit
 * @returns Promise with the response
 */
export const submitFeedback = async (
  feedback: FeedbackRequest
): Promise<FeedbackResponse> => {
  try {
    const response = await fetch("/api/feedback", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(feedback),
    });

    const data: FeedbackResponse = await response.json();

    if (!response.ok) {
      console.error("[Langfuse] Feedback submission failed:", data.message);
      return {
        success: false,
        message: data.message || "Failed to submit feedback",
      };
    }

    console.debug("[Langfuse] Feedback submitted:", {
      traceId: feedback.traceId,
      feedbackType: feedback.feedbackType,
      langfuseEnabled: data.langfuseEnabled,
    });

    return data;
  } catch (error) {
    console.error("[Langfuse] Error submitting feedback:", error);
    return {
      success: false,
      message: error instanceof Error ? error.message : "Network error",
    };
  }
};

/**
 * Helper to format feedback for display/logging
 */
export const formatFeedbackSummary = (
  feedbackType: "like" | "dislike",
  reason?: string,
  additionalFeedback?: string
): string => {
  const parts: string[] = [];
  
  parts.push(feedbackType === "like" ? "Positive" : "Negative");
  
  if (reason) {
    parts.push(`(${reason})`);
  }
  
  if (additionalFeedback) {
    parts.push(`- ${additionalFeedback}`);
  }
  
  return parts.join(" ");
};
