"""
Platform Engineer Evaluation System

A comprehensive evaluation framework for multi-agent AI systems using Langfuse 
for trace analysis and LLM-based behavioral evaluation.

Features:
- Tool call extraction from Langfuse traces
- Simple trajectory matching evaluator
- LLM-based behavior evaluation
- Webhook service for integration with Langfuse UI
- Support for complex multi-agent workflows

Usage:
    # Start webhook service
    python -m evals.webhook.langfuse_webhook
    
    # Load and evaluate a dataset
    from evals.runner import load_dataset_from_yaml, EvaluationRunner
    dataset = await load_dataset_from_yaml('evals/datasets/multi_agent.yaml')
"""

from .models import Dataset, DatasetItem, Message, ToolCall, Trajectory, EvaluationResult
from .evaluators import SimpleTrajectoryEvaluator, TrajectoryLLMEvaluator
from .trace_analysis import TraceExtractor
from .runner import EvaluationRunner, load_dataset_from_yaml

__version__ = "1.0.0"

__all__ = [
    'Dataset',
    'DatasetItem',
    'Message', 
    'ToolCall',
    'Trajectory',
    'EvaluationResult',
    'SimpleTrajectoryEvaluator',
    'TrajectoryLLMEvaluator',
    'TraceExtractor',
    'EvaluationRunner',
    'load_dataset_from_yaml'
]