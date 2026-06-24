"""Model for Emaileventsettingsupdaterequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Emaileventsettingsupdaterequest(BaseModel):
  """Emaileventsettingsupdaterequest model"""


class EmaileventsettingsupdaterequestResponse(APIResponse):
  """Response model for Emaileventsettingsupdaterequest"""

  data: Optional[Emaileventsettingsupdaterequest] = None


class EmaileventsettingsupdaterequestListResponse(APIResponse):
  """List response model for Emaileventsettingsupdaterequest"""

  data: List[Emaileventsettingsupdaterequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
