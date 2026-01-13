#!/usr/bin/env python3
"""
CLI runner for evaluations that integrates with Langfuse datasets.

This script:
1. Syncs prompts from multi_agent.yaml to a Langfuse dataset
2. Runs evaluations against the Platform Engineer server
3. Logs results to Langfuse with trace linking
4. Outputs a link to the Langfuse dataset run

Usage:
    python run_evals_cli.py --dataset datasets/multi_agent.yaml --server http://localhost:8002
    
Environment variables required:
    LANGFUSE_PUBLIC_KEY
    LANGFUSE_SECRET_KEY
    LANGFUSE_HOST (defaults to https://langfuse.dev.outshift.io)
"""

import argparse
import asyncio
import logging
import os
import sys
import time
import uuid
from pathlib import Path
from typing import Dict, Any, List

import yaml
from dotenv import load_dotenv
from langfuse import Langfuse

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent))

from clients.eval_client import EvalClient, EvaluationRequest

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger(__name__)


class LangfuseEvalRunner:
    """Run evaluations with Langfuse dataset tracking."""
    
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
        
        # Eval client
        self.eval_client = EvalClient(
            platform_engineer_url=platform_engineer_url,
            timeout=timeout,
            max_concurrent_requests=max_concurrent
        )
        
        # Results tracking
        self.results: List[Dict[str, Any]] = []
    
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
                description="Multi-agent evaluation prompts for single-graph mode"
            )
            logger.info(f"✨ Created new dataset: {dataset_name}")
        
        # Sync items to dataset
        existing_ids = {item.id for item in dataset.items} if hasattr(dataset, 'items') else set()
        new_items = 0
        
        for prompt_data in prompts:
            item_id = prompt_data.get('id')
            
            # Create dataset item
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
                logger.debug(f"Item may already exist or error: {e}")
        
        logger.info(f"📊 Synced {new_items} items to dataset")
        
        # Re-fetch to get updated items
        dataset = self.langfuse.get_dataset(dataset_name)
        return dataset
    
    async def run_evaluation(
        self,
        dataset: Any,
        run_name: str = None
    ) -> Dict[str, Any]:
        """Run evaluation on all dataset items with Langfuse tracking."""
        
        if not run_name:
            timestamp = time.strftime("%Y%m%d_%H%M%S")
            run_name = f"eval_run_{timestamp}"
        
        logger.info(f"🚀 Starting evaluation run: {run_name}")
        logger.info(f"📊 Dataset: {dataset.name} ({len(dataset.items)} items)")
        
        # Initialize eval client
        await self.eval_client.initialize()
        
        start_time = time.time()
        passed = 0
        failed = 0
        
        try:
            # Process items in parallel batches
            semaphore = asyncio.Semaphore(self.max_concurrent)
            
            async def evaluate_item(item) -> Dict[str, Any]:
                async with semaphore:
                    return await self._evaluate_single_item(item, run_name)
            
            tasks = [evaluate_item(item) for item in dataset.items]
            results = await asyncio.gather(*tasks, return_exceptions=True)
            
            # Process results
            for result in results:
                if isinstance(result, Exception):
                    failed += 1
                    self.results.append({
                        "status": "error",
                        "error": str(result)
                    })
                elif result.get("passed"):
                    passed += 1
                    self.results.append(result)
                else:
                    failed += 1
                    self.results.append(result)
            
        finally:
            await self.eval_client.cleanup()
            # Flush Langfuse
            self.langfuse.flush()
        
        duration = time.time() - start_time
        
        # Generate results summary
        summary = {
            "run_name": run_name,
            "dataset_name": dataset.name,
            "total": len(dataset.items),
            "passed": passed,
            "failed": failed,
            "duration_seconds": round(duration, 2),
            "pass_rate": round(passed / len(dataset.items) * 100, 1) if dataset.items else 0,
            "langfuse_url": f"{self.LANGFUSE_BASE_URL}/project/{self.LANGFUSE_PROJECT_ID}/datasets/{dataset.name}"
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
        logger.info(f"Duration: {summary['duration_seconds']}s")
        logger.info(f"\n🔗 Langfuse Dataset: {summary['langfuse_url']}")
        logger.info("=" * 60 + "\n")
        
        return summary
    
    async def _evaluate_single_item(
        self,
        item: Any,
        run_name: str
    ) -> Dict[str, Any]:
        """Evaluate a single dataset item with Langfuse trace linking."""
        
        # Extract prompt from item
        if hasattr(item, 'input') and item.input:
            if isinstance(item.input, dict):
                prompt = item.input.get('prompt') or str(item.input)
            else:
                prompt = str(item.input)
        else:
            prompt = "Unknown prompt"
        
        item_metadata = item.metadata or {}
        item_id = item_metadata.get('id', item.id)
        
        logger.info(f"🔍 [{item_id}] Evaluating: {prompt[:50]}...")
        
        # Create dataset run trace using Langfuse's dataset run context
        with item.run(
            run_name=run_name,
            run_description=f"Evaluation of {item_id}",
            run_metadata={"platform_engineer_url": self.platform_engineer_url}
        ) as run_ctx:
            trace_id = run_ctx.trace_id
            
            try:
                # Send to Platform Engineer
                request = EvaluationRequest(prompt=prompt, trace_id=trace_id)
                response = await self.eval_client.send_message(request)
                
                # Update trace with results
                run_ctx.update_trace(
                    input=prompt,
                    output=response.response_text[:1000] if response.response_text else "No response"
                )
                
                # Determine pass/fail
                passed = response.success and len(response.response_text) > 0
                
                # Score the run
                run_ctx.score_trace(
                    name="eval_passed",
                    value=1.0 if passed else 0.0,
                    comment=f"Response received in {response.execution_time:.1f}s" if passed else response.error_message
                )
                
                status = "✅ PASSED" if passed else "❌ FAILED"
                logger.info(f"🔍 [{item_id}] {status} in {response.execution_time:.1f}s")
                
                return {
                    "item_id": item_id,
                    "prompt": prompt[:100],
                    "passed": passed,
                    "execution_time": response.execution_time,
                    "trace_id": trace_id,
                    "error": response.error_message
                }
                
            except Exception as e:
                logger.error(f"🔍 [{item_id}] ERROR: {e}")
                run_ctx.update_trace(input=prompt, output=f"Error: {e}")
                run_ctx.score_trace(name="eval_passed", value=0.0, comment=str(e))
                
                return {
                    "item_id": item_id,
                    "prompt": prompt[:100],
                    "passed": False,
                    "execution_time": 0,
                    "trace_id": trace_id,
                    "error": str(e)
                }


async def main():
    """Main entry point for CLI evaluation runner."""
    parser = argparse.ArgumentParser(description="Run evaluations against Platform Engineer with Langfuse tracking")
    parser.add_argument(
        "--dataset", "-d",
        default="datasets/multi_agent.yaml",
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
        default=120.0,
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
    min_pass_rate = 50  # At least 50% must pass
    if summary["pass_rate"] < min_pass_rate:
        logger.error(f"Pass rate {summary['pass_rate']}% below minimum {min_pass_rate}%")
        sys.exit(1)
    
    return summary


if __name__ == "__main__":
    asyncio.run(main())
