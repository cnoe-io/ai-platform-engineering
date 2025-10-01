"""
Tool match evaluator for assessing if agents use appropriate tools for their domain.
"""
import json
import logging
import os
from typing import List, Dict, Any
from openai import OpenAI

from trace_analysis.extractor import TraceExtractor

logger = logging.getLogger(__name__)


class ToolMatchResult:
    """Result of tool match evaluation."""

    def __init__(self, tool_match_score: float, tool_match_reasoning: str):
        self.tool_match_score = tool_match_score
        self.tool_match_reasoning = tool_match_reasoning


class ToolMatchEvaluator:
    """
    Evaluates whether agents use appropriate tools that match their domain/responsibility.

    Focuses specifically on agent-to-tool alignment:
    - Does the github agent use GitHub tools?
    - Does the slack agent use Slack tools?
    - Are tools being used by the correct specialized agents?
    """

    def __init__(self, trace_extractor: TraceExtractor, openai_api_key: str = None):
        """
        Initialize the tool match evaluator.

        Args:
            trace_extractor: TraceExtractor instance for getting tool calls
            openai_api_key: OpenAI API key. If None, will read from OPENAI_API_KEY env var
        """
        self.extractor = trace_extractor

        api_key = openai_api_key or os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise ValueError("OpenAI API key must be provided via parameter or OPENAI_API_KEY env var")

        self.client = OpenAI(api_key=api_key)
        logger.info("ToolMatchEvaluator initialized with OpenAI client")

    def evaluate(self, trace_id: str, user_prompt: str, expected_behavior: str = None) -> ToolMatchResult:
        """
        Evaluate tool match quality for a trace.

        Args:
            trace_id: Langfuse trace ID to evaluate
            user_prompt: Original user request
            expected_behavior: Description of expected behavior from dataset

        Returns:
            ToolMatchResult with tool match score and reasoning
        """
        try:
            logger.info(f"Evaluating tool match for trace {trace_id}")

            # Extract all tool calls from the trace
            all_tool_calls = self.extractor.extract_tool_calls(trace_id)

            # Filter to only tool calls (not routing calls)
            tool_calls = [call for call in all_tool_calls if call.get('type') == 'tool']

            if not tool_calls:
                logger.info(f"No tool calls found in trace {trace_id}")
                return ToolMatchResult(
                    tool_match_score=1.0,  # No tools used, so no mismatches
                    tool_match_reasoning="No tool calls found in trace - no tool usage to evaluate"
                )

            # Format trajectory for LLM evaluation
            trajectory_summary = self.format_tool_trajectory(tool_calls)
            logger.info(f"Tool trajectory for {trace_id}:\n{trajectory_summary}")

            # Get LLM evaluation
            evaluation = self.get_llm_evaluation(user_prompt, trajectory_summary, expected_behavior)

            return ToolMatchResult(
                tool_match_score=evaluation["tool_match_score"],
                tool_match_reasoning=evaluation["tool_match_reasoning"]
            )

        except Exception as e:
            logger.error(f"Failed to evaluate tool match for trace {trace_id}: {e}")
            return ToolMatchResult(
                tool_match_score=0.0,
                tool_match_reasoning=f"Tool match evaluation failed: {str(e)}"
            )

    def format_tool_trajectory(self, tool_calls: List[Dict[str, Any]]) -> str:
        """
        Format tool calls into a readable trajectory focusing on agent-to-tool usage.

        Args:
            tool_calls: List of tool calls (filtered to type='tool' only)

        Returns:
            Human readable tool usage trajectory
        """
        if not tool_calls:
            return "No tools used"

        lines = []
        for i, call in enumerate(tool_calls, 1):
            agent = call.get('agent', 'unknown')
            tool = call.get('tool', 'unknown')
            lines.append(f"{i}. {agent} → {tool}")

        return "\n".join(lines)

    def get_llm_evaluation(self, user_prompt: str, trajectory_summary: str, expected_behavior: str = None) -> Dict[str, Any]:
        """
        Get LLM evaluation of tool match quality.

        Args:
            user_prompt: Original user request
            trajectory_summary: Formatted tool usage trajectory
            expected_behavior: Description of expected behavior from dataset

        Returns:
            Dictionary with tool_match_score and tool_match_reasoning
        """
        if expected_behavior:
            expectation_context = f"""
Expected Behavior: {expected_behavior}

Evaluate whether the tools used align with this expected behavior."""
        else:
            expectation_context = """
Evaluate whether each agent used tools appropriate for their domain/responsibility.
Consider whether the tools match the agent's specialization (e.g., GitHub agents should use GitHub tools)."""

        evaluation_prompt = f"""You are evaluating whether specialized agents used appropriate tools.

User Request: {user_prompt}

Tool Usage (Agent → Tool):
{trajectory_summary}

{expectation_context}

Return your evaluation in this exact JSON format:
{{
    "tool_match_score": <float between 0.0 and 1.0>,
    "tool_match_reasoning": "<explain whether the tools used match the expected behavior or agent domains>"
}}

Focus only on whether the right tools were used for the task. Provide specific reasoning about the appropriateness of tool choices."""

        try:
            response = self.client.chat.completions.create(
                model="gpt-4",
                messages=[
                    {
                        "role": "system",
                        "content": "You are an expert at evaluating agent-tool alignment in multi-agent systems. Always respond with valid JSON format only."
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

            # Validate and clamp score
            result["tool_match_score"] = max(0.0, min(1.0, float(result.get("tool_match_score", 0.0))))

            # Ensure reasoning exists
            if not result.get("tool_match_reasoning"):
                result["tool_match_reasoning"] = f"Tool match score: {result['tool_match_score']:.2f}"

            logger.info(f"Tool match LLM evaluation completed: score={result['tool_match_score']:.2f}")
            return result

        except Exception as e:
            logger.error(f"Tool match LLM evaluation failed: {e}")
            return {
                "tool_match_score": 0.0,
                "tool_match_reasoning": f"LLM evaluation failed: {str(e)}"
            }