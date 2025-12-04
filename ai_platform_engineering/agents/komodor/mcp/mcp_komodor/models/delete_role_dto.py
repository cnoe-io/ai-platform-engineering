"""Model for Deleteroledto"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Deleteroledto(BaseModel):
  """Deleteroledto model"""


class DeleteroledtoResponse(APIResponse):
  """Response model for Deleteroledto"""

  data: Optional[Deleteroledto] = None


class DeleteroledtoListResponse(APIResponse):
  """List response model for Deleteroledto"""

  data: List[Deleteroledto] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
