"""Model for Createjwtkeymappingrequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Createjwtkeymappingrequest(BaseModel):
  """Createjwtkeymappingrequest model"""


class CreatejwtkeymappingrequestResponse(APIResponse):
  """Response model for Createjwtkeymappingrequest"""

  data: Optional[Createjwtkeymappingrequest] = None


class CreatejwtkeymappingrequestListResponse(APIResponse):
  """List response model for Createjwtkeymappingrequest"""

  data: List[Createjwtkeymappingrequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
