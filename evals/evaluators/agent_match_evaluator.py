"""
Agent match evaluator that matches agents used vs expected.
"""
import logging
from typing import List

from evaluators.base import BaseEvaluator
from models.trajectory import Trajectory, EvaluationResult

logger = logging.getLogger(__name__)


class AgentMatchEvaluator(BaseEvaluator):
    """Evaluator that matches agents used against expected agents.
    
    Can automatically infer expected agents from the prompt text if not provided.
    """
    
    # Comprehensive agent patterns for inference
    # Using more specific patterns to reduce false positives
    AGENT_PATTERNS = {
        'github': ['github', 'repository', 'repo', 'pull request', 'pr', 'branch', 'commit', 'fork', 'clone'],
        'jira': ['jira', 'jira ticket', 'jira issue', 'story', 'epic', 'sprint', 'backlog', 'board', 'kanban'],
        'slack': ['slack', 'slack channel', 'slack message', 'notify team', 'post to slack'],
        'pagerduty': ['pagerduty', 'pager duty', 'incident', 'on-call', 'page team', 'escalation'],
        'argocd': ['argocd', 'argo cd', 'deploy', 'deployment', 'sync', 'rollback'],
        'confluence': ['confluence', 'confluence page', 'wiki', 'documentation page', 'document in confluence'],
        'backstage': ['backstage', 'backstage catalog', 'service catalog', 'software catalog', 'catalog entry'],
        'komodor': ['komodor', 'komodor health', 'cluster health', 'k8s health'],
        'aws': ['aws', 'amazon web services', 'ec2', 's3', 'lambda', 'cloudformation'],
        'splunk': ['splunk', 'splunk search', 'splunk dashboard', 'log search', 'search logs']
    }
    
    def _infer_expected_agents(self, prompt: str) -> List[str]:
        """Infer expected agents from prompt text using pattern matching."""
        prompt_lower = prompt.lower()
        detected_agents = []
        
        for agent, keywords in self.AGENT_PATTERNS.items():
            if any(keyword in prompt_lower for keyword in keywords):
                detected_agents.append(agent)
        
        return list(set(detected_agents))  # Remove duplicates
    
    async def evaluate(
        self,
        trajectory: Trajectory,
        prompt: str,
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
            
            # Use provided expected_agents or infer from prompt
            was_inferred = False
            if not expected_agents:
                expected_agents = self._infer_expected_agents(prompt)
                was_inferred = True
                logger.info(f"Inferred agents from prompt '{prompt[:50]}...': {expected_agents}")
            
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
                actual_agents, expected_agents, trajectory_score, was_inferred
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
        score: float,
        was_inferred: bool = False
    ) -> str:
        """Generate human-readable reasoning for the score."""
        expected_set = set(expected_agents)
        actual_set = set(actual_agents)
        
        matched = expected_set.intersection(actual_set)
        missing = expected_set - actual_set
        unexpected = actual_set - expected_set
        
        reasoning_parts = []
        
        if was_inferred:
            reasoning_parts.append(f"Expected agents (inferred from prompt): {expected_agents}")
        else:
            reasoning_parts.append(f"Expected agents: {expected_agents}")
        reasoning_parts.append(f"Actual agents: {actual_agents}")
        reasoning_parts.append(f"Agent match score: {score:.2f}")
        
        if matched:
            reasoning_parts.append(f"Matched agents: {list(matched)}")
        
        if missing:
            reasoning_parts.append(f"Missing agents: {list(missing)}")
        
        if unexpected:
            reasoning_parts.append(f"Unexpected agents: {list(unexpected)}")
        
        return " | ".join(reasoning_parts)