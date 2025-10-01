"""
Dataset models for evaluation system.
"""
from typing import List, Any, Dict, Optional
from pydantic import BaseModel, Field


class Message(BaseModel):
    """A message in the dataset."""
    role: str = Field(description="Role of the message sender (user, assistant)")
    content: str = Field(description="Content of the message")


class DatasetItem(BaseModel):
    """Individual item in an evaluation dataset."""
    id: str = Field(description="Unique identifier for the dataset item")
    messages: List[Message] = Field(description="Messages for this evaluation")
    expected_output: Optional[str] = Field(default=None, description="Expected output/response from the agent")
    expected_agents: List[str] = Field(description="Agents expected to be used")
    expected_behavior: str = Field(description="Expected behavior description")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="Additional metadata")


class Dataset(BaseModel):
    """Evaluation dataset containing multiple items."""
    name: str = Field(description="Name of the dataset")
    description: str = Field(description="Description of what this dataset tests")
    prompts: List[DatasetItem] = Field(description="List of evaluation items")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="Dataset metadata")

    @property
    def items(self) -> List[DatasetItem]:
        """Alias for prompts to match Langfuse dataset structure."""
        return self.prompts


class WebhookPayload(BaseModel):
    """Payload received from Langfuse webhook when triggering remote dataset run."""
    projectId: str = Field(description="Langfuse project ID")
    dataset_id: str = Field(alias="datasetId", description="ID of the dataset to evaluate")
    dataset_name: str = Field(alias="datasetName", description="Name of the dataset to evaluate")
    payload: str = Field(default="{}", description="JSON string with additional config")

    class Config:
        populate_by_name = True

    @property
    def config(self) -> Dict[str, Any]:
        """Parse payload JSON string into config dict."""
        try:
            import json
            return json.loads(self.payload) if self.payload else {}
        except (json.JSONDecodeError, TypeError):
            return {}


class EvaluationStatus(BaseModel):
    """Status of an evaluation run."""
    status: str = Field(description="Current status (started, running, completed, failed)")
    run_name: Optional[str] = Field(default=None, description="Name of the evaluation run")
    message: Optional[str] = Field(default=None, description="Status message")
    total_items: Optional[int] = Field(default=None, description="Total items to evaluate")
    completed_items: Optional[int] = Field(default=None, description="Items completed")
    error_message: Optional[str] = Field(default=None, description="Error message if failed")