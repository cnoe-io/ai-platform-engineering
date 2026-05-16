"""Model for Userapikeyauth"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Userapikeyauth(BaseModel):
  """Return the row in the db"""


class UserapikeyauthResponse(APIResponse):
  """Response model for Userapikeyauth"""

  data: Optional[Userapikeyauth] = None


class UserapikeyauthListResponse(APIResponse):
  """List response model for Userapikeyauth"""

  data: List[Userapikeyauth] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
