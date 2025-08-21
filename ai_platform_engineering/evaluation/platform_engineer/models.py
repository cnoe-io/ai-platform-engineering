"""
Shared data models for Platform Engineer evaluation system.
"""
from dataclasses import dataclass
from typing import Dict, List, Any, Optional
from pydantic import BaseModel, Field


# API Models
class WebhookPayload(BaseModel):
    """Langfuse webhook payload structure."""
    dataset_name: str = Field(alias="datasetName")  # API compatibility with camelCase
    config: Optional[Dict[str, Any]] = Field(default_factory=dict)
    
    class Config:
        populate_by_name = True  # Accept both dataset_name and datasetName


class EvaluationStatus(BaseModel):
    """Evaluation run status response."""
    status: str
    run_name: Optional[str] = None
    message: Optional[str] = None
    total_items: Optional[int] = None
    completed_items: Optional[int] = None


# Internal Models


@dataclass
class EvaluationRun:
    """Tracks a running evaluation."""
    evaluation_id: str
    run_name: str
    dataset_name: str
    status: str
    start_time: float
    total_items: int
    completed_items: int = 0
    end_time: Optional[float] = None
    error_message: Optional[str] = None


@dataclass
class ScoreResult:
    """Result of score calculation."""
    name: str
    value: float
    comment: str