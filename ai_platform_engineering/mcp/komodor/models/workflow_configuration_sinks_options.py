"""Model for Workflowconfigurationsinksoptions"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Workflowconfigurationsinksoptions(BaseModel):
  """Workflowconfigurationsinksoptions model"""


class WorkflowconfigurationsinksoptionsResponse(APIResponse):
  """Response model for Workflowconfigurationsinksoptions"""

  data: Optional[Workflowconfigurationsinksoptions] = None


class WorkflowconfigurationsinksoptionsListResponse(APIResponse):
  """List response model for Workflowconfigurationsinksoptions"""

  data: List[Workflowconfigurationsinksoptions] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
