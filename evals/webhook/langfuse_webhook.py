"""
Webhook service for Langfuse dataset evaluation triggers.
"""

# =====================================================
# CRITICAL: Load environment variables FIRST
# =====================================================
from dotenv import load_dotenv
load_dotenv()

# =====================================================
# CRITICAL: Disable a2a tracing BEFORE any a2a imports
# =====================================================
from cnoe_agent_utils.tracing import disable_a2a_tracing

# Disable A2A framework tracing to prevent interference with custom tracing
disable_a2a_tracing()

# =====================================================
# Now safe to import a2a modules and other dependencies
# =====================================================

import asyncio
import logging
import os
import time
import uuid
from typing import Dict, Any

from fastapi import FastAPI, HTTPException, BackgroundTasks
from langfuse import Langfuse
from langchain_openai import ChatOpenAI
from langchain_anthropic import ChatAnthropic

from models.dataset import WebhookPayload, EvaluationStatus
from models.evaluation import EvaluationResult
from trace_analysis import TraceExtractor
from evaluators.routing_evaluator import RoutingEvaluator
from evaluators.tool_match_evaluator import ToolMatchEvaluator
from runner import EvaluationRunner

logger = logging.getLogger(__name__)


class LangfuseWebhookService:
    """Webhook service for Langfuse dataset evaluation triggers."""
    
    def __init__(self):
        # Load configuration
        self.config = self._load_config()
        
        # Initialize Langfuse client
        self.langfuse = self._init_langfuse()
        
        # Initialize LLM for evaluation
        self.llm = self._init_llm()
        
        # Initialize components
        self.trace_extractor = TraceExtractor(self.langfuse) if self.langfuse else None
        self.evaluators = self._init_evaluators()
        
        # Initialize evaluation runner
        self.evaluation_runner = EvaluationRunner(
            langfuse_client=self.langfuse,
            trace_extractor=self.trace_extractor,
            evaluators=self.evaluators,
            platform_engineer_url=self.config['platform_engineer_url']
        ) if self.langfuse else None
        
        # Track running evaluations
        self.running_evaluations: Dict[str, Dict[str, Any]] = {}
    
    def _load_config(self) -> Dict[str, str]:
        """Load configuration from environment variables."""
        return {
            'platform_engineer_url': os.getenv("PLATFORM_ENGINEER_URL", "http://platform-engineering:8000"),
            'langfuse_host': os.getenv("LANGFUSE_HOST", "http://langfuse-web:3000"),
            'langfuse_public_key': os.getenv("LANGFUSE_PUBLIC_KEY"),
            'langfuse_secret_key': os.getenv("LANGFUSE_SECRET_KEY"),
            'openai_api_key': os.getenv("OPENAI_API_KEY"),
            'anthropic_api_key': os.getenv("ANTHROPIC_API_KEY")
        }
    
    def _init_langfuse(self) -> Langfuse:
        """Initialize Langfuse client."""
        if self.config['langfuse_public_key'] and self.config['langfuse_secret_key']:
            try:
                return Langfuse(
                    public_key=self.config['langfuse_public_key'],
                    secret_key=self.config['langfuse_secret_key'],
                    host=self.config['langfuse_host']
                )
            except Exception as e:
                logger.error(f"Failed to initialize Langfuse: {e}")
                return None
        
        logger.error("Langfuse credentials not configured")
        return None
    
    def _init_llm(self):
        """Initialize LLM for evaluation."""
        if self.config['openai_api_key']:
            try:
                return ChatOpenAI(
                    api_key=self.config['openai_api_key'],
                    model=os.getenv("OPENAI_MODEL_NAME", "gpt-4"),
                    base_url=os.getenv("OPENAI_ENDPOINT", "https://api.openai.com/v1")
                )
            except Exception as e:
                logger.warning(f"Failed to initialize OpenAI: {e}")

        if self.config['anthropic_api_key']:
            try:
                return ChatAnthropic(
                    anthropic_api_key=self.config['anthropic_api_key'],
                    model="claude-3-haiku-20240307"
                )
            except Exception as e:
                logger.warning(f"Failed to initialize Anthropic: {e}")
        logger.warning("No LLM configured, will use simple evaluator only")
        return None
    
    def _init_evaluators(self) -> Dict[str, Any]:
        """Initialize both routing and tool match evaluators."""
        evaluators = {}

        if self.trace_extractor and self.config.get('openai_api_key'):
            # Initialize routing evaluator (supervisor-to-agent routing)
            evaluators['routing'] = RoutingEvaluator(
                trace_extractor=self.trace_extractor,
                openai_api_key=self.config.get('openai_api_key')
            )
            logger.info("Routing evaluator initialized")

            # Initialize tool match evaluator (agent-to-tool alignment)
            evaluators['tool_match'] = ToolMatchEvaluator(
                trace_extractor=self.trace_extractor,
                openai_api_key=self.config.get('openai_api_key')
            )
            logger.info("Tool match evaluator initialized")
        else:
            if not self.trace_extractor:
                logger.warning("TraceExtractor not available, evaluators not initialized")
            if not self.config.get('openai_api_key'):
                logger.warning("OpenAI API key not available, evaluators not initialized")

        return evaluators
    
    async def handle_webhook(self, payload: WebhookPayload) -> EvaluationStatus:
        """Handle webhook trigger from Langfuse UI for remote dataset run."""
        logger.info(f"🔍 Webhook: Received request for dataset: {payload.dataset_name} (ID: {payload.dataset_id})")
        logger.info(f"🔍 Webhook: Dataset runs will create traces that include Platform Engineer execution")
        
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
            # Get dataset from Langfuse (can use either ID or name)
            dataset = self.langfuse.get_dataset(payload.dataset_name)
            if not dataset:
                raise HTTPException(
                    status_code=404,
                    detail=f"Dataset '{payload.dataset_name}' not found"
                )
            
            # Create evaluation run with descriptive name
            evaluation_id = str(uuid.uuid4())
            run_name = f"remote_eval_{payload.dataset_name}_{int(time.time())}"
            
            evaluation_info = {
                "evaluation_id": evaluation_id,
                "run_name": run_name,
                "dataset_id": payload.dataset_id,
                "dataset_name": payload.dataset_name,
                "status": "started",
                "total_items": len(dataset.items),
                "completed_items": 0,
                "start_time": time.time(),
                "config": payload.config
            }
            
            self.running_evaluations[evaluation_id] = evaluation_info
            
            # Start evaluation in background
            asyncio.create_task(
                self._run_evaluation_async(evaluation_id, dataset, payload.config)
            )
            
            return EvaluationStatus(
                status="started",
                run_name=run_name,
                message=f"Started evaluation of {len(dataset.items)} items",
                total_items=len(dataset.items),
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
        evaluation_info = self.running_evaluations.get(evaluation_id)
        if not evaluation_info:
            logger.error(f"Evaluation {evaluation_id} not found")
            return
        
        try:
            evaluation_info["status"] = "running"
            
            await self.evaluation_runner.run_dataset_evaluation(
                dataset=dataset,
                evaluation_info=evaluation_info,
                config=config
            )
            
            evaluation_info["status"] = "completed"
            evaluation_info["end_time"] = time.time()
            
            logger.info(f"Evaluation {evaluation_id} completed successfully")
            
        except Exception as e:
            logger.error(f"Evaluation {evaluation_id} failed: {e}")
            evaluation_info["status"] = "failed"
            evaluation_info["error_message"] = str(e)
            evaluation_info["end_time"] = time.time()
    
    async def health_check(self) -> Dict[str, str]:
        """Perform health check on all components."""
        health_status = {
            "status": "unhealthy",
            "langfuse": "not_configured",
            "llm": "not_configured",
            "evaluator": "unknown"
        }
        
        try:
            # Check Langfuse configuration
            if self.langfuse:
                health_status["langfuse"] = "configured"
            
            # Check LLM configuration
            if self.llm:
                health_status["llm"] = "configured"
            
            # Check evaluator
            if self.evaluators:
                evaluator_types = list(self.evaluators.keys())
                health_status["evaluator"] = f"available: {evaluator_types}"
            
            # Overall status
            if self.langfuse and self.evaluators:
                health_status["status"] = "healthy"
            
        except Exception as e:
            logger.error(f"Health check failed: {e}")
            health_status["error"] = str(e)
        
        return health_status
    
    def get_evaluation_status(self, evaluation_id: str) -> Dict[str, Any]:
        """Get status of a specific evaluation."""
        evaluation_info = self.running_evaluations.get(evaluation_id)
        if not evaluation_info:
            return None
        
        return evaluation_info.copy()
    
    def list_evaluations(self) -> Dict[str, Any]:
        """List all evaluation runs."""
        return {
            "evaluations": [
                {
                    "evaluation_id": eval_id,
                    "run_name": info["run_name"],
                    "status": info["status"],
                    "progress": f"{info['completed_items']}/{info['total_items']}"
                }
                for eval_id, info in self.running_evaluations.items()
            ]
        }
    
    


# FastAPI application
app = FastAPI(
    title="Platform Engineer Evaluation Webhook",
    version="1.0.0",
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
    
    Verifies connectivity and configuration of all components.
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
    return webhook_service.list_evaluations()






def main():
    """Main entry point for the webhook service."""
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)


if __name__ == "__main__":
    main()