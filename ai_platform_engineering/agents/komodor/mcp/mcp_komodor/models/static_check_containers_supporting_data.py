"""Model for Staticcheckcontainerssupportingdata"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Staticcheckcontainerssupportingdata(BaseModel):
  """Staticcheckcontainerssupportingdata model"""


class StaticcheckcontainerssupportingdataResponse(APIResponse):
  """Response model for Staticcheckcontainerssupportingdata"""

  data: Optional[Staticcheckcontainerssupportingdata] = None


class StaticcheckcontainerssupportingdataListResponse(APIResponse):
  """List response model for Staticcheckcontainerssupportingdata"""

  data: List[Staticcheckcontainerssupportingdata] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
