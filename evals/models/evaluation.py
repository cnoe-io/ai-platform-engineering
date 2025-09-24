"""
Evaluation data models for routing and tool match evaluation.
"""
from pydantic import BaseModel, Field
from typing import Optional


class RoutingResult(BaseModel):
    """Result of routing evaluation (supervisor-to-agent decisions)."""

    routing_score: float = Field(..., ge=0.0, le=1.0, description="Was routing from supervisor to agent correct?")
    routing_reasoning: str = Field(..., description="Explanation of the routing score")


class ToolMatchResult(BaseModel):
    """Result of tool match evaluation (agent-to-tool alignment)."""

    tool_match_score: float = Field(..., ge=0.0, le=1.0, description="Did agents use appropriate tools for their domain?")
    tool_match_reasoning: str = Field(..., description="Explanation of the tool match score")


class EvaluationResult(BaseModel):
    """Combined result of evaluating a trace for routing and tool match quality."""

    trace_id: str
    routing_score: float = Field(..., ge=0.0, le=1.0, description="Was routing from supervisor to agent correct?")
    tool_match_score: float = Field(..., ge=0.0, le=1.0, description="Did agents use appropriate tools?")
    routing_reasoning: str = Field(..., description="Explanation of the routing score")
    tool_match_reasoning: str = Field(..., description="Explanation of the tool match score")
    user_prompt: str = Field(..., description="Original user request that was evaluated")
    trajectory_summary: str = Field(..., description="Human readable trajectory summary")
    success: bool = True
    error_message: Optional[str] = None

    @classmethod
    def from_separate_results(
        cls,
        trace_id: str,
        user_prompt: str,
        trajectory_summary: str,
        routing_result: RoutingResult,
        tool_match_result: ToolMatchResult,
        success: bool = True,
        error_message: Optional[str] = None
    ) -> "EvaluationResult":
        """Create EvaluationResult from separate routing and tool match results."""
        return cls(
            trace_id=trace_id,
            routing_score=routing_result.routing_score,
            tool_match_score=tool_match_result.tool_match_score,
            routing_reasoning=routing_result.routing_reasoning,
            tool_match_reasoning=tool_match_result.tool_match_reasoning,
            user_prompt=user_prompt,
            trajectory_summary=trajectory_summary,
            success=success,
            error_message=error_message
        )

    def __str__(self) -> str:
        """Human readable representation."""
        return f"""Evaluation Result for {self.trace_id}:
  Routing Score: {self.routing_score:.2f} - {self.routing_reasoning}
  Tool Match Score: {self.tool_match_score:.2f} - {self.tool_match_reasoning}"""