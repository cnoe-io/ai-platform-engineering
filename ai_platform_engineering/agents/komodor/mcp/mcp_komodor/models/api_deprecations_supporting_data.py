"""Model for Apideprecationssupportingdata"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Apideprecationssupportingdata(BaseModel):
  """Apideprecationssupportingdata model"""


class ApideprecationssupportingdataResponse(APIResponse):
  """Response model for Apideprecationssupportingdata"""

  data: Optional[Apideprecationssupportingdata] = None


class ApideprecationssupportingdataListResponse(APIResponse):
  """List response model for Apideprecationssupportingdata"""

  data: List[Apideprecationssupportingdata] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
