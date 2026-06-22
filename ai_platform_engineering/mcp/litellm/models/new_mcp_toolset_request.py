"""Model for Newmcptoolsetrequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Newmcptoolsetrequest(BaseModel):
  """Newmcptoolsetrequest model"""


class NewmcptoolsetrequestResponse(APIResponse):
  """Response model for Newmcptoolsetrequest"""

  data: Optional[Newmcptoolsetrequest] = None


class NewmcptoolsetrequestListResponse(APIResponse):
  """List response model for Newmcptoolsetrequest"""

  data: List[Newmcptoolsetrequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
