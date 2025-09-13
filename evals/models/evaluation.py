"""
Simple evaluation data models for routing and tool match evaluation.
"""
from pydantic import BaseModel, Field, computed_field
from typing import Optional


class EvaluationResult(BaseModel):
    """Result of evaluating a trace for routing and tool match quality."""

    trace_id: str
    routing_score: float = Field(..., ge=0.0, le=1.0, description="Was routing from supervisor to agent correct?")
    tool_match_score: float = Field(..., ge=0.0, le=1.0, description="Did agents use appropriate tools?")
    routing_reasoning: str = Field(..., description="Explanation of the routing score")
    tool_match_reasoning: str = Field(..., description="Explanation of the tool match score")
    user_prompt: str = Field(..., description="Original user request that was evaluated")
    trajectory_summary: str = Field(..., description="Human readable trajectory summary")
    success: bool = True
    error_message: Optional[str] = None

    def __str__(self) -> str:
        """Human readable representation."""
        return f"""Evaluation Result for {self.trace_id}:
  Routing Score: {self.routing_score:.2f} - {self.routing_reasoning}
  Tool Match Score: {self.tool_match_score:.2f} - {self.tool_match_reasoning}"""