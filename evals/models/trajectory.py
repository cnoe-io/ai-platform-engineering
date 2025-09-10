"""
Trajectory and tool call models for evaluation.
"""
from typing import List, Any, Dict, Optional
from pydantic import BaseModel, Field
from datetime import datetime


class ToolCall(BaseModel):
    """Represents a single tool call in a trajectory."""
    agent_name: str = Field(description="Name of the agent that made the tool call")
    tool_name: Optional[str] = Field(default=None, description="Name of the tool called")
    parameters: Dict[str, Any] = Field(default_factory=dict, description="Parameters passed to the tool")
    input_data: Optional[Any] = Field(default=None, description="Input data for the tool call")
    output_data: Optional[Any] = Field(default=None, description="Output data from the tool call")
    timestamp: Optional[datetime] = Field(default=None, description="When the tool call was made")
    duration_ms: Optional[float] = Field(default=None, description="Duration of the tool call in milliseconds")
    success: bool = Field(default=True, description="Whether the tool call was successful")
    error_message: Optional[str] = Field(default=None, description="Error message if call failed")


class Trajectory(BaseModel):
    """Complete trajectory of tool calls for an evaluation."""
    trace_id: str = Field(description="Langfuse trace ID")
    tool_calls: List[ToolCall] = Field(description="List of tool calls in order")
    total_duration_ms: Optional[float] = Field(default=None, description="Total execution time")
    agents_used: List[str] = Field(default_factory=list, description="List of unique agents used")
    success: bool = Field(default=True, description="Whether the overall execution was successful")
    
    def model_post_init(self, __context):
        """Post-initialization to compute derived fields."""
        # Extract unique agents
        self.agents_used = list(set(call.agent_name for call in self.tool_calls))
        
        # Compute total duration
        if not self.total_duration_ms and self.tool_calls:
            self.total_duration_ms = sum(
                call.duration_ms for call in self.tool_calls 
                if call.duration_ms is not None
            )
        
        # Check overall success
        self.success = all(call.success for call in self.tool_calls)


class EvaluationResult(BaseModel):
    """Result of evaluating a trajectory."""
    trace_id: str = Field(description="Langfuse trace ID")
    dataset_item_id: str = Field(description="ID of the dataset item evaluated")
    trajectory_match_score: float = Field(description="Score for trajectory matching (0-1)")
    behavior_match_score: float = Field(description="Score for behavior matching (0-1)")
    overall_score: float = Field(default=0.0, description="Overall evaluation score (0-1)")
    reasoning: str = Field(description="Explanation of the evaluation")
    expected_agents: List[str] = Field(description="Agents that were expected")
    actual_agents: List[str] = Field(description="Agents that were actually used")
    missing_agents: List[str] = Field(default_factory=list, description="Expected agents not used")
    unexpected_agents: List[str] = Field(default_factory=list, description="Unexpected agents used")
    execution_time_ms: Optional[float] = Field(default=None, description="Total execution time")
    success: bool = Field(description="Whether the evaluation was successful")
    error_message: Optional[str] = Field(default=None, description="Error message if evaluation failed")
    
    def model_post_init(self, __context):
        """Post-initialization to compute derived fields."""
        # Compute missing and unexpected agents
        expected_set = set(self.expected_agents)
        actual_set = set(self.actual_agents)
        
        self.missing_agents = list(expected_set - actual_set)
        self.unexpected_agents = list(actual_set - expected_set)
        
        # Compute overall score (average of trajectory and behavior scores)
        self.overall_score = (self.trajectory_match_score + self.behavior_match_score) / 2.0