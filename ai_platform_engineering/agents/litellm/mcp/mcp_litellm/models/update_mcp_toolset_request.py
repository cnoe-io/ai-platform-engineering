"""Model for Updatemcptoolsetrequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Updatemcptoolsetrequest(BaseModel):
  """Updatemcptoolsetrequest model"""


class UpdatemcptoolsetrequestResponse(APIResponse):
  """Response model for Updatemcptoolsetrequest"""

  data: Optional[Updatemcptoolsetrequest] = None


class UpdatemcptoolsetrequestListResponse(APIResponse):
  """List response model for Updatemcptoolsetrequest"""

  data: List[Updatemcptoolsetrequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
