"""Model for Newuserrequestteam"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Newuserrequestteam(BaseModel):
  """Newuserrequestteam model"""


class NewuserrequestteamResponse(APIResponse):
  """Response model for Newuserrequestteam"""

  data: Optional[Newuserrequestteam] = None


class NewuserrequestteamListResponse(APIResponse):
  """List response model for Newuserrequestteam"""

  data: List[Newuserrequestteam] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
