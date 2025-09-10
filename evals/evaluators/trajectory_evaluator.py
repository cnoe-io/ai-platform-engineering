"""
Simple trajectory evaluator that matches agents used vs expected.
"""
import logging
from typing import List

from evaluators.base import BaseEvaluator
from models.trajectory import Trajectory, EvaluationResult

logger = logging.getLogger(__name__)


class SimpleTrajectoryEvaluator(BaseEvaluator):
    """Simple evaluator that matches agents used against expected agents."""
    
    async def evaluate(
        self,
        trajectory: Trajectory,
        expected_agents: List[str],
        expected_behavior: str,
        dataset_item_id: str
    ) -> EvaluationResult:
        """
        Evaluate trajectory by comparing actual agents used vs expected.
        
        Simple scoring:
        - Trajectory score: proportion of expected agents that were used
        - Behavior score: same as trajectory score (no LLM analysis)
        """
        try:
            logger.info(f"Evaluating trajectory for item {dataset_item_id}")
            
            # Get actual agents used
            actual_agents = trajectory.agents_used
            
            # Calculate trajectory match score
            trajectory_score = self._calculate_agent_match_score(
                actual_agents, expected_agents
            )
            
            # For simple evaluator, behavior score is same as trajectory score
            behavior_score = trajectory_score
            
            # Generate reasoning
            reasoning = self._generate_reasoning(
                actual_agents, expected_agents, trajectory_score
            )
            
            return EvaluationResult(
                trace_id=trajectory.trace_id,
                dataset_item_id=dataset_item_id,
                trajectory_match_score=trajectory_score,
                behavior_match_score=behavior_score,
                reasoning=reasoning,
                expected_agents=expected_agents,
                actual_agents=actual_agents,
                execution_time_ms=trajectory.total_duration_ms,
                success=True
            )
            
        except Exception as e:
            logger.error(f"Failed to evaluate trajectory for item {dataset_item_id}: {e}")
            
            return EvaluationResult(
                trace_id=trajectory.trace_id,
                dataset_item_id=dataset_item_id,
                trajectory_match_score=0.0,
                behavior_match_score=0.0,
                reasoning=f"Evaluation failed: {str(e)}",
                expected_agents=expected_agents,
                actual_agents=[],
                success=False,
                error_message=str(e)
            )
    
    def _calculate_agent_match_score(
        self, 
        actual_agents: List[str], 
        expected_agents: List[str]
    ) -> float:
        """Calculate score based on agent matching."""
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
    
    def _generate_reasoning(
        self,
        actual_agents: List[str],
        expected_agents: List[str], 
        score: float
    ) -> str:
        """Generate human-readable reasoning for the score."""
        expected_set = set(expected_agents)
        actual_set = set(actual_agents)
        
        matched = expected_set.intersection(actual_set)
        missing = expected_set - actual_set
        unexpected = actual_set - expected_set
        
        reasoning_parts = []
        
        reasoning_parts.append(f"Expected agents: {expected_agents}")
        reasoning_parts.append(f"Actual agents: {actual_agents}")
        reasoning_parts.append(f"Score: {score:.2f}")
        
        if matched:
            reasoning_parts.append(f"Matched agents: {list(matched)}")
        
        if missing:
            reasoning_parts.append(f"Missing agents: {list(missing)}")
        
        if unexpected:
            reasoning_parts.append(f"Unexpected agents: {list(unexpected)}")
        
        return " | ".join(reasoning_parts)