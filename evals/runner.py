"""
Evaluation runner that orchestrates the evaluation process.
"""
import asyncio
import logging
import time
import uuid
from typing import Dict, Any, List
import yaml

from langfuse import Langfuse

from models.dataset import Dataset, DatasetItem
from trace_analysis import TraceExtractor
# Removed BaseEvaluator import - working directly with evaluator instances
from clients.eval_client import EvalClient, EvaluationRequest

logger = logging.getLogger(__name__)


class EvaluationRunner:
    """Orchestrates the evaluation of datasets against the Platform Engineer."""
    
    def __init__(
        self,
        langfuse_client: Langfuse,
        trace_extractor: TraceExtractor,
        evaluators: Dict[str, Any],
        platform_engineer_url: str = "http://platform-engineering:8000",
        timeout: float = 300.0,
        max_concurrent_requests: int = 3
    ):
        self.langfuse = langfuse_client
        self.trace_extractor = trace_extractor
        self.evaluators = evaluators
        
        # Initialize EvalClient for A2A communication
        self.eval_client = EvalClient(
            platform_engineer_url=platform_engineer_url,
            timeout=timeout,
            max_concurrent_requests=max_concurrent_requests
        )
    
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
            
            # Initialize EvalClient
            await self.eval_client.initialize()
            
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
            # Clean up EvalClient
            await self.eval_client.cleanup()
    
    
    async def _evaluate_single_item(
        self,
        item: Any,  # Langfuse dataset item
        evaluation_info: Dict[str, Any],
        config: Dict[str, Any]
    ):
        """
        Evaluate a single dataset item using proper dataset run context.
        
        The dataset run trace_id is automatically propagated to the Platform Engineer,
        creating a unified trace hierarchy: Dataset Run -> Platform Engineer -> Agents
        """
        run_name = evaluation_info["run_name"]
        run_description = f"Platform Engineer evaluation run: {evaluation_info['dataset_name']}"
        run_metadata = {
            "model": "platform-engineer",
            "evaluation_type": "agent_trajectory",
            "config": config
        }
        
        # Use item.run() context manager for automatic trace linking
        with item.run(
            run_name=run_name,
            run_description=run_description,
            run_metadata=run_metadata
        ) as root_span:
            trace_id = root_span.trace_id
            
            # Extract data from item
            dataset_item = self._parse_dataset_item(item)
            prompt = self._extract_prompt(dataset_item)
            
            logger.info(f"🔍 Dataset Run: Evaluating item {dataset_item.id} with trace_id={trace_id}")
            logger.info(f"🔍 Dataset Run: This trace_id will be passed to Platform Engineer for hierarchical tracing")
            
            try:
                # Send request to Platform Engineer using EvalClient
                # The trace_id is passed so Platform Engineer execution appears directly under dataset run
                logger.info(f"🔍 Dataset Run: Sending request to Platform Engineer with trace_id={trace_id}")
                
                request = EvaluationRequest(prompt=prompt, trace_id=trace_id)
                response = await self.eval_client.send_message(request)
                response_text = response.response_text
                
                logger.info(f"🔍 Dataset Run: Platform Engineer execution completed under dataset run trace")
                
                # Update root span with input and output
                root_span.update_trace(input=prompt, output=response_text)
                
                # Give trace time to be fully created before evaluation
                await asyncio.sleep(2)

                # Run evaluations directly with trace_id and prompt
                await self._run_evaluations(
                    trace_id, prompt, dataset_item, root_span
                )
                
            except Exception as e:
                logger.error(f"Failed to evaluate item {dataset_item.id}: {e}")
                # Skip scoring for evaluation failures
    
    def _parse_dataset_item(self, item: Any) -> DatasetItem:
        """Parse Langfuse dataset item into our DatasetItem model."""
        # Extract data from Langfuse dataset item
        item_data = {
            "id": item.id,
            "messages": [],
            "expected_output": None,
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
        
        # Handle expected output - prioritize metadata for evaluation criteria
        if hasattr(item, 'expected_output') and item.expected_output:
            if isinstance(item.expected_output, dict):
                # Legacy format: expected_output contains evaluation criteria
                item_data["expected_agents"] = item.expected_output.get("expected_agents", [])
                item_data["expected_behavior"] = item.expected_output.get("expected_behavior", "")
            else:
                # New format: expected_output is actual expected response
                item_data["expected_output"] = item.expected_output
        
        # Handle metadata (preferred location for evaluation criteria)
        if hasattr(item, 'metadata') and item.metadata:
            item_data["expected_agents"] = item.metadata.get("expected_agents", item_data["expected_agents"])
            item_data["expected_behavior"] = item.metadata.get("expected_behavior", item_data["expected_behavior"])
            # Metadata can also contain expected_output if not already set
            if not item_data["expected_output"]:
                item_data["expected_output"] = item.metadata.get("expected_output")
        
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
    
    
    async def _run_evaluations(
        self,
        trace_id: str,
        user_prompt: str,
        dataset_item: DatasetItem,
        root_span
    ):
        """Run all configured evaluators on the trace and add scores to root span."""
        for evaluator_name, evaluator in self.evaluators.items():
            try:
                logger.info(f"Running {evaluator_name} evaluator for item {dataset_item.id}")

                # For RoutingEvaluator, call evaluate with trace_id and user_prompt
                if hasattr(evaluator, 'evaluate') and evaluator_name == 'routing':
                    result = evaluator.evaluate(trace_id=trace_id, user_prompt=user_prompt)

                    # Add routing and tool match scores to root span
                    root_span.score_trace(
                        name="routing_score",
                        value=result.routing_score,
                        comment=result.routing_reasoning
                    )

                    root_span.score_trace(
                        name="tool_match_score",
                        value=result.tool_match_score,
                        comment=result.tool_match_reasoning
                    )

                    logger.info(f"RoutingEvaluator scores - Routing: {result.routing_score:.2f}, "
                               f"Tool Match: {result.tool_match_score:.2f}")
                else:
                    # Handle other evaluator types if needed in the future
                    logger.warning(f"Evaluator {evaluator_name} not supported in updated runner")
                
                logger.info(f"Added {evaluator_name} scores to dataset run item {dataset_item.id}")
                
            except Exception as e:
                logger.error(f"Evaluation failed with {evaluator_name} evaluator: {e}")
                # Skip scoring for evaluator failures


async def load_dataset_from_yaml(file_path: str) -> Dataset:
    """Load dataset from YAML file."""
    try:
        with open(file_path, 'r') as f:
            data = yaml.safe_load(f)

        return Dataset(**data)
    
    except Exception as e:
        logger.error(f"Failed to load dataset from {file_path}: {e}")
        raise
    