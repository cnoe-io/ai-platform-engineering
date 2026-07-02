"""Model for Workflowconfigurationsensor"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Workflowconfigurationsensor(BaseModel):
  """Workflowconfigurationsensor model"""


class WorkflowconfigurationsensorResponse(APIResponse):
  """Response model for Workflowconfigurationsensor"""

  data: Optional[Workflowconfigurationsensor] = None


class WorkflowconfigurationsensorListResponse(APIResponse):
  """List response model for Workflowconfigurationsensor"""

  data: List[Workflowconfigurationsensor] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
