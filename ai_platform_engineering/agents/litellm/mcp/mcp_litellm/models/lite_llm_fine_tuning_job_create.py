"""Model for Litellmfinetuningjobcreate"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Litellmfinetuningjobcreate(BaseModel):
  """Litellmfinetuningjobcreate model"""


class LitellmfinetuningjobcreateResponse(APIResponse):
  """Response model for Litellmfinetuningjobcreate"""

  data: Optional[Litellmfinetuningjobcreate] = None


class LitellmfinetuningjobcreateListResponse(APIResponse):
  """List response model for Litellmfinetuningjobcreate"""

  data: List[Litellmfinetuningjobcreate] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
