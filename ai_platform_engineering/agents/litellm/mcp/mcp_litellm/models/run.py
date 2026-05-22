"""Model for Run"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Run(BaseModel):
  """Represents a run from the OpenAI Evals API"""


class RunResponse(APIResponse):
  """Response model for Run"""

  data: Optional[Run] = None


class RunListResponse(APIResponse):
  """List response model for Run"""

  data: List[Run] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
