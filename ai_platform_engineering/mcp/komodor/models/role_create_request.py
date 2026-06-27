"""Model for Rolecreaterequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Rolecreaterequest(BaseModel):
  """Rolecreaterequest model"""


class RolecreaterequestResponse(APIResponse):
  """Response model for Rolecreaterequest"""

  data: Optional[Rolecreaterequest] = None


class RolecreaterequestListResponse(APIResponse):
  """List response model for Rolecreaterequest"""

  data: List[Rolecreaterequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
