"""
Evaluation scoring strategies for Platform Engineer responses.
"""
import logging
from abc import ABC, abstractmethod
from typing import List, Optional, Any

from langfuse import Langfuse

from ..models import ScoreResult
from ..clients.eval_client import EvaluationResponse

logger = logging.getLogger(__name__)


class BaseEvaluator(ABC):
    """Base class for evaluation scoring strategies."""
    
    @abstractmethod
    def calculate_score(self, *args, **kwargs) -> ScoreResult:
        """Calculate a specific score."""
        pass




class ExecutionTimeEvaluator(BaseEvaluator):
    """Evaluates execution time performance."""
    
    def __init__(self, target_time: float = 10.0, max_time: float = 60.0):
        self.target_time = target_time
        self.max_time = max_time
    
    def calculate_score(self, execution_time: float) -> ScoreResult:
        """Calculate execution time score (inverse - lower is better)."""
        if execution_time <= self.target_time:
            score = 1.0
        elif execution_time >= self.max_time:
            score = 0.0
        else:
            # Linear decay between target and max
            score = 1.0 - ((execution_time - self.target_time) / (self.max_time - self.target_time))
        
        return ScoreResult(
            name="execution_time_score",
            value=score,
            comment=f"Execution time: {execution_time:.2f}s (target: {self.target_time}s)"
        )


class TrajectoryEvaluator(BaseEvaluator):
    """Evaluates agent trajectory matching against expected agents."""
    
    def __init__(self, langfuse_client):
        self.langfuse = langfuse_client
    
    def calculate_score(self, *args, **kwargs) -> ScoreResult:
        """Synchronous wrapper for abstract method compliance."""
        return ScoreResult(
            name="trajectory_match",
            value=0.0,
            comment="Use calculate_trajectory_score async method"
        )
    
    async def calculate_trajectory_score(
        self, 
        trace_id: str, 
        expected_agents: List[str]
    ) -> ScoreResult:
        """Calculate trajectory matching score by analyzing trace spans."""
        try:
            if not expected_agents:
                return ScoreResult(
                    name="trajectory_match",
                    value=1.0,
                    comment="No expected agents to match"
                )
            
            # Get trace data from Langfuse
            trace = self.langfuse.fetch_trace(trace_id)
            if not trace:
                return ScoreResult(
                    name="trajectory_match",
                    value=0.0,
                    comment="Trace not found"
                )
            
            # Extract agent sequence from spans
            agent_sequence = self._extract_agent_sequence(trace)
            
            # Calculate matching score
            score = self._calculate_match_score(agent_sequence, expected_agents)
            
            return ScoreResult(
                name="trajectory_match",
                value=score,
                comment=f"Expected: {expected_agents}, Got: {agent_sequence}"
            )
            
        except Exception as e:
            return ScoreResult(
                name="trajectory_match",
                value=0.0,
                comment=f"Trajectory evaluation failed: {str(e)}"
            )
    
    def _extract_agent_sequence(self, trace) -> List[str]:
        """Extract agent sequence from trace spans."""
        agents = []
        
        # Look for agent names in span metadata
        if hasattr(trace, 'observations') and trace.observations:
            for obs in trace.observations:
                if hasattr(obs, 'metadata') and obs.metadata:
                    agent_name = obs.metadata.get('agent_name') or obs.metadata.get('agent')
                    if agent_name and agent_name not in agents:
                        agents.append(agent_name)
        
        return agents
    
    def _calculate_match_score(self, actual: List[str], expected: List[str]) -> float:
        """Calculate matching score between actual and expected agent sequences."""
        if not expected:
            return 1.0
        
        if not actual:
            return 0.0
        
        # Simple matching: count how many expected agents were used
        matched = sum(1 for agent in expected if agent in actual)
        return matched / len(expected)


class EvaluationOrchestrator:
    """Orchestrates multiple evaluators and submits scores to Langfuse."""
    
    def __init__(self, langfuse_client: Langfuse):
        self.langfuse = langfuse_client
        self.evaluators = {
            'execution_time': ExecutionTimeEvaluator(),
            'trajectory': TrajectoryEvaluator(langfuse_client)
        }
    
    async def evaluate_and_score_from_trace(
        self,
        trace_id: str,
        response: EvaluationResponse,
        dataset_item: Any
    ) -> dict:
        """Run all evaluations and submit scores to Langfuse."""
        scores = {}
        
        try:
            # Extract expected agents from dataset item
            expected_agents = self._extract_agents(dataset_item)
            
            # 1. Execution Time Score
            time_result = self.evaluators['execution_time'].calculate_score(
                response.execution_time
            )
            scores['execution_time'] = time_result.value
            self._submit_score(trace_id, time_result)
            
            # 2. Trajectory Score (async)
            trajectory_result = await self.evaluators['trajectory'].calculate_trajectory_score(
                trace_id, expected_agents
            )
            scores['trajectory_match'] = trajectory_result.value
            self._submit_score(trace_id, trajectory_result)
            
            logger.info(
                f"Evaluation complete for trace {trace_id}: "
                f"time={scores['execution_time']:.2f}, "
                f"trajectory={scores['trajectory_match']:.2f}"
            )
            
            return scores
            
        except Exception as e:
            logger.error(f"Failed to evaluate trace {trace_id}: {e}")
            raise
    
    def _extract_agents(self, dataset_item: Any) -> List[str]:
        """Extract expected agents from dataset item."""
        # Try expected_output
        if hasattr(dataset_item, 'expected_output') and dataset_item.expected_output:
            if isinstance(dataset_item.expected_output, dict):
                agents = dataset_item.expected_output.get('agents', [])
                if isinstance(agents, list):
                    return agents
        
        # Try metadata
        if hasattr(dataset_item, 'metadata') and isinstance(dataset_item.metadata, dict):
            agents = dataset_item.metadata.get('expected_agents', [])
            if isinstance(agents, list):
                return agents
        
        return []
    
    def _submit_score(self, trace_id: str, score_result: ScoreResult):
        """Submit a single score to Langfuse."""
        self.langfuse.create_score(
            trace_id=trace_id,
            name=score_result.name,
            value=score_result.value,
            comment=score_result.comment
        )