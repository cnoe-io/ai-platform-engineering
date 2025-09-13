"""
Simple LLM-based evaluator for routing and tool match quality.
"""
import json
import logging
import os
from typing import List, Dict, Any
from openai import OpenAI

from models.evaluation import EvaluationResult
from trace_analysis.extractor import TraceExtractor

logger = logging.getLogger(__name__)


class RoutingEvaluator:
    """
    Evaluates agent routing and tool selection quality using OpenAI GPT-4.

    Focuses on two simple metrics:
    1. Routing Score: Did the supervisor route to the correct agent?
    2. Tool Match Score: Did agents use appropriate tools for their domain?
    """

    def __init__(self, trace_extractor: TraceExtractor, openai_api_key: str = None):
        """
        Initialize the routing evaluator.

        Args:
            trace_extractor: TraceExtractor instance for getting tool calls
            openai_api_key: OpenAI API key. If None, will read from OPENAI_API_KEY env var
        """
        self.extractor = trace_extractor

        api_key = openai_api_key or os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise ValueError("OpenAI API key must be provided via parameter or OPENAI_API_KEY env var")

        self.client = OpenAI(api_key=api_key)
        logger.info("RoutingEvaluator initialized with OpenAI client")

    def evaluate(self, trace_id: str, user_prompt: str) -> EvaluationResult:
        """
        Evaluate routing and tool match quality for a trace.

        Args:
            trace_id: Langfuse trace ID to evaluate
            user_prompt: Original user request

        Returns:
            EvaluationResult with routing and tool match scores
        """
        try:
            logger.info(f"Evaluating trace {trace_id}")

            # Extract tool calls from the trace
            tool_calls = self.extractor.extract_tool_calls(trace_id)

            if not tool_calls:
                return EvaluationResult(
                    trace_id=trace_id,
                    routing_score=0.0,
                    tool_match_score=0.0,
                    overall_score=0.0,
                    reasoning="No tool calls found in trace",
                    user_prompt=user_prompt,
                    trajectory_summary="No actions taken",
                    success=False,
                    error_message="No tool calls found"
                )

            # Format trajectory for LLM evaluation
            trajectory_summary = self.format_trajectory(tool_calls)

            # Get LLM evaluation
            evaluation = self.get_llm_evaluation(user_prompt, trajectory_summary)

            return EvaluationResult(
                trace_id=trace_id,
                routing_score=evaluation["routing_score"],
                tool_match_score=evaluation["tool_match_score"],
                overall_score=0.0,  # Will be calculated in __post_init__
                reasoning=evaluation["reasoning"],
                user_prompt=user_prompt,
                trajectory_summary=trajectory_summary,
                success=True
            )

        except Exception as e:
            logger.error(f"Failed to evaluate trace {trace_id}: {e}")
            return EvaluationResult(
                trace_id=trace_id,
                routing_score=0.0,
                tool_match_score=0.0,
                overall_score=0.0,
                reasoning=f"Evaluation failed: {str(e)}",
                user_prompt=user_prompt,
                trajectory_summary="",
                success=False,
                error_message=str(e)
            )

    def format_trajectory(self, tool_calls: List[Dict[str, Any]]) -> str:
        """
        Format tool calls into a readable trajectory summary.

        Args:
            tool_calls: List of tool calls from TraceExtractor

        Returns:
            Human readable trajectory string
        """
        if not tool_calls:
            return "No actions taken"

        lines = []
        for i, call in enumerate(tool_calls, 1):
            agent = call.get('agent', 'unknown')
            tool = call.get('tool', 'unknown')
            lines.append(f"{i}. {agent} → {tool}")

        return "\n".join(lines)

    def get_llm_evaluation(self, user_prompt: str, trajectory_summary: str) -> Dict[str, Any]:
        """
        Get LLM evaluation of routing and tool match quality.

        Args:
            user_prompt: Original user request
            trajectory_summary: Formatted trajectory

        Returns:
            Dictionary with routing_score, tool_match_score, and reasoning
        """
        evaluation_prompt = f"""You are evaluating a multi-agent system's routing and tool selection quality.

User Request: {user_prompt}

Agent Trajectory:
{trajectory_summary}

Evaluate ONLY these two aspects:

1. **Routing Quality**: Did the supervisor correctly route to the appropriate specialized agent for this type of request?
   - Consider: Does the task require GitHub operations → github_agent, Slack operations → slack_agent, etc.

2. **Tool Match Quality**: Did each agent use appropriate tools that match their domain/responsibility?
   - Consider: github_agent should use GitHub tools, slack_agent should use Slack tools, etc.

Return your evaluation in this exact JSON format:
{{
    "routing_score": <float between 0.0 and 1.0>,
    "tool_match_score": <float between 0.0 and 1.0>,
    "reasoning": "<brief explanation of both scores in 1-2 sentences>"
}}

Focus only on routing correctness and agent-tool alignment. Do not evaluate other aspects."""

        try:
            response = self.client.chat.completions.create(
                model="gpt-4",
                messages=[
                    {
                        "role": "system",
                        "content": "You are an expert at evaluating multi-agent routing decisions. Always respond with valid JSON format only."
                    },
                    {
                        "role": "user",
                        "content": evaluation_prompt
                    }
                ],
                temperature=0.1  # Low temperature for consistent evaluations
            )

            content = response.choices[0].message.content.strip()

            # Try to extract JSON if it's wrapped in text
            import re
            json_match = re.search(r'\{.*\}', content, re.DOTALL)
            if json_match:
                content = json_match.group()

            result = json.loads(content)

            # Validate and clamp scores
            result["routing_score"] = max(0.0, min(1.0, float(result.get("routing_score", 0.0))))
            result["tool_match_score"] = max(0.0, min(1.0, float(result.get("tool_match_score", 0.0))))

            # Ensure reasoning exists
            if not result.get("reasoning"):
                result["reasoning"] = "LLM evaluation completed"

            logger.info(f"LLM evaluation completed: routing={result['routing_score']:.2f}, tools={result['tool_match_score']:.2f}")
            return result

        except Exception as e:
            logger.error(f"LLM evaluation failed: {e}")
            return {
                "routing_score": 0.0,
                "tool_match_score": 0.0,
                "reasoning": f"LLM evaluation failed: {str(e)}"
            }