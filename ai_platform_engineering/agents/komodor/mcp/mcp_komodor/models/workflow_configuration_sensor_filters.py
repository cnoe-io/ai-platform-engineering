"""Model for Workflowconfigurationsensorfilters"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Workflowconfigurationsensorfilters(BaseModel):
  """Workflowconfigurationsensorfilters model"""


class WorkflowconfigurationsensorfiltersResponse(APIResponse):
  """Response model for Workflowconfigurationsensorfilters"""

  data: Optional[Workflowconfigurationsensorfilters] = None


class WorkflowconfigurationsensorfiltersListResponse(APIResponse):
  """List response model for Workflowconfigurationsensorfilters"""

  data: List[Workflowconfigurationsensorfilters] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
