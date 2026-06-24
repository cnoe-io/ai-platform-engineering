"""Model for Restartreason"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Restartreason(BaseModel):
  """Restartreason model"""


class RestartreasonResponse(APIResponse):
  """Response model for Restartreason"""

  data: Optional[Restartreason] = None


class RestartreasonListResponse(APIResponse):
  """List response model for Restartreason"""

  data: List[Restartreason] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
