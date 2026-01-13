#!/usr/bin/env python3
"""
CLI runner for evaluations using Langfuse dataset runs.

This script:
1. Syncs prompts from single_agent.yaml to a Langfuse dataset
2. Runs evaluations in parallel using asyncio
3. Uses the existing runner infrastructure with routing/tool_match evaluators
4. Outputs a link to the Langfuse dataset run

Usage:
    python run_evals_cli.py --dataset datasets/single_agent.yaml --server http://localhost:8002
    
Environment variables required:
    LANGFUSE_PUBLIC_KEY
    LANGFUSE_SECRET_KEY
    LANGFUSE_HOST (defaults to https://langfuse.dev.outshift.io)
    OPENAI_API_KEY (for LLM-based evaluators)
"""

import argparse
import asyncio
import logging
import os
import sys
import time
from pathlib import Path
from typing import Dict, Any, List, Optional
from dataclasses import dataclass

import yaml
from dotenv import load_dotenv
from langfuse import Langfuse

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent))

from clients.eval_client import EvalClient, EvaluationRequest
from trace_analysis import TraceExtractor
from evaluators.routing_evaluator import RoutingEvaluator
from evaluators.tool_match_evaluator import ToolMatchEvaluator

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger(__name__)


@dataclass
class EvalResult:
    """Result of a single evaluation."""
    item_id: str
    prompt: str
    passed: bool
    routing_score: Optional[float] = None
    tool_match_score: Optional[float] = None
    execution_time: float = 0.0
    trace_id: Optional[str] = None
    error: Optional[str] = None
    actual_output: Optional[str] = None
    expected_behavior: Optional[str] = None
    failure_reason: Optional[str] = None


class LangfuseEvalRunner:
    """Run evaluations with Langfuse dataset tracking and LLM-based scoring."""
    
    LANGFUSE_PROJECT_ID = "cmkb5vqsm00d1zh0749kb76kr"
    LANGFUSE_BASE_URL = "https://langfuse.dev.outshift.io"
    
    def __init__(
        self,
        langfuse_host: str = None,
        platform_engineer_url: str = "http://localhost:8002",
        timeout: float = 120.0,
        max_concurrent: int = 5
    ):
        self.platform_engineer_url = platform_engineer_url
        self.timeout = timeout
        self.max_concurrent = max_concurrent
        
        # Initialize Langfuse
        self.langfuse_host = langfuse_host or os.getenv("LANGFUSE_HOST", self.LANGFUSE_BASE_URL)
        self.langfuse = self._init_langfuse()
        
        # Initialize evaluators
        self.trace_extractor = TraceExtractor(self.langfuse)
        self.evaluators = self._init_evaluators()
        
        # Eval client
        self.eval_client = EvalClient(
            platform_engineer_url=platform_engineer_url,
            timeout=timeout,
            max_concurrent_requests=max_concurrent
        )
        
        # Results tracking
        self.results: List[EvalResult] = []
    
    def _init_langfuse(self) -> Langfuse:
        """Initialize Langfuse client."""
        public_key = os.getenv("LANGFUSE_PUBLIC_KEY")
        secret_key = os.getenv("LANGFUSE_SECRET_KEY")
        
        if not public_key or not secret_key:
            raise ValueError(
                "LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY must be set. "
                "Get these from https://langfuse.dev.outshift.io/project/cmkb5vqsm00d1zh0749kb76kr/settings"
            )
        
        logger.info(f"🔗 Connecting to Langfuse at {self.langfuse_host}")
        return Langfuse(
            public_key=public_key,
            secret_key=secret_key,
            host=self.langfuse_host
        )
    
    def _init_evaluators(self) -> Dict[str, Any]:
        """Initialize routing and tool match evaluators."""
        evaluators = {}
        # Try Azure OpenAI key first, then standard OpenAI key
        openai_key = os.getenv("AZURE_OPENAI_API_KEY") or os.getenv("OPENAI_API_KEY")
        
        if openai_key and self.trace_extractor:
            try:
                evaluators['routing'] = RoutingEvaluator(
                    trace_extractor=self.trace_extractor,
                    openai_api_key=openai_key
                )
                logger.info("✅ Routing evaluator initialized")
            except Exception as e:
                logger.warning(f"Failed to init routing evaluator: {e}")
            
            try:
                evaluators['tool_match'] = ToolMatchEvaluator(
                    trace_extractor=self.trace_extractor,
                    openai_api_key=openai_key
                )
                logger.info("✅ Tool match evaluator initialized")
            except Exception as e:
                logger.warning(f"Failed to init tool_match evaluator: {e}")
        else:
            logger.warning("⚠️ AZURE_OPENAI_API_KEY/OPENAI_API_KEY not set - evaluators disabled")
        
        return evaluators
    
    def load_prompts_from_yaml(self, yaml_path: str) -> List[Dict[str, Any]]:
        """Load evaluation prompts from YAML file."""
        with open(yaml_path, 'r') as f:
            data = yaml.safe_load(f)
        
        prompts = data.get('prompts', [])
        logger.info(f"📂 Loaded {len(prompts)} prompts from {yaml_path}")
        return prompts
    
    def sync_dataset_to_langfuse(self, prompts: List[Dict], dataset_name: str) -> Any:
        """Create or update Langfuse dataset with prompts."""
        logger.info(f"📊 Syncing dataset '{dataset_name}' to Langfuse...")
        
        # Try to get existing dataset or create new one
        try:
            dataset = self.langfuse.get_dataset(dataset_name)
            logger.info(f"✅ Found existing dataset: {dataset_name}")
        except Exception:
            dataset = self.langfuse.create_dataset(
                name=dataset_name,
                description="Single-agent evaluation prompts for read-only operations"
            )
            logger.info(f"✨ Created new dataset: {dataset_name}")
        
        # Sync items to dataset
        new_items = 0
        for prompt_data in prompts:
            item_id = prompt_data.get('id')
            messages = prompt_data.get('messages', [])
            user_message = next(
                (m['content'] for m in messages if m.get('role') == 'user'),
                str(messages)
            )
            
            try:
                self.langfuse.create_dataset_item(
                    dataset_name=dataset_name,
                    input={"prompt": user_message, "messages": messages},
                    expected_output=prompt_data.get('expected_output'),
                    metadata={
                        "id": item_id,
                        "expected_agents": prompt_data.get('expected_agents', []),
                        "expected_behavior": prompt_data.get('expected_behavior', '')
                    }
                )
                new_items += 1
            except Exception as e:
                logger.debug(f"Item may already exist: {e}")
        
        logger.info(f"📊 Synced {new_items} items to dataset")
        
        # Re-fetch to get updated items
        dataset = self.langfuse.get_dataset(dataset_name)
        return dataset
    
    async def run_evaluation(
        self,
        dataset: Any,
        run_name: str = None
    ) -> Dict[str, Any]:
        """Run evaluation on all dataset items in parallel with Langfuse tracking."""
        
        if not run_name:
            timestamp = time.strftime("%Y%m%d_%H%M%S")
            run_name = f"eval_run_{timestamp}"
        
        logger.info(f"🚀 Starting evaluation run: {run_name}")
        logger.info(f"📊 Dataset: {dataset.name} ({len(dataset.items)} items)")
        
        # Initialize eval client
        await self.eval_client.initialize()
        
        start_time = time.time()
        
        try:
            # Process items in parallel with semaphore
            semaphore = asyncio.Semaphore(self.max_concurrent)
            
            async def evaluate_item(item) -> EvalResult:
                async with semaphore:
                    return await self._evaluate_single_item(item, run_name)
            
            # Run all evaluations in parallel
            tasks = [evaluate_item(item) for item in dataset.items]
            self.results = await asyncio.gather(*tasks, return_exceptions=True)
            
        finally:
            await self.eval_client.cleanup()
            # Wait for traces to be sent
            await asyncio.sleep(2)
            self.langfuse.flush()
        
        duration = time.time() - start_time
        
        # Calculate results
        passed = sum(1 for r in self.results if isinstance(r, EvalResult) and r.passed)
        failed = len(self.results) - passed
        
        # Calculate average scores
        routing_scores = [r.routing_score for r in self.results 
                         if isinstance(r, EvalResult) and r.routing_score is not None]
        tool_match_scores = [r.tool_match_score for r in self.results 
                            if isinstance(r, EvalResult) and r.tool_match_score is not None]
        
        avg_routing = sum(routing_scores) / len(routing_scores) if routing_scores else 0
        avg_tool_match = sum(tool_match_scores) / len(tool_match_scores) if tool_match_scores else 0
        
        # Generate results summary
        summary = {
            "run_name": run_name,
            "dataset_name": dataset.name,
            "total": len(dataset.items),
            "passed": passed,
            "failed": failed,
            "duration_seconds": round(duration, 2),
            "pass_rate": round(passed / len(dataset.items) * 100, 1) if dataset.items else 0,
            "avg_routing_score": round(avg_routing, 2),
            "avg_tool_match_score": round(avg_tool_match, 2),
            "failures": [
                {
                    "id": r.item_id,
                    "prompt": r.prompt,
                    "expected": r.expected_behavior or "N/A",
                    "actual": r.actual_output or "No response",
                    "reason": r.failure_reason or r.error or "Unknown failure"
                }
                for r in self.results 
                if isinstance(r, EvalResult) and not r.passed
            ]
        }
        
        # Log summary
        logger.info("\n" + "=" * 60)
        logger.info("📊 EVALUATION RESULTS")
        logger.info("=" * 60)
        logger.info(f"Run Name: {run_name}")
        logger.info(f"Dataset: {dataset.name}")
        logger.info(f"Total: {summary['total']}")
        logger.info(f"✅ Passed: {passed}")
        logger.info(f"❌ Failed: {failed}")
        logger.info(f"Pass Rate: {summary['pass_rate']}%")
        logger.info(f"Avg Routing Score: {summary['avg_routing_score']}")
        logger.info(f"Avg Tool Match Score: {summary['avg_tool_match_score']}")
        logger.info(f"Duration: {summary['duration_seconds']}s")
        logger.info("=" * 60 + "\n")
        
        return summary
    
    async def _evaluate_single_item(
        self,
        item: Any,
        run_name: str
    ) -> EvalResult:
        """Evaluate a single dataset item with Langfuse trace linking and scoring."""
        
        # Extract data from item
        item_metadata = item.metadata or {}
        item_id = item_metadata.get('id', item.id)
        expected_agents = item_metadata.get('expected_agents', [])
        expected_behavior = item_metadata.get('expected_behavior', '')
        
        if hasattr(item, 'input') and item.input:
            if isinstance(item.input, dict):
                prompt = item.input.get('prompt') or str(item.input)
            else:
                prompt = str(item.input)
        else:
            prompt = "Unknown prompt"
        
        logger.info(f"🔍 [{item_id}] Evaluating: {prompt[:50]}...")
        
        start_time = time.time()
        
        # Create dataset run context
        with item.run(
            run_name=run_name,
            run_description=f"Evaluation of {item_id}",
            run_metadata={
                "platform_engineer_url": self.platform_engineer_url,
                "expected_agents": expected_agents,
                "expected_behavior": expected_behavior
            }
        ) as run_ctx:
            trace_id = run_ctx.trace_id
            
            try:
                # Send to Platform Engineer
                request = EvaluationRequest(prompt=prompt, trace_id=trace_id)
                response = await self.eval_client.send_message(request)
                
                # Update trace with results
                run_ctx.update_trace(
                    input=prompt,
                    output=response.response_text[:2000] if response.response_text else "No response"
                )
                
                execution_time = time.time() - start_time
                
                # Wait for trace to be fully created
                await asyncio.sleep(1)
                
                # Run evaluators
                routing_score = None
                tool_match_score = None
                
                if 'routing' in self.evaluators and expected_agents:
                    try:
                        routing_result = self.evaluators['routing'].evaluate(
                            trace_id=trace_id,
                            user_prompt=prompt,
                            expected_agents=expected_agents
                        )
                        routing_score = routing_result.routing_score
                        run_ctx.score_trace(
                            name="routing_score",
                            value=routing_score,
                            comment=routing_result.routing_reasoning
                        )
                        logger.info(f"🔍 [{item_id}] Routing score: {routing_score:.2f}")
                    except Exception as e:
                        logger.warning(f"Routing evaluation failed for {item_id}: {e}")
                
                if 'tool_match' in self.evaluators and expected_behavior:
                    try:
                        tool_match_result = self.evaluators['tool_match'].evaluate(
                            trace_id=trace_id,
                            user_prompt=prompt,
                            expected_behavior=expected_behavior
                        )
                        tool_match_score = tool_match_result.tool_match_score
                        run_ctx.score_trace(
                            name="tool_match_score",
                            value=tool_match_score,
                            comment=tool_match_result.tool_match_reasoning
                        )
                        logger.info(f"🔍 [{item_id}] Tool match score: {tool_match_score:.2f}")
                    except Exception as e:
                        logger.warning(f"Tool match evaluation failed for {item_id}: {e}")
                
                # Determine pass/fail based on scores
                passed = response.success
                if routing_score is not None:
                    passed = passed and routing_score >= 0.5
                if tool_match_score is not None:
                    passed = passed and tool_match_score >= 0.5
                
                status = "✅ PASSED" if passed else "❌ FAILED"
                logger.info(f"🔍 [{item_id}] {status} in {execution_time:.1f}s")
                
                return EvalResult(
                    item_id=item_id,
                    prompt=prompt[:100],
                    passed=passed,
                    routing_score=routing_score,
                    tool_match_score=tool_match_score,
                    execution_time=execution_time,
                    trace_id=trace_id,
                    actual_output=response.response_text[:500] if response.response_text else None,
                    expected_behavior=expected_behavior,
                    failure_reason="Low scores" if not passed and response.success else ("Runtime execution failed" if not passed else None)
                )
                
            except Exception as e:
                execution_time = time.time() - start_time
                logger.error(f"🔍 [{item_id}] ERROR: {e}")
                run_ctx.update_trace(input=prompt, output=f"Error: {e}")
                run_ctx.score_trace(name="routing_score", value=0.0, comment=str(e))
                
                return EvalResult(
                    item_id=item_id,
                    prompt=prompt[:100],
                    passed=False,
                    execution_time=execution_time,
                    trace_id=trace_id,
                    error=str(e),
                    actual_output=f"Error: {e}",
                    expected_behavior=expected_behavior,
                    failure_reason=f"Exception: {e}"
                )


async def main():
    """Main entry point for CLI evaluation runner."""
    parser = argparse.ArgumentParser(description="Run evaluations with Langfuse tracking")
    parser.add_argument(
        "--dataset", "-d",
        default="datasets/single_agent.yaml",
        help="Path to dataset YAML file"
    )
    parser.add_argument(
        "--server", "-s",
        default=os.getenv("PLATFORM_ENGINEER_URL", "http://localhost:8002"),
        help="Platform Engineer server URL"
    )
    parser.add_argument(
        "--name", "-n",
        default=None,
        help="Dataset name in Langfuse (defaults to YAML filename)"
    )
    parser.add_argument(
        "--run-name", "-r",
        default=None,
        help="Evaluation run name (defaults to timestamp)"
    )
    parser.add_argument(
        "--timeout", "-t",
        type=float,
        default=5.0,
        help="Request timeout in seconds"
    )
    parser.add_argument(
        "--concurrent", "-c",
        type=int,
        default=5,
        help="Max concurrent requests"
    )
    parser.add_argument(
        "--output-json",
        action="store_true",
        help="Output results as JSON for CI parsing"
    )
    
    args = parser.parse_args()
    
    # Load environment
    load_dotenv()
    
    # Initialize runner
    runner = LangfuseEvalRunner(
        platform_engineer_url=args.server,
        timeout=args.timeout,
        max_concurrent=args.concurrent
    )
    
    # Load prompts from YAML
    yaml_path = Path(args.dataset)
    if not yaml_path.is_absolute():
        yaml_path = Path(__file__).parent / args.dataset
    
    prompts = runner.load_prompts_from_yaml(str(yaml_path))
    
    # Determine dataset name
    dataset_name = args.name or yaml_path.stem
    
    # Sync to Langfuse
    dataset = runner.sync_dataset_to_langfuse(prompts, dataset_name)
    
    # Run evaluation
    run_name = args.run_name or f"ci_run_{time.strftime('%Y%m%d_%H%M%S')}"
    summary = await runner.run_evaluation(dataset, run_name)
    
    # Output for CI
    if args.output_json:
        import json
        print("\n---JSON_OUTPUT_START---")
        print(json.dumps(summary, indent=2))
        print("---JSON_OUTPUT_END---")
    
    # Return exit code based on pass rate
    min_pass_rate = 30  # Lower threshold since some agents may not be configured
    if summary["pass_rate"] < min_pass_rate:
        logger.warning(f"Pass rate {summary['pass_rate']}% below minimum {min_pass_rate}%")
        sys.exit(1)
    
    return summary


if __name__ == "__main__":
    asyncio.run(main())
