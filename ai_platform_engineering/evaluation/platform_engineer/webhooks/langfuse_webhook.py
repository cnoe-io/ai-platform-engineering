"""
Langfuse webhook service for Platform Engineer evaluation.
"""
import asyncio
import logging
import os
from typing import Dict, Any

from fastapi import FastAPI, HTTPException, BackgroundTasks
from langfuse import Langfuse

from ..models import WebhookPayload, EvaluationStatus
from ..evaluation_runner import EvaluationRunner
from ..clients.eval_client import EvalClient

logger = logging.getLogger(__name__)


class LangfuseWebhookService:
    """Webhook service for Langfuse dataset evaluation triggers."""
    
    def __init__(self):
        # Load configuration
        self.config = self._load_config()
        
        # Initialize Langfuse client
        self.langfuse = self._init_langfuse()
        
        # Initialize evaluation client
        self.eval_client = self._init_eval_client()
        
        # Initialize evaluation runner
        self.evaluation_runner = EvaluationRunner(
            langfuse_client=self.langfuse,
            eval_client=self.eval_client
        ) if self.langfuse else None
    
    def _load_config(self) -> Dict[str, str]:
        """Load configuration from environment variables."""
        return {
            'platform_engineer_url': os.getenv("PLATFORM_ENGINEER_URL", "http://platform-engineering:8000"),
            'langfuse_host': os.getenv("LANGFUSE_HOST", "http://langfuse-web:3000"),
            'langfuse_public_key': os.getenv("LANGFUSE_PUBLIC_KEY"),
            'langfuse_secret_key': os.getenv("LANGFUSE_SECRET_KEY")
        }
    
    def _init_langfuse(self) -> Langfuse:
        """Initialize Langfuse client."""
        if self.config['langfuse_public_key'] and self.config['langfuse_secret_key']:
            return Langfuse(
                public_key=self.config['langfuse_public_key'],
                secret_key=self.config['langfuse_secret_key'],
                host=self.config['langfuse_host']
            )
        
        logger.error("Langfuse credentials not configured")
        return None
    
    def _init_eval_client(self) -> EvalClient:
        """Initialize evaluation client."""
        return EvalClient(
            platform_engineer_url=self.config['platform_engineer_url'],
            langfuse_host=self.config['langfuse_host'],
            langfuse_public_key=self.config['langfuse_public_key'],
            langfuse_secret_key=self.config['langfuse_secret_key']
        )
    
    async def handle_webhook(self, payload: WebhookPayload) -> EvaluationStatus:
        """Handle webhook trigger from Langfuse UI."""
        logger.info(f"Received webhook for dataset: {payload.dataset_name}")
        
        if not self.langfuse:
            raise HTTPException(
                status_code=500, 
                detail="Langfuse not configured"
            )
        
        if not self.evaluation_runner:
            raise HTTPException(
                status_code=500,
                detail="Evaluation runner not initialized"
            )
        
        try:
            # Get dataset from Langfuse
            dataset = self.langfuse.get_dataset(payload.dataset_name)
            if not dataset:
                raise HTTPException(
                    status_code=404,
                    detail=f"Dataset '{payload.dataset_name}' not found"
                )
            
            # Create evaluation run
            evaluation_run = self.evaluation_runner.create_evaluation_run(
                dataset_name=payload.dataset_name,
                total_items=len(dataset.items)
            )
            
            # Start evaluation in background
            asyncio.create_task(
                self._run_evaluation_async(
                    evaluation_run.evaluation_id,
                    dataset,
                    payload.config
                )
            )
            
            return EvaluationStatus(
                status="started",
                run_name=evaluation_run.run_name,
                message=f"Started evaluation of {evaluation_run.total_items} items",
                total_items=evaluation_run.total_items,
                completed_items=0
            )
            
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Webhook handling failed: {e}")
            raise HTTPException(status_code=500, detail=str(e))
    
    async def _run_evaluation_async(
        self,
        evaluation_id: str,
        dataset: Any,
        config: Dict[str, Any]
    ):
        """Run evaluation asynchronously."""
        evaluation_run = self.evaluation_runner.running_evaluations.get(evaluation_id)
        if not evaluation_run:
            logger.error(f"Evaluation run {evaluation_id} not found")
            return
        
        await self.evaluation_runner.run_dataset_evaluation(
            evaluation_run=evaluation_run,
            dataset=dataset,
            config=config
        )
    
    async def health_check(self) -> Dict[str, str]:
        """Perform health check on all components."""
        health_status = {
            "status": "unhealthy",
            "platform_engineer": "unknown",
            "langfuse": "not_configured"
        }
        
        try:
            # Check Platform Engineer connectivity
            pe_healthy = await self.eval_client.health_check()
            health_status["platform_engineer"] = "healthy" if pe_healthy else "unhealthy"
            
            # Check Langfuse configuration
            if self.langfuse:
                health_status["langfuse"] = "configured"
            
            # Overall status
            if pe_healthy and self.langfuse:
                health_status["status"] = "healthy"
            
        except Exception as e:
            logger.error(f"Health check failed: {e}")
            health_status["error"] = str(e)
        
        return health_status
    
    def get_evaluation_status(self, evaluation_id: str) -> Dict[str, Any]:
        """Get status of a specific evaluation."""
        if not self.evaluation_runner:
            return None
        
        evaluation_run = self.evaluation_runner.get_evaluation_status(evaluation_id)
        if not evaluation_run:
            return None
        
        return {
            "evaluation_id": evaluation_run.evaluation_id,
            "run_name": evaluation_run.run_name,
            "dataset_name": evaluation_run.dataset_name,
            "status": evaluation_run.status,
            "total_items": evaluation_run.total_items,
            "completed_items": evaluation_run.completed_items,
            "start_time": evaluation_run.start_time,
            "end_time": evaluation_run.end_time,
            "error_message": evaluation_run.error_message
        }


# FastAPI application
app = FastAPI(
    title="Platform Engineer Evaluation Webhook",
    version="2.0.0",
    description="Webhook service for triggering Platform Engineer evaluations from Langfuse"
)

# Initialize webhook service
webhook_service = LangfuseWebhookService()


@app.post("/evaluate", response_model=EvaluationStatus)
async def trigger_evaluation(
    payload: WebhookPayload,
    background_tasks: BackgroundTasks
):
    """
    Trigger dataset evaluation from Langfuse UI.
    
    This endpoint receives webhook triggers from Langfuse when an evaluation
    is requested through the UI. It starts the evaluation process in the background.
    """
    return await webhook_service.handle_webhook(payload)


@app.get("/health")
async def health_check():
    """
    Health check endpoint.
    
    Verifies connectivity to Platform Engineer and Langfuse configuration.
    """
    return await webhook_service.health_check()


@app.get("/evaluations/{evaluation_id}")
async def get_evaluation_status(evaluation_id: str):
    """
    Get status of a specific evaluation run.
    
    Returns detailed information about the evaluation progress and results.
    """
    status = webhook_service.get_evaluation_status(evaluation_id)
    if not status:
        raise HTTPException(status_code=404, detail="Evaluation not found")
    return status


@app.get("/evaluations")
async def list_evaluations():
    """
    List all evaluation runs.
    
    Returns a summary of all evaluation runs tracked by this service instance.
    """
    if not webhook_service.evaluation_runner:
        return {"evaluations": []}
    
    all_evaluations = webhook_service.evaluation_runner.get_all_evaluations()
    return {
        "evaluations": [
            {
                "evaluation_id": run.evaluation_id,
                "run_name": run.run_name,
                "status": run.status,
                "progress": f"{run.completed_items}/{run.total_items}"
            }
            for run in all_evaluations.values()
        ]
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)