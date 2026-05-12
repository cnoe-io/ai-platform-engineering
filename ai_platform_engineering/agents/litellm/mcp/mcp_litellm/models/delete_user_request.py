"""Model for Deleteuserrequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Deleteuserrequest(BaseModel):
  """Deleteuserrequest model"""


class DeleteuserrequestResponse(APIResponse):
  """Response model for Deleteuserrequest"""

  data: Optional[Deleteuserrequest] = None


class DeleteuserrequestListResponse(APIResponse):
  """List response model for Deleteuserrequest"""

  data: List[Deleteuserrequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
