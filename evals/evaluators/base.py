"""
Base evaluator interface.
"""
from abc import ABC, abstractmethod
from typing import List

from models.trajectory import Trajectory, EvaluationResult


class BaseEvaluator(ABC):
    """Base class for all trajectory evaluators."""
    
    @abstractmethod
    async def evaluate(
        self,
        trajectory: Trajectory,
        prompt: str,
        expected_agents: List[str],
        expected_behavior: str,
        dataset_item_id: str
    ) -> EvaluationResult:
        """
        Evaluate a trajectory against expected agents and behavior.
        
        Args:
            trajectory: The actual trajectory to evaluate
            prompt: The original task prompt/description from dataset
            expected_agents: List of expected agent names (optional, can be inferred)
            expected_behavior: Description of expected behavior
            dataset_item_id: ID of the dataset item being evaluated
            
        Returns:
            EvaluationResult with scores and analysis
        """
        pass