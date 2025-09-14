"""
Routing evaluator for assessing supervisor-to-agent routing decisions.
"""
import json
import logging
import os
from typing import List, Dict, Any
from openai import OpenAI

from trace_analysis.extractor import TraceExtractor

logger = logging.getLogger(__name__)


class RoutingResult:
    """Result of routing evaluation."""

    def __init__(self, routing_score: float, routing_reasoning: str):
        self.routing_score = routing_score
        self.routing_reasoning = routing_reasoning


class RoutingEvaluator:
    """
    Evaluates supervisor-to-agent routing decisions using OpenAI GPT-4.

    Focuses specifically on routing correctness:
    - Did the supervisor route to the appropriate specialized agent for the task?
    - Are routing decisions logical given the user's request?
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

    def evaluate(self, trace_id: str, user_prompt: str, expected_agents: list = None) -> RoutingResult:
        """
        Evaluate routing quality for a trace.

        Args:
            trace_id: Langfuse trace ID to evaluate
            user_prompt: Original user request
            expected_agents: List of expected agents that should handle this request

        Returns:
            RoutingResult with routing score and reasoning
        """
        try:
            logger.info(f"Evaluating routing for trace {trace_id}")

            # Extract all tool calls from the trace
            all_tool_calls = self.extractor.extract_tool_calls(trace_id)

            # Filter to only routing calls (supervisor → agent)
            routing_calls = [call for call in all_tool_calls if call.get('type') == 'routing']

            if not routing_calls:
                logger.info(f"No routing calls found in trace {trace_id}")
                return RoutingResult(
                    routing_score=1.0,  # No routing decisions, so no errors
                    routing_reasoning="No routing calls found in trace - no routing decisions to evaluate"
                )

            # Format trajectory for LLM evaluation
            trajectory_summary = self.format_routing_trajectory(routing_calls)
            logger.info(f"Routing trajectory for {trace_id}:\n{trajectory_summary}")

            # Get LLM evaluation
            evaluation = self.get_llm_evaluation(user_prompt, trajectory_summary, expected_agents)

            return RoutingResult(
                routing_score=evaluation["routing_score"],
                routing_reasoning=evaluation["routing_reasoning"]
            )

        except Exception as e:
            logger.error(f"Failed to evaluate routing for trace {trace_id}: {e}")
            return RoutingResult(
                routing_score=0.0,
                routing_reasoning=f"Routing evaluation failed: {str(e)}"
            )

    def format_routing_trajectory(self, routing_calls: List[Dict[str, Any]]) -> str:
        """
        Format routing calls into a readable trajectory focusing on supervisor-to-agent routing.

        Args:
            routing_calls: List of routing calls (filtered to type='routing' only)

        Returns:
            Human readable routing trajectory
        """
        if not routing_calls:
            return "No routing decisions made"

        lines = []
        for i, call in enumerate(routing_calls, 1):
            agent = call.get('agent', 'unknown')
            tool = call.get('tool', 'unknown')  # This is actually the target agent for routing calls
            lines.append(f"{i}. {agent} → {tool}")

        return "\n".join(lines)

    def get_llm_evaluation(self, user_prompt: str, trajectory_summary: str, expected_agents: list = None) -> Dict[str, Any]:
        """
        Get LLM evaluation of routing quality.

        Args:
            user_prompt: Original user request
            trajectory_summary: Formatted routing trajectory
            expected_agents: List of expected agents that should handle this request

        Returns:
            Dictionary with routing_score and routing_reasoning
        """
        if expected_agents:
            expectation_context = f"""
The following agents are expected to handle this request: {', '.join(expected_agents)}

Evaluate whether the supervisor routed to one of these expected agents."""
        else:
            expectation_context = """
Evaluate based on semantic alignment between the request and the chosen agent.
The agent name should match the domain of the user's request."""

        evaluation_prompt = f"""You are evaluating a multi-agent system's routing decisions.

User Request: {user_prompt}

Routing Decisions (Supervisor → Agent):
{trajectory_summary}

{expectation_context}

Return your evaluation in this exact JSON format:
{{
    "routing_score": <float between 0.0 and 1.0>,
    "routing_reasoning": "<explain whether the routing matches the expected agents or makes semantic sense>"
}}

Focus only on supervisor routing correctness. Provide specific reasoning about which routing decisions were good or bad."""

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

            # Validate and clamp score
            result["routing_score"] = max(0.0, min(1.0, float(result.get("routing_score", 0.0))))

            # Ensure reasoning exists
            if not result.get("routing_reasoning"):
                result["routing_reasoning"] = f"Routing score: {result['routing_score']:.2f}"

            logger.info(f"Routing LLM evaluation completed: score={result['routing_score']:.2f}")
            return result

        except Exception as e:
            logger.error(f"Routing LLM evaluation failed: {e}")
            return {
                "routing_score": 0.0,
                "routing_reasoning": f"LLM evaluation failed: {str(e)}"
            }