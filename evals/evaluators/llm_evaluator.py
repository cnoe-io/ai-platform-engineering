"""
LLM-based trajectory evaluator for behavior analysis.
"""
import json
import logging
import re
from typing import List, Dict, Any, Optional
from langchain_core.language_models import BaseLanguageModel
from langchain_core.prompts import ChatPromptTemplate

from .base import BaseEvaluator
from ..models.trajectory import Trajectory, EvaluationResult

logger = logging.getLogger(__name__)


class LLMTrajectoryEvaluator(BaseEvaluator):
    """LLM-based evaluator that analyzes trajectory behavior against expectations."""
    
    def __init__(self, llm: BaseLanguageModel):
        self.llm = llm
        self.evaluation_prompt = self._create_evaluation_prompt()
    
    async def evaluate(
        self,
        trajectory: Trajectory,
        expected_agents: List[str],
        expected_behavior: str,
        dataset_item_id: str
    ) -> EvaluationResult:
        """
        Evaluate trajectory using LLM to analyze behavior match.
        """
        try:
            logger.info(f"LLM evaluating trajectory for item {dataset_item_id}")
            
            # Format trajectory for LLM analysis
            trajectory_summary = self._format_trajectory(trajectory)
            
            # Create evaluation prompt
            prompt_input = {
                "expected_behavior": expected_behavior,
                "expected_agents": expected_agents,
                "trajectory_summary": trajectory_summary,
                "actual_agents": trajectory.agents_used
            }
            
            # Get LLM evaluation
            llm_response = await self.llm.ainvoke(
                self.evaluation_prompt.format_messages(**prompt_input)
            )
            
            # Parse LLM response
            evaluation_data = self._parse_llm_response(llm_response.content)
            
            # Calculate simple trajectory score (agent matching)
            trajectory_score = self._calculate_agent_match_score(
                trajectory.agents_used, expected_agents
            )
            
            return EvaluationResult(
                trace_id=trajectory.trace_id,
                dataset_item_id=dataset_item_id,
                trajectory_match_score=trajectory_score,
                behavior_match_score=evaluation_data["behavior_score"],
                reasoning=evaluation_data["reasoning"],
                expected_agents=expected_agents,
                actual_agents=trajectory.agents_used,
                execution_time_ms=trajectory.total_duration_ms,
                success=True
            )
            
        except Exception as e:
            logger.error(f"Failed to LLM evaluate trajectory for item {dataset_item_id}: {e}")
            
            # Fallback to simple evaluation
            trajectory_score = self._calculate_agent_match_score(
                trajectory.agents_used, expected_agents
            )
            
            return EvaluationResult(
                trace_id=trajectory.trace_id,
                dataset_item_id=dataset_item_id,
                trajectory_match_score=trajectory_score,
                behavior_match_score=0.0,
                reasoning=f"LLM evaluation failed, used simple matching: {str(e)}",
                expected_agents=expected_agents,
                actual_agents=trajectory.agents_used,
                execution_time_ms=trajectory.total_duration_ms,
                success=False,
                error_message=str(e)
            )
    
    def _create_evaluation_prompt(self) -> ChatPromptTemplate:
        """Create the LLM evaluation prompt template."""
        
        template = """You are evaluating whether an AI system's actual behavior matches the expected behavior for a multi-agent task.

Expected Behavior:
{expected_behavior}

Expected Agents: {expected_agents}

Actual Agents Used: {actual_agents}

Actual Trajectory (what actually happened):
{trajectory_summary}

Please evaluate how well the actual trajectory matches the expected behavior. Consider:
1. Were the expected agents used?
2. Did the agents perform the expected actions?
3. Was the sequence/order appropriate?
4. Were any important steps missing?
5. Were there any unexpected or unnecessary actions?

Provide your evaluation in this exact JSON format:
{{
    "behavior_score": <float between 0.0 and 1.0>,
    "reasoning": "<detailed explanation of your evaluation>",
    "missing_steps": ["<list of missing expected steps>"],
    "unexpected_actions": ["<list of unexpected actions taken>"],
    "sequence_issues": "<any issues with the order of actions>"
}}

Make sure your response is valid JSON."""
        
        return ChatPromptTemplate.from_template(template)
    
    def _format_trajectory(self, trajectory: Trajectory) -> str:
        """Format trajectory into human-readable summary for LLM."""
        if not trajectory.tool_calls:
            return "No tool calls were made."
        
        summary_parts = []
        
        for i, tool_call in enumerate(trajectory.tool_calls, 1):
            step = f"{i}. {tool_call.agent_name} agent"
            
            if tool_call.tool_name:
                step += f" used tool '{tool_call.tool_name}'"
            
            if tool_call.parameters:
                # Summarize parameters without exposing sensitive data
                param_summary = self._summarize_parameters(tool_call.parameters)
                if param_summary:
                    step += f" with parameters: {param_summary}"
            
            if tool_call.output_data:
                output_summary = self._summarize_output(tool_call.output_data)
                if output_summary:
                    step += f" → {output_summary}"
            
            if not tool_call.success and tool_call.error_message:
                step += f" [FAILED: {tool_call.error_message}]"
            
            summary_parts.append(step)
        
        return "\n".join(summary_parts)
    
    def _summarize_parameters(self, parameters: Dict[str, Any]) -> str:
        """Summarize parameters safely."""
        if not parameters:
            return ""
        
        # Extract key parameter names and types, avoid showing sensitive values
        param_info = []
        for key, value in parameters.items():
            if isinstance(value, str) and len(value) > 50:
                param_info.append(f"{key}=[{type(value).__name__} length {len(value)}]")
            else:
                param_info.append(f"{key}={type(value).__name__}")
        
        return "{" + ", ".join(param_info) + "}"
    
    def _summarize_output(self, output: Any) -> str:
        """Summarize output data safely."""
        if output is None:
            return "no output"
        
        if isinstance(output, str):
            if len(output) > 100:
                return f"text response ({len(output)} characters)"
            return f"'{output[:50]}...'" if len(output) > 50 else f"'{output}'"
        elif isinstance(output, (dict, list)):
            return f"{type(output).__name__} with {len(output)} items"
        else:
            return f"{type(output).__name__} result"
    
    def _parse_llm_response(self, response: str) -> Dict[str, Any]:
        """Parse LLM evaluation response."""
        try:
            # Try to extract JSON from response
            json_match = re.search(r'\{.*\}', response, re.DOTALL)
            if json_match:
                json_str = json_match.group()
                evaluation_data = json.loads(json_str)
                
                # Validate required fields
                if "behavior_score" not in evaluation_data:
                    raise ValueError("Missing behavior_score in LLM response")
                
                # Ensure score is in valid range
                score = float(evaluation_data["behavior_score"])
                evaluation_data["behavior_score"] = max(0.0, min(1.0, score))
                
                # Provide default reasoning if missing
                if "reasoning" not in evaluation_data:
                    evaluation_data["reasoning"] = "LLM evaluation completed"
                
                return evaluation_data
            else:
                raise ValueError("No JSON found in LLM response")
                
        except Exception as e:
            logger.warning(f"Failed to parse LLM response: {e}")
            logger.debug(f"LLM response was: {response}")
            
            # Fallback: try to extract score from text
            score_match = re.search(r'score[:\s]+([0-9]*\.?[0-9]+)', response.lower())
            score = 0.5  # Default middle score
            if score_match:
                try:
                    score = float(score_match.group(1))
                    score = max(0.0, min(1.0, score))
                except:
                    pass
            
            return {
                "behavior_score": score,
                "reasoning": f"Failed to parse detailed LLM evaluation. Raw response: {response[:200]}..."
            }
    
    def _calculate_agent_match_score(
        self, 
        actual_agents: List[str], 
        expected_agents: List[str]
    ) -> float:
        """Calculate simple agent matching score."""
        if not expected_agents:
            return 1.0
        
        if not actual_agents:
            return 0.0
        
        expected_set = set(expected_agents)
        actual_set = set(actual_agents)
        
        matched = len(expected_set.intersection(actual_set))
        total_expected = len(expected_set)
        
        return matched / total_expected