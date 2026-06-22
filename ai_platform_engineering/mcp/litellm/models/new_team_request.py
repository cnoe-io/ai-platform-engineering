"""Model for Newteamrequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Newteamrequest(BaseModel):
  """Newteamrequest model"""


class NewteamrequestResponse(APIResponse):
  """Response model for Newteamrequest"""

  data: Optional[Newteamrequest] = None


class NewteamrequestListResponse(APIResponse):
  """List response model for Newteamrequest"""

  data: List[Newteamrequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
