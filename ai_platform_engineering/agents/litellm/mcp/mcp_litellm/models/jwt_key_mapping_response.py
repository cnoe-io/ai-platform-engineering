"""Model for Jwtkeymappingresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Jwtkeymappingresponse(BaseModel):
  """Jwtkeymappingresponse model"""


class JwtkeymappingresponseResponse(APIResponse):
  """Response model for Jwtkeymappingresponse"""

  data: Optional[Jwtkeymappingresponse] = None


class JwtkeymappingresponseListResponse(APIResponse):
  """List response model for Jwtkeymappingresponse"""

  data: List[Jwtkeymappingresponse] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
