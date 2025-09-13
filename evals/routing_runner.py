#!/usr/bin/env python3
"""
Simple runner for evaluating routing and tool match quality of traces.
"""
import asyncio
import logging
import os

from dotenv import load_dotenv
from langfuse import Langfuse

from trace_analysis.extractor import TraceExtractor
from evaluators.routing_evaluator import RoutingEvaluator

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def run_evaluation(
    trace_id: str,
    user_prompt: str,
    langfuse_host: str = None,
    openai_api_key: str = None
) -> None:
    """
    Run routing and tool match evaluation for a single trace.

    Args:
        trace_id: Langfuse trace ID to evaluate
        user_prompt: Original user request
        langfuse_host: Langfuse host URL (defaults to localhost:3000)
        openai_api_key: OpenAI API key (defaults to env var)
    """
    try:
        # Initialize Langfuse client
        langfuse_config = {
            'public_key': os.getenv('LANGFUSE_PUBLIC_KEY'),
            'secret_key': os.getenv('LANGFUSE_SECRET_KEY'),
            'host': langfuse_host or os.getenv('LANGFUSE_HOST', 'http://localhost:3000')
        }

        langfuse = Langfuse(**langfuse_config)
        logger.info(f"Connected to Langfuse at {langfuse_config['host']}")

        # Initialize trace extractor
        extractor = TraceExtractor(langfuse)

        # Initialize routing evaluator
        evaluator = RoutingEvaluator(
            trace_extractor=extractor,
            openai_api_key=openai_api_key
        )

        # Run evaluation
        print(f"\n🔍 EVALUATING TRACE: {trace_id}")
        print("=" * 60)
        print(f"User Prompt: {user_prompt}")
        print()

        result = evaluator.evaluate(trace_id, user_prompt)

        # Display results
        if result.success:
            print("✅ EVALUATION COMPLETED")
            print("-" * 30)
            print(f"Routing Score:    {result.routing_score:.2f}")
            print(f"  Reasoning: {result.routing_reasoning}")
            print()
            print(f"Tool Match Score: {result.tool_match_score:.2f}")
            print(f"  Reasoning: {result.tool_match_reasoning}")
            print()
            print("📋 TRAJECTORY:")
            print(result.trajectory_summary)
        else:
            print("❌ EVALUATION FAILED")
            print(f"Error: {result.error_message}")

        print("=" * 60)

    except Exception as e:
        logger.error(f"Evaluation failed: {e}")
        print(f"❌ Failed to run evaluation: {e}")


def main():
    """Main CLI entry point."""
    import argparse

    parser = argparse.ArgumentParser(
        description="Evaluate routing and tool match quality for Langfuse traces"
    )
    parser.add_argument(
        "trace_id",
        help="Langfuse trace ID to evaluate"
    )
    parser.add_argument(
        "user_prompt",
        help="Original user request/prompt"
    )
    parser.add_argument(
        "--host",
        default="http://localhost:3000",
        help="Langfuse host URL (default: http://localhost:3000)"
    )
    parser.add_argument(
        "--openai-key",
        help="OpenAI API key (defaults to OPENAI_API_KEY env var)"
    )

    args = parser.parse_args()

    run_evaluation(
        trace_id=args.trace_id,
        user_prompt=args.user_prompt,
        langfuse_host=args.host,
        openai_api_key=args.openai_key
    )


if __name__ == "__main__":
    main()