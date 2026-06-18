"""Model for Deletejwtkeymappingrequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Deletejwtkeymappingrequest(BaseModel):
  """Deletejwtkeymappingrequest model"""


class DeletejwtkeymappingrequestResponse(APIResponse):
  """Response model for Deletejwtkeymappingrequest"""

  data: Optional[Deletejwtkeymappingrequest] = None


class DeletejwtkeymappingrequestListResponse(APIResponse):
  """List response model for Deletejwtkeymappingrequest"""

  data: List[Deletejwtkeymappingrequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
