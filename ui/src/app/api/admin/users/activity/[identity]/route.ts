// GET /api/admin/users/activity/[identity] - Get a user's Mongo-backed activity

import {
  ApiError,
  getAuthFromBearerOrSession,
  requireRbacPermission,
  successResponse,
  withErrorHandler,
} from "@/lib/api-middleware";
import { getCollection,isMongoDBConfigured } from "@/lib/mongodb";
import {
  resolveAuthorizedAdminSimulationScope,
  simulationSubjectCanManageAdminSurface,
} from "@/lib/rbac/admin-simulation-server";
import type { User } from "@/types/mongodb";
import type { Document,Filter } from "mongodb";
import { type NextRequest,NextResponse } from "next/server";

interface ActivityUser extends User {
  slack_user_id?: string;
  source?: string;
}

interface ActivityConversation extends Document {
  _id?: unknown;
  channel_id?: string;
  channel_name?: string;
  client_type?: string;
  created_at?: Date | string;
  metadata?: {
    channel_id?: string;
    channel_name?: string;
    owner_display_name?: string;
  };
  slack_meta?: {
    channel_id?: string;
    channel_name?: string;
  };
  source?: string;
  title?: string;
  updated_at?: Date | string;
}

interface ActivityFeedback extends Document {
  channel_name?: string;
  comment?: string;
  conversation_id?: string;
  created_at?: Date | string;
  rating?: string;
  slack_permalink?: string;
  source?: string;
  value?: string;
}

function dateString(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" ? value : "";
}

function conversationSource(conversation: ActivityConversation): string {
  return conversation.source === "slack" || conversation.client_type === "slack"
    ? "slack"
    : "web";
}

