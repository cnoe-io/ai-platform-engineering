"""Model for Blockteamrequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Blockteamrequest(BaseModel):
  """Blockteamrequest model"""


class BlockteamrequestResponse(APIResponse):
  """Response model for Blockteamrequest"""

  data: Optional[Blockteamrequest] = None


class BlockteamrequestListResponse(APIResponse):
  """List response model for Blockteamrequest"""

  data: List[Blockteamrequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
