"""
Evaluation runner that orchestrates the evaluation process.
"""
import asyncio
import logging
import time
import uuid
from typing import Dict, Any, List
import httpx
import yaml

from langfuse import Langfuse
from a2a.client import A2AClient, A2ACardResolver
from a2a.types import SendMessageRequest, MessageSendParams

from .models.dataset import Dataset, DatasetItem
from .trace_analysis import TraceExtractor
from .evaluators import BaseEvaluator

logger = logging.getLogger(__name__)


class EvaluationRunner:
    """Orchestrates the evaluation of datasets against the Platform Engineer."""
    
    def __init__(
        self,
        langfuse_client: Langfuse,
        trace_extractor: TraceExtractor,
        evaluators: Dict[str, BaseEvaluator],
        platform_engineer_url: str = "http://platform-engineering:8000",
        timeout: float = 300.0
    ):
        self.langfuse = langfuse_client
        self.trace_extractor = trace_extractor
        self.evaluators = evaluators
        self.platform_engineer_url = platform_engineer_url
        self.timeout = timeout
        
        # A2A client components (initialized per evaluation)
        self.httpx_client = None
        self.a2a_client = None
    
    async def run_dataset_evaluation(
        self,
        dataset: Any,  # Langfuse dataset object
        evaluation_info: Dict[str, Any],
        config: Dict[str, Any] = None
    ):
        """
        Run evaluation for all items in a dataset.
        
        Args:
            dataset: Langfuse dataset object
            evaluation_info: Dict containing evaluation metadata
            config: Optional configuration for the evaluation
        """
        config = config or {}
        evaluation_id = evaluation_info["evaluation_id"]
        run_name = evaluation_info["run_name"]
        
        try:
            logger.info(f"Starting evaluation run: {run_name}")
            
            # Initialize A2A client
            await self._initialize_a2a_client()
            
            # Process each dataset item
            for item in dataset.items:
                try:
                    await self._evaluate_single_item(
                        item, evaluation_info, config
                    )
                    evaluation_info["completed_items"] += 1
                    
                    logger.info(
                        f"Progress: {evaluation_info['completed_items']}/{evaluation_info['total_items']} "
                        f"items completed for {run_name}"
                    )
                    
                except Exception as e:
                    logger.error(f"Failed to evaluate item {item.id}: {e}")
                    # Continue with other items
            
            logger.info(f"Evaluation run completed: {run_name}")
            
        except Exception as e:
            logger.error(f"Evaluation run failed: {e}")
            raise
        finally:
            # Clean up A2A client
            if self.httpx_client:
                await self.httpx_client.aclose()
    
    async def _initialize_a2a_client(self):
        """Initialize A2A client for communicating with Platform Engineer."""
        logger.info(f"Initializing A2A connection to Platform Engineer: {self.platform_engineer_url}")
        
        self.httpx_client = httpx.AsyncClient(timeout=httpx.Timeout(self.timeout))
        
        try:
            # Get Platform Engineer agent card
            resolver = A2ACardResolver(
                httpx_client=self.httpx_client,
                base_url=self.platform_engineer_url
            )
            
            agent_card = await resolver.resolve()
            logger.info(f"Connected to Platform Engineer: {agent_card.name}")
            
            # Create A2A client
            self.a2a_client = A2AClient(
                httpx_client=self.httpx_client,
                agent_card=agent_card
            )
            
        except Exception as e:
            logger.error(f"Failed to initialize A2A client: {e}")
            raise
    
    async def _evaluate_single_item(
        self,
        item: Any,  # Langfuse dataset item
        evaluation_info: Dict[str, Any],
        config: Dict[str, Any]
    ):
        """Evaluate a single dataset item."""
        run_name = evaluation_info["run_name"]
        
        # Create dataset run item for tracing
        with item.run(run_name=run_name) as dataset_run:
            trace_id = dataset_run.trace_id
            
            # Extract data from item
            dataset_item = self._parse_dataset_item(item)
            prompt = self._extract_prompt(dataset_item)
            
            logger.info(f"Evaluating item {dataset_item.id}: trace_id={trace_id}")
            
            try:
                # Send request to Platform Engineer
                response_text = await self._send_to_platform_engineer(prompt, trace_id)
                
                # Update dataset run with output
                dataset_run.output = response_text
                dataset_run.metadata = {
                    "dataset_item_id": dataset_item.id,
                    "expected_agents": dataset_item.expected_agents,
                    "expected_behavior": dataset_item.expected_behavior
                }
                
                # Wait for trace to be fully created in Langfuse
                await asyncio.sleep(3)
                
                # Extract trajectory from trace
                trajectory = await self.trace_extractor.extract_trajectory(trace_id)
                
                if trajectory:
                    # Run evaluations
                    await self._run_evaluations(
                        trajectory, dataset_item, trace_id
                    )
                else:
                    logger.warning(f"Could not extract trajectory from trace {trace_id}")
                
            except Exception as e:
                logger.error(f"Failed to evaluate item {dataset_item.id}: {e}")
                dataset_run.metadata = {
                    "error": str(e),
                    "dataset_item_id": dataset_item.id
                }
    
    def _parse_dataset_item(self, item: Any) -> DatasetItem:
        """Parse Langfuse dataset item into our DatasetItem model."""
        # Extract data from Langfuse dataset item
        item_data = {
            "id": item.id,
            "messages": [],
            "expected_agents": [],
            "expected_behavior": ""
        }
        
        # Handle input format
        if hasattr(item, 'input') and item.input:
            if isinstance(item.input, dict):
                if 'messages' in item.input:
                    item_data["messages"] = item.input["messages"]
                elif 'prompt' in item.input:
                    item_data["messages"] = [{"role": "user", "content": item.input["prompt"]}]
                else:
                    # Assume the whole input is the prompt
                    item_data["messages"] = [{"role": "user", "content": str(item.input)}]
            else:
                item_data["messages"] = [{"role": "user", "content": str(item.input)}]
        
        # Handle expected output (contains our evaluation data)
        if hasattr(item, 'expected_output') and item.expected_output:
            if isinstance(item.expected_output, dict):
                item_data["expected_agents"] = item.expected_output.get("expected_agents", [])
                item_data["expected_behavior"] = item.expected_output.get("expected_behavior", "")
        
        # Handle metadata
        if hasattr(item, 'metadata') and item.metadata:
            item_data["expected_agents"] = item.metadata.get("expected_agents", item_data["expected_agents"])
            item_data["expected_behavior"] = item.metadata.get("expected_behavior", item_data["expected_behavior"])
        
        return DatasetItem(**item_data)
    
    def _extract_prompt(self, dataset_item: DatasetItem) -> str:
        """Extract prompt from dataset item messages."""
        if not dataset_item.messages:
            return ""
        
        # Get the user message content
        for message in dataset_item.messages:
            if message.role == "user":
                return message.content
        
        # Fallback to first message
        return dataset_item.messages[0].content
    
    async def _send_to_platform_engineer(self, prompt: str, trace_id: str) -> str:
        """Send prompt to Platform Engineer and get response."""
        try:
            request = SendMessageRequest(
                message=prompt,
                params=MessageSendParams(
                    context_id=str(uuid.uuid4()),
                    trace_id=trace_id
                )
            )
            
            # Send message and collect response
            response_parts = []
            async for response in self.a2a_client.send_message(request):
                if hasattr(response, 'content'):
                    response_parts.append(response.content)
                elif isinstance(response, dict) and 'content' in response:
                    response_parts.append(response['content'])
            
            return ''.join(response_parts)
            
        except Exception as e:
            logger.error(f"Failed to send message to Platform Engineer: {e}")
            return f"Error: {str(e)}"
    
    async def _run_evaluations(
        self,
        trajectory,
        dataset_item: DatasetItem,
        trace_id: str
    ):
        """Run all configured evaluators on the trajectory."""
        for evaluator_name, evaluator in self.evaluators.items():
            try:
                logger.info(f"Running {evaluator_name} evaluator for item {dataset_item.id}")
                
                result = await evaluator.evaluate(
                    trajectory=trajectory,
                    expected_agents=dataset_item.expected_agents,
                    expected_behavior=dataset_item.expected_behavior,
                    dataset_item_id=dataset_item.id
                )
                
                # Submit scores to Langfuse
                await self._submit_scores(trace_id, result, evaluator_name)
                
            except Exception as e:
                logger.error(f"Evaluation failed with {evaluator_name} evaluator: {e}")
    
    async def _submit_scores(self, trace_id: str, result, evaluator_name: str):
        """Submit evaluation scores to Langfuse."""
        try:
            # Submit trajectory score
            self.langfuse.create_score(
                trace_id=trace_id,
                name=f"{evaluator_name}_trajectory_score",
                value=result.trajectory_match_score,
                comment=f"Trajectory match score from {evaluator_name} evaluator"
            )
            
            # Submit behavior score
            self.langfuse.create_score(
                trace_id=trace_id,
                name=f"{evaluator_name}_behavior_score",
                value=result.behavior_match_score,
                comment=f"Behavior match score from {evaluator_name} evaluator"
            )
            
            # Submit overall score
            self.langfuse.create_score(
                trace_id=trace_id,
                name=f"{evaluator_name}_overall_score",
                value=result.overall_score,
                comment=result.reasoning
            )
            
            logger.info(f"Submitted scores to Langfuse for trace {trace_id}")
            
        except Exception as e:
            logger.error(f"Failed to submit scores to Langfuse: {e}")


async def load_dataset_from_yaml(file_path: str) -> Dataset:
    """Load dataset from YAML file."""
    try:
        with open(file_path, 'r') as f:
            data = yaml.safe_load(f)
        
        return Dataset(**data)
    
    except Exception as e:
        logger.error(f"Failed to load dataset from {file_path}: {e}")
        raise