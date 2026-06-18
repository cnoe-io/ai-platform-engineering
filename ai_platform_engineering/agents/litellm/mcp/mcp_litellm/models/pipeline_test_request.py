"""Model for Pipelinetestrequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Pipelinetestrequest(BaseModel):
  """Request body for testing a guardrail pipeline with sample messages."""


class PipelinetestrequestResponse(APIResponse):
  """Response model for Pipelinetestrequest"""

  data: Optional[Pipelinetestrequest] = None


class PipelinetestrequestListResponse(APIResponse):
  """List response model for Pipelinetestrequest"""

  data: List[Pipelinetestrequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
