"""Model for Deletepolicydto"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Deletepolicydto(BaseModel):
  """Deletepolicydto model"""


class DeletepolicydtoResponse(APIResponse):
  """Response model for Deletepolicydto"""

  data: Optional[Deletepolicydto] = None


class DeletepolicydtoListResponse(APIResponse):
  """List response model for Deletepolicydto"""

  data: List[Deletepolicydto] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
