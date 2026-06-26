/**
 * Public surface of the reusable AI Review module.
 *
 * Consumers (DynamicAgentEditor, SkillWorkspace, future templates) should
 * import everything they need from here so internal file moves stay free.
 */

export { buildLastReview,useAiReview } from "./use-ai-review";
export { buildBlockingMessage } from "./blocking-message";
export type {
AiReviewStatus,
UseAiReviewArgs,
UseAiReviewResult
} from "./use-ai-review";

export { AiReviewButton } from "./AiReviewButton";
export type { AiReviewButtonProps } from "./AiReviewButton";

export { AiReviewPanel } from "./AiReviewPanel";
export type { AiReviewPanelProps } from "./AiReviewPanel";

export { CommentCard } from "./CommentCard";
export type { CommentCardProps } from "./CommentCard";

export { Grade } from "./Grade";
export type { GradeProps } from "./Grade";

export { LastReviewBadge } from "./LastReviewBadge";
export type { LastReviewBadgeProps } from "./LastReviewBadge";

export { applyFix } from "./apply-fix";
export { sha256Hex } from "./hash";

// Re-export wire-format types from the locked contract for consumer convenience.
export { DEFAULT_GRADE_THRESHOLDS } from "@/types/ai-review";
export type {
CriterionVerdict,
GradeThresholds,
LastReview,
ReviewAnchor,
ReviewConfig,
ReviewConfigUpdate,
ReviewContext,
ReviewCriterion,
ReviewEnforcement,
ReviewGrade,
ReviewRequest,
ReviewResult,
ReviewSeverity,
SuggestedFix
} from "@/types/ai-review";
