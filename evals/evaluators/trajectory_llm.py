"""
Trajectory LLM evaluator that combines simple agent matching with optional LLM-based behavior analysis.
"""
import json
import logging
import re
from typing import List, Dict, Any, Optional
from langchain_core.language_models import BaseLanguageModel
from langchain_core.prompts import ChatPromptTemplate

from evaluators.base import BaseEvaluator
from models.trajectory import Trajectory, EvaluationResult

logger = logging.getLogger(__name__)


class TrajectoryLLMEvaluator(BaseEvaluator):
    """
    Trajectory LLM evaluator that always provides simple agent matching with optional LLM enhancement.
    
    Features:
    - Always calculates trajectory score based on agent matching (fast, reliable baseline)
    - Optionally enhances with LLM-based behavior analysis when LLM is configured
    - Graceful degradation: if LLM fails, still returns agent matching results
    - Single evaluator that adapts based on available resources
    """
    
    def __init__(self, llm: Optional[BaseLanguageModel] = None):
        """
        Initialize the trajectory LLM evaluator.
        
        Args:
            llm: Optional language model for enhanced behavior analysis.
                 If None, only simple agent matching will be performed.
        """
        self.llm = llm
        self.evaluation_prompt = self._create_evaluation_prompt() if llm else None
        
        if llm:
            logger.info("Trajectory LLM evaluator initialized with LLM enhancement enabled")
        else:
            logger.info("Trajectory LLM evaluator initialized with simple agent matching only")
    
    async def evaluate(
        self,
        trajectory: Trajectory,
    expected_agents: List[str],
        expected_behavior: str,
        dataset_item_id: str
    ) -> EvaluationResult:
        """
        Evaluate trajectory using trajectory LLM approach.
        
        Always calculates:
        - Trajectory match score (agent matching)
        
        Optionally calculates (when LLM available):
        - Behavior match score (LLM-based semantic analysis)
        
        Gracefully falls back to simple evaluation if LLM fails.
        """
        try:
            logger.info(f"Trajectory LLM evaluator processing item {dataset_item_id}")
            
            # Always calculate trajectory score (agent matching) - this is our reliable baseline
            trajectory_score = self._calculate_agent_match_score(
                trajectory.agents_used, expected_agents
            )
            
            # Generate base reasoning from agent matching
            base_reasoning = self._generate_base_reasoning(
                trajectory.agents_used, expected_agents, trajectory_score
            )
            
            # Initialize behavior score and reasoning
            behavior_score = trajectory_score  # Default to same as trajectory score
            final_reasoning = base_reasoning
            
            # Try to enhance with LLM analysis if available
            if self.llm and expected_behavior.strip():
                try:
                    logger.info(f"Enhancing evaluation with LLM analysis for item {dataset_item_id}")
                    llm_result = await self._perform_llm_analysis(
                        trajectory, expected_agents, expected_behavior
                    )
                    
                    behavior_score = llm_result["behavior_score"]
                    llm_analysis = self._format_llm_analysis(llm_result)
                    final_reasoning = f"{base_reasoning}{llm_analysis}"
                    
                    logger.info(f"LLM enhancement successful for item {dataset_item_id}")
                    
                except Exception as e:
                    logger.warning(f"LLM analysis failed for item {dataset_item_id}, using simple evaluation: {e}")
                    # Keep the simple scores and reasoning - graceful degradation
            
            return EvaluationResult(
                trace_id=trajectory.trace_id,
                dataset_item_id=dataset_item_id,
                trajectory_match_score=trajectory_score,
                behavior_match_score=behavior_score,
                reasoning=final_reasoning,
                expected_agents=expected_agents,
                actual_agents=trajectory.agents_used,
                execution_time_ms=trajectory.total_duration_ms,
                success=True
            )
            
        except Exception as e:
            logger.error(f"Unified evaluation failed for item {dataset_item_id}: {e}")
            
            return EvaluationResult(
                trace_id=trajectory.trace_id,
                dataset_item_id=dataset_item_id,
                trajectory_match_score=0.0,
                behavior_match_score=0.0,
                reasoning=f"Evaluation failed: {str(e)}",
                expected_agents=expected_agents,
                actual_agents=[],
                execution_time_ms=trajectory.total_duration_ms,
                success=False,
                error_message=str(e)
            )
    
    async def _perform_llm_analysis(
        self,
        trajectory: Trajectory,
        expected_agents: List[str],
        expected_behavior: str
    ) -> Dict[str, Any]:
        """Perform LLM-based behavior analysis."""
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
        return self._parse_llm_response(llm_response.content)
    
    def _calculate_agent_match_score(
        self, 
        actual_agents: List[str], 
        expected_agents: List[str]
    ) -> float:
        """Calculate simple agent matching score."""
        if not expected_agents:
            return 1.0  # No expectations, so perfect score
        
        if not actual_agents:
            return 0.0  # Expected agents but none used
        
        # Calculate proportion of expected agents that were used
        expected_set = set(expected_agents)
        actual_set = set(actual_agents)
        
        matched = len(expected_set.intersection(actual_set))
        total_expected = len(expected_set)
        
        return matched / total_expected
    
    def _generate_base_reasoning(
        self,
        actual_agents: List[str],
        expected_agents: List[str], 
        score: float
    ) -> str:
        """Generate detailed human-readable reasoning for the agent matching score."""
        expected_set = set(expected_agents)
        actual_set = set(actual_agents)
        
        matched = expected_set.intersection(actual_set)
        missing = expected_set - actual_set
        unexpected = actual_set - expected_set
        
        reasoning_parts = []
        reasoning_parts.append("=== Agent Matching Analysis ===")
        reasoning_parts.append(f"Expected agents: {expected_agents}")
        reasoning_parts.append(f"Actual agents: {actual_agents}")
        reasoning_parts.append(f"Agent match score: {score:.2f}")
        
        if matched:
            reasoning_parts.append(f"✓ Matched agents: {sorted(list(matched))}")
        
        if missing:
            reasoning_parts.append(f"✗ Missing agents: {sorted(list(missing))}")
        
        if unexpected:
            reasoning_parts.append(f"⚠ Unexpected agents: {sorted(list(unexpected))}")
        
        # Add assessment summary
        if score == 1.0:
            if not unexpected:
                reasoning_parts.append("Assessment: Perfect match - all expected agents used, no unexpected agents")
            else:
                reasoning_parts.append("Assessment: All expected agents used, but additional agents were also invoked")
        elif score >= 0.8:
            reasoning_parts.append("Assessment: Good match - most expected agents used")
        elif score >= 0.5:
            reasoning_parts.append("Assessment: Partial match - some expected agents used")
        elif score > 0.0:
            reasoning_parts.append("Assessment: Poor match - few expected agents used")
        else:
            reasoning_parts.append("Assessment: No match - none of the expected agents were used")
        
        return "\n".join(reasoning_parts)
    
    def _format_llm_analysis(self, llm_result: Dict[str, Any]) -> str:
        """Format LLM analysis results into readable structure."""
        analysis_parts = []
        analysis_parts.append("\n=== LLM Behavior Analysis ===")
        
        # Behavior score
        behavior_score = llm_result.get("behavior_score", 0.0)
        analysis_parts.append(f"Behavior Score: {behavior_score:.2f}")
        
        # Main reasoning
        reasoning = llm_result.get("reasoning", "No reasoning provided")
        analysis_parts.append(f"Assessment: {reasoning}")
        
        # Missing steps
        missing_steps = llm_result.get("missing_steps", [])
        if missing_steps:
            analysis_parts.append(f"Missing Steps: {missing_steps}")
        else:
            analysis_parts.append("Missing Steps: None")
        
        # Unexpected actions
        unexpected_actions = llm_result.get("unexpected_actions", [])
        if unexpected_actions:
            analysis_parts.append(f"Unexpected Actions: {unexpected_actions}")
        else:
            analysis_parts.append("Unexpected Actions: None")
        
        # Sequence issues
        sequence_issues = llm_result.get("sequence_issues", "")
        if sequence_issues and sequence_issues.lower() not in ["none", "no issues", ""]:
            analysis_parts.append(f"Sequence Issues: {sequence_issues}")
        else:
            analysis_parts.append("Sequence Issues: None")
        
        return "\n".join(analysis_parts)
    
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