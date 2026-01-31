/**
 * Server-side API route for submitting user feedback to Langfuse
 * 
 * This endpoint handles feedback submission securely on the server,
 * keeping the Langfuse secret key private and allowing for additional
 * validation and logging.
 * 
 * @see https://langfuse.com/docs/observability/features/user-feedback
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-config";
import { Langfuse } from "langfuse";

// Langfuse configuration from environment variables (server-side only)
const LANGFUSE_SECRET_KEY = process.env.LANGFUSE_SECRET_KEY;
const LANGFUSE_PUBLIC_KEY = process.env.LANGFUSE_PUBLIC_KEY;
const LANGFUSE_HOST = process.env.LANGFUSE_HOST;

// Check if Langfuse is configured
const isLangfuseConfigured = (): boolean => {
  return !!(LANGFUSE_SECRET_KEY && LANGFUSE_PUBLIC_KEY && LANGFUSE_HOST);
};

// Singleton Langfuse client instance
let langfuseClient: Langfuse | null = null;

const getLangfuseClient = (): Langfuse | null => {
  if (!isLangfuseConfigured()) {
    return null;
  }

  if (!langfuseClient) {
    langfuseClient = new Langfuse({
      secretKey: LANGFUSE_SECRET_KEY!,
      publicKey: LANGFUSE_PUBLIC_KEY!,
      baseUrl: LANGFUSE_HOST!,
    });
  }

  return langfuseClient;
};

// Request body interface
interface FeedbackRequest {
  traceId: string;
  messageId: string;
  feedbackType: "like" | "dislike";
  reason?: string;
  additionalFeedback?: string;
  conversationId?: string;
}

// Response interface
interface FeedbackResponse {
  success: boolean;
  message: string;
  langfuseEnabled?: boolean;
}

/**
 * POST /api/feedback
 * Submit user feedback for a message
 */
export async function POST(request: NextRequest): Promise<NextResponse<FeedbackResponse>> {
  try {
    // Get user session for logging/attribution
    const session = await getServerSession(authOptions);
    const userId = session?.user?.email || "anonymous";

    // Parse request body
    const body: FeedbackRequest = await request.json();

    // Validate required fields
    if (!body.conversationId && !body.traceId && !body.messageId) {
      return NextResponse.json(
        { success: false, message: "conversationId, traceId, or messageId is required" },
        { status: 400 }
      );
    }

    if (!body.feedbackType || !["like", "dislike"].includes(body.feedbackType)) {
      return NextResponse.json(
        { success: false, message: "feedbackType must be 'like' or 'dislike'" },
        { status: 400 }
      );
    }

    // Priority for Langfuse traceId: conversationId > traceId > messageId
    // Using conversationId groups all feedback for a conversation under one trace
    const langfuseTraceId = body.conversationId || body.traceId || body.messageId;

    // Log feedback for debugging/analytics
    console.log("[Feedback API] Received feedback:", {
      langfuseTraceId,
      messageId: body.messageId,
      feedbackType: body.feedbackType,
      reason: body.reason,
      userId,
      conversationId: body.conversationId,
      timestamp: new Date().toISOString(),
    });

    // Send to Langfuse if configured
    const langfuse = getLangfuseClient();
    
    if (langfuse) {
      const scoreValue = body.feedbackType === "like" ? 1 : 0;
      
      // Format comment with all feedback details
      const commentParts: string[] = [];
      commentParts.push(`Type: ${body.feedbackType}`);
      if (body.reason) {
        commentParts.push(`Reason: ${body.reason}`);
      }
      if (body.additionalFeedback) {
        commentParts.push(`Additional: ${body.additionalFeedback}`);
      }
      commentParts.push(`User: ${userId}`);
      commentParts.push(`Message: ${body.messageId}`);
      if (body.conversationId) {
        commentParts.push(`Conversation: ${body.conversationId}`);
      }
      
      const comment = commentParts.join(" | ");

      // Create score in Langfuse using conversationId as the trace ID
      // This groups all feedback for a conversation under one trace
      await langfuse.score({
        traceId: langfuseTraceId,
        name: "user-feedback",
        value: scoreValue,
        comment,
      });

      // Flush to ensure the score is sent
      await langfuse.flushAsync();

      console.log("[Feedback API] Feedback sent to Langfuse:", {
        traceId: langfuseTraceId,
        scoreValue,
        comment,
      });

      return NextResponse.json({
        success: true,
        message: "Feedback submitted successfully",
        langfuseEnabled: true,
      });
    } else {
      // Langfuse not configured - still log locally
      console.log("[Feedback API] Langfuse not configured, feedback logged locally only");
      
      return NextResponse.json({
        success: true,
        message: "Feedback recorded (Langfuse not configured)",
        langfuseEnabled: false,
      });
    }
  } catch (error) {
    console.error("[Feedback API] Error processing feedback:", error);
    
    return NextResponse.json(
      { 
        success: false, 
        message: error instanceof Error ? error.message : "Failed to submit feedback" 
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/feedback/status
 * Check if Langfuse feedback is enabled
 */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    enabled: isLangfuseConfigured(),
    host: LANGFUSE_HOST ? new URL(LANGFUSE_HOST).hostname : null,
  });
}
