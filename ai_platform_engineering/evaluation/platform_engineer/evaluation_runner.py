"""
Core evaluation runner for Platform Engineer dataset evaluations.
"""
import asyncio
import logging
import time
import uuid
from typing import Any, Dict, Optional

from langfuse import Langfuse

from .models import EvaluationRun
from .evaluator.evaluators import EvaluationOrchestrator
from .clients.eval_client import (
    EvalClient,
    EvaluationRequest,
    EvaluationResponse
)

logger = logging.getLogger(__name__)


class EvaluationRunner:
    """Manages dataset evaluation execution and scoring."""
    
    def __init__(
        self,
        langfuse_client: Langfuse,
        eval_client: EvalClient
    ):
        self.langfuse = langfuse_client
        self.eval_client = eval_client
        self.scorer = EvaluationOrchestrator(langfuse_client)
        self.running_evaluations: Dict[str, EvaluationRun] = {}
    
    def create_evaluation_run(
        self,
        dataset_name: str,
        total_items: int
    ) -> EvaluationRun:
        """Create a new evaluation run."""
        run = EvaluationRun(
            evaluation_id=str(uuid.uuid4()),
            run_name=f"eval_{dataset_name}_{int(time.time())}",
            dataset_name=dataset_name,
            status="initializing",
            start_time=time.time(),
            total_items=total_items
        )
        self.running_evaluations[run.evaluation_id] = run
        return run
    
    async def run_dataset_evaluation(
        self,
        evaluation_run: EvaluationRun,
        dataset: Any,
        config: Dict[str, Any] = None
    ) -> EvaluationRun:
        """Execute evaluation for all items in a dataset."""
        config = config or {}
        
        try:
            # Update status
            evaluation_run.status = "running"
            logger.info(
                f"Starting evaluation run: {evaluation_run.run_name} "
                f"with {evaluation_run.total_items} items"
            )
            
            # Initialize evaluation client
            await self.eval_client.initialize()
            
            # Process each dataset item
            for item in dataset.items:
                try:
                    await self._evaluate_single_item(
                        item,
                        evaluation_run,
                        config
                    )
                    evaluation_run.completed_items += 1
                    
                    logger.info(
                        f"Progress: {evaluation_run.completed_items}/{evaluation_run.total_items} "
                        f"items completed"
                    )
                    
                except Exception as e:
                    logger.error(f"Failed to evaluate item {item.id}: {e}")
                    # Continue with other items
            
            # Mark as completed
            evaluation_run.status = "completed"
            evaluation_run.end_time = time.time()
            
            duration = evaluation_run.end_time - evaluation_run.start_time
            logger.info(
                f"Evaluation run completed: {evaluation_run.run_name} "
                f"({evaluation_run.completed_items}/{evaluation_run.total_items} successful) "
                f"in {duration:.2f}s"
            )
            
        except Exception as e:
            logger.error(f"Evaluation run failed: {e}")
            evaluation_run.status = "failed"
            evaluation_run.error_message = str(e)
            evaluation_run.end_time = time.time()
        
        return evaluation_run
    
    async def _evaluate_single_item(
        self,
        item: Any,
        evaluation_run: EvaluationRun,
        config: Dict[str, Any]
    ):
        """Evaluate a single dataset item."""
        # Create dataset run item for tracing
        with item.run(run_name=evaluation_run.run_name) as dataset_run:
            trace_id = dataset_run.trace_id
            
            # Extract basic data directly from item (let evaluators handle specifics)
            prompt = self._extract_prompt(item)
            
            logger.info(
                f"Evaluating item: prompt_length={len(prompt)}, trace_id={trace_id}"
            )
            
            # Create evaluation request with minimal data
            request = EvaluationRequest(
                prompt=prompt,
                expected_agents=[],  # Let evaluators extract from item
                category="general",  # Let evaluators extract from item
                operation="evaluate",  # Let evaluators extract from item
                trace_id=trace_id,
                metadata={
                    "run_name": evaluation_run.run_name,
                    "dataset_name": evaluation_run.dataset_name,
                    "dataset_item_id": item.id,
                    "langfuse_trace_id": trace_id,
                    **config
                }
            )
            
            # Execute evaluation via Platform Engineer
            logger.info(f"Sending request to Platform Engineer (trace_id: {trace_id})")
            response = await self.eval_client.evaluate_single_prompt(request)
            
            # Update dataset run with output
            dataset_run.output = response.response_text
            dataset_run.metadata = {
                "execution_time": response.execution_time,
                "success": response.success,
                "error_message": response.error_message
            }
            
            # Wait for Platform Engineer traces to be created
            await asyncio.sleep(2)
            
            # Let evaluators work directly with the trace and raw dataset item
            await self.scorer.evaluate_and_score_from_trace(
                trace_id=trace_id,
                response=response,
                dataset_item=item  # Pass raw item for evaluators to extract what they need
            )
    
    def _extract_prompt(self, item: Any) -> str:
        """Extract prompt - keep this simple since evaluators handle their own data."""
        if hasattr(item, 'input'):
            if isinstance(item.input, str):
                return item.input
            elif isinstance(item.input, dict):
                # Try common fields
                for field in ['prompt', 'text', 'messages']:
                    if field in item.input:
                        value = item.input[field]
                        if isinstance(value, str):
                            return value
                        elif isinstance(value, list) and value:
                            # Handle message format
                            if isinstance(value[0], dict) and 'content' in value[0]:
                                return value[0]['content']
                            return str(value[0])
                return str(item.input)
        return str(item.input) if hasattr(item, 'input') else ""
    
    def get_evaluation_status(self, evaluation_id: str) -> Optional[EvaluationRun]:
        """Get status of a specific evaluation run."""
        return self.running_evaluations.get(evaluation_id)
    
    def get_all_evaluations(self) -> Dict[str, EvaluationRun]:
        """Get all evaluation runs."""
        return self.running_evaluations.copy()