"""
Local evaluation runner.
Usage: python evals/run_local.py <dataset_yaml_path>
"""
import asyncio
import logging
import os
import sys
import argparse

from dotenv import load_dotenv
from langfuse import Langfuse

# Add project root to path
sys.path.append(os.getcwd())
sys.path.append(os.path.join(os.getcwd(), "evals"))

from evals.trace_analysis import TraceExtractor
from evals.evaluators.routing_evaluator import RoutingEvaluator
from evals.evaluators.tool_match_evaluator import ToolMatchEvaluator
from evals.runner import EvaluationRunner

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

async def main():
    parser = argparse.ArgumentParser(description="Run local evaluation")
    parser.add_argument("dataset_path", help="Path to the dataset YAML file")
    parser.add_argument("--run-name", help="Name of the evaluation run", default=None)
    args = parser.parse_args()

    load_dotenv()

    # Configuration
    platform_engineer_url = os.getenv("PLATFORM_ENGINEER_URL", "http://localhost:8002")
    langfuse_host = os.getenv("LANGFUSE_HOST", "http://localhost:3000")
    langfuse_public_key = os.getenv("LANGFUSE_PUBLIC_KEY")
    langfuse_secret_key = os.getenv("LANGFUSE_SECRET_KEY")
    openai_api_key = os.getenv("OPENAI_API_KEY")

    if not all([langfuse_public_key, langfuse_secret_key]):
        logger.error("❌ Missing Langfuse credentials (LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY)")
        return

    logger.info(f"Connecting to Langfuse at {langfuse_host}")
    
    # Initialize Langfuse
    try:
        langfuse = Langfuse(
            public_key=langfuse_public_key,
            secret_key=langfuse_secret_key,
            host=langfuse_host
        )
    except Exception as e:
        logger.error(f"❌ Failed to initialize Langfuse: {e}")
        return

    # Initialize Trace Extractor
    trace_extractor = TraceExtractor(langfuse)

    # Initialize Evaluators
    evaluators = {}
    if openai_api_key:
        evaluators['routing'] = RoutingEvaluator(trace_extractor=trace_extractor, openai_api_key=openai_api_key)
        evaluators['tool_match'] = ToolMatchEvaluator(trace_extractor=trace_extractor, openai_api_key=openai_api_key)
    else:
        logger.warning("⚠️ OPENAI_API_KEY not set, skipping AI-based evaluators")

    # Initialize Runner
    runner = EvaluationRunner(
        langfuse_client=langfuse,
        trace_extractor=trace_extractor,
        evaluators=evaluators,
        platform_engineer_url=platform_engineer_url
    )

    # Load Dataset from Yaml
    try:
        from evals.upload_dataset import load_dataset, upload_dataset_to_langfuse
        
        logger.info(f"Loading dataset from {args.dataset_path}...")
        local_dataset = load_dataset(args.dataset_path)
        
        logger.info(f"Uploading dataset '{local_dataset.name}'...")
        # Note: This will use env vars to create its own Langfuse client
        upload_dataset_to_langfuse(local_dataset)
        logger.info(f"✅ Dataset uploaded: {local_dataset.name}")
        
        # Fetch valid SDK object from Langfuse
        dataset = langfuse.get_dataset(local_dataset.name)
        
    except Exception as e:
        logger.error(f"❌ Failed to load/upload dataset: {e}")
        return

    # Prepare Evaluation Info
    import time
    timestamp = time.strftime("%m%d_%H%M", time.localtime())
    run_name = args.run_name or f"local_run_{timestamp}"
    
    evaluation_info = {
        "run_name": run_name,
        "dataset_name": dataset.name,
        "total_items": len(dataset.items),
        "completed_items": 0
    }

    # Run Evaluation
    logger.info(f"🚀 Starting evaluation run: {run_name}")
    await runner.run_dataset_evaluation(dataset, evaluation_info)
    logger.info("✅ Evaluation completed")

if __name__ == "__main__":
    asyncio.run(main())
