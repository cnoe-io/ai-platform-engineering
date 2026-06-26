"""Model for Accessgroupcreaterequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Accessgroupcreaterequest(BaseModel):
  """Accessgroupcreaterequest model"""


class AccessgroupcreaterequestResponse(APIResponse):
  """Response model for Accessgroupcreaterequest"""

  data: Optional[Accessgroupcreaterequest] = None


class AccessgroupcreaterequestListResponse(APIResponse):
  """List response model for Accessgroupcreaterequest"""

  data: List[Accessgroupcreaterequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
