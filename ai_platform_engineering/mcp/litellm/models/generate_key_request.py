"""Model for Generatekeyrequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Generatekeyrequest(BaseModel):
  """Generatekeyrequest model"""


class GeneratekeyrequestResponse(APIResponse):
  """Response model for Generatekeyrequest"""

  data: Optional[Generatekeyrequest] = None


class GeneratekeyrequestListResponse(APIResponse):
  """List response model for Generatekeyrequest"""

  data: List[Generatekeyrequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
