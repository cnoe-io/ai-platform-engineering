"""Model for Deleteteamrequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Deleteteamrequest(BaseModel):
  """Deleteteamrequest model"""


class DeleteteamrequestResponse(APIResponse):
  """Response model for Deleteteamrequest"""

  data: Optional[Deleteteamrequest] = None


class DeleteteamrequestListResponse(APIResponse):
  """List response model for Deleteteamrequest"""

  data: List[Deleteteamrequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
