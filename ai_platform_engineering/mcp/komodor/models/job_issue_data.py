"""Model for Jobissuedata"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Jobissuedata(BaseModel):
  """Jobissuedata model"""


class JobissuedataResponse(APIResponse):
  """Response model for Jobissuedata"""

  data: Optional[Jobissuedata] = None


class JobissuedataListResponse(APIResponse):
  """List response model for Jobissuedata"""

  data: List[Jobissuedata] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