export const GET = withErrorHandler(
  async (
    request: NextRequest,
    context: { params: Promise<{ identity: string }> }
  ) => {
    if (!isMongoDBConfigured) {
      return NextResponse.json(
        {
          success: false,
          error: "MongoDB not configured - admin features require MongoDB",
          code: "MONGODB_NOT_CONFIGURED",
        },
        { status: 503 }
      );
    }

    const { session } = await getAuthFromBearerOrSession(request);
    const simulationScope = await resolveAuthorizedAdminSimulationScope(
      request.nextUrl.searchParams,
      session,
    );
    if (simulationScope) {
      const canReadAllStats = await simulationSubjectCanManageAdminSurface(
        simulationScope,
        "stats",
      );
      if (!canReadAllStats) {
        throw new ApiError(
          "The selected preview subject cannot view another user's activity.",
          403,
          "admin_surface:stats#can_manage",
          "pdp_denied",
          "contact_admin",
        );
      }
    } else {
      // Match the authorization level of the original admin activity drawer:
      // detailed conversation titles and feedback are organization-audit data.
      await requireRbacPermission(session, "admin_ui", "view");
    }

    const { identity: rawIdentity } = await context.params;
    const identity = rawIdentity.trim();
    if (!identity) {
      throw new ApiError("User identity is required", 400, "INVALID_USER_IDENTITY");
    }

    const normalizedIdentity = identity.includes("@")
      ? identity.toLowerCase()
      : identity;
    const users = await getCollection<ActivityUser>("users");
    const conversations = await getCollection<ActivityConversation>("conversations");
    const feedback = await getCollection<ActivityFeedback>("feedback");

    const userLookup: Filter<ActivityUser> = {
      $or: [
        { email: identity },
        { email: normalizedIdentity },
        { slack_user_id: identity },
      ],
    };
    const user = await users.findOne(userLookup);

    // A linked person can own web activity by email and Slack activity by the
    // linked Slack id. Query every known identifier so the drawer is complete.
    const ownerIds = new Set<string>();
    const addOwnerId = (value: unknown) => {
      if (typeof value !== "string" || !value.trim()) return;
      const trimmed = value.trim();
      ownerIds.add(trimmed);
      if (trimmed.includes("@")) ownerIds.add(trimmed.toLowerCase());
    };
    addOwnerId(identity);
    addOwnerId(user?.email);
    addOwnerId(user?.slack_user_id);
    const identities = [...ownerIds];
    const conversationFilter = {
      owner_id: identities.length === 1 ? identities[0] : { $in: identities },
    };
    const feedbackFilter = {
      $or: [
        { user_email: { $in: identities } },
        { user_id: { $in: identities } },
      ],
    };

    const [recentConversations,totalConversations,feedbackStats,recentFeedback] =
      await Promise.all([
        conversations
          .find(conversationFilter, {
            projection: {
              _id: 1,
              channel_id: 1,
              channel_name: 1,
              client_type: 1,
              created_at: 1,
              "metadata.channel_id": 1,
              "metadata.channel_name": 1,
              "metadata.owner_display_name": 1,
              slack_meta: 1,
              source: 1,
              title: 1,
              updated_at: 1,
            },
          })
          .sort({ updated_at: -1 })
          .limit(20)
          .toArray(),
        conversations.countDocuments(conversationFilter),
        feedback
          .aggregate([
            { $match: feedbackFilter },
            {
              $group: {
                _id: null,
                total: { $sum: 1 },
                positive: {
                  $sum: { $cond: [{ $eq: ["$rating", "positive"] }, 1, 0] },
                },
                negative: {
                  $sum: { $cond: [{ $eq: ["$rating", "negative"] }, 1, 0] },
                },
              },
            },
          ])
          .toArray(),
        feedback
          .find(feedbackFilter, {
            projection: {
              _id: 0,
              channel_name: 1,
              comment: 1,
              conversation_id: 1,
              created_at: 1,
              rating: 1,
              slack_permalink: 1,
              source: 1,
              value: 1,
            },
          })
          .sort({ created_at: -1 })
          .limit(10)
          .toArray(),
      ]);

    const feedbackSummary = feedbackStats[0] ?? {
      total: 0,
      positive: 0,
      negative: 0,
    };
    if (!user && totalConversations === 0 && feedbackSummary.total === 0) {
      throw new ApiError("User not found", 404, "USER_NOT_FOUND");
    }

    const firstConversation = recentConversations[0];
    const inferredSource = firstConversation
      ? conversationSource(firstConversation)
      : /^[UW][A-Z0-9]+$/.test(identity)
        ? "slack"
        : "web";

    return successResponse({
      profile: {
        email: user?.email ?? (identity.includes("@") ? normalizedIdentity : ""),
        name:
          user?.name ||
          firstConversation?.metadata?.owner_display_name ||
          identity,
        avatar_url: user?.avatar_url ?? null,
        role: user?.metadata?.role ?? "user",
        source: user?.source ?? inferredSource,
        slack_user_id:
          user?.slack_user_id ?? (/^[UW][A-Z0-9]+$/.test(identity) ? identity : null),
        created_at: dateString(user?.created_at),
        last_login: dateString(user?.last_login),
      },
      stats: {
        total_conversations: totalConversations,
        feedback_given: Number(feedbackSummary.total ?? 0),
        feedback_positive: Number(feedbackSummary.positive ?? 0),
        feedback_negative: Number(feedbackSummary.negative ?? 0),
      },
      recent_conversations: recentConversations.map((conversation) => ({
        id: String(conversation._id ?? ""),
        title: conversation.title || "Untitled",
        source: conversationSource(conversation),
        channel_id:
          conversation.channel_id ??
          conversation.metadata?.channel_id ??
          conversation.slack_meta?.channel_id ??
          null,
        channel_name:
          conversation.channel_name ??
          conversation.metadata?.channel_name ??
          conversation.slack_meta?.channel_name ??
          null,
        created_at: dateString(conversation.created_at),
        updated_at: dateString(conversation.updated_at),
      })),
      recent_feedback: recentFeedback.map((entry) => ({
        source: entry.source || "web",
        rating: entry.rating || "",
        value: entry.value || "",
        comment: entry.comment ?? null,
        channel_name: entry.channel_name ?? null,
        conversation_id: entry.conversation_id ?? null,
        slack_permalink: entry.slack_permalink ?? null,
        created_at: dateString(entry.created_at),
      })),
    });
  }
);
