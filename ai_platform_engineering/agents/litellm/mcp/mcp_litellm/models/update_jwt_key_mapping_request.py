"""Model for Updatejwtkeymappingrequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Updatejwtkeymappingrequest(BaseModel):
  """Updatejwtkeymappingrequest model"""


class UpdatejwtkeymappingrequestResponse(APIResponse):
  """Response model for Updatejwtkeymappingrequest"""

  data: Optional[Updatejwtkeymappingrequest] = None


class UpdatejwtkeymappingrequestListResponse(APIResponse):
  """List response model for Updatejwtkeymappingrequest"""

  data: List[Updatejwtkeymappingrequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
