"""Model for Userroledeleterequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Userroledeleterequest(BaseModel):
  """Userroledeleterequest model"""


class UserroledeleterequestResponse(APIResponse):
  """Response model for Userroledeleterequest"""

  data: Optional[Userroledeleterequest] = None


class UserroledeleterequestListResponse(APIResponse):
  """List response model for Userroledeleterequest"""

  data: List[Userroledeleterequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
