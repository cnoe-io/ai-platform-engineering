"""Model for Idlegpusupportingdata"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Idlegpusupportingdata(BaseModel):
  """Idlegpusupportingdata model"""


class IdlegpusupportingdataResponse(APIResponse):
  """Response model for Idlegpusupportingdata"""

  data: Optional[Idlegpusupportingdata] = None


class IdlegpusupportingdataListResponse(APIResponse):
  """List response model for Idlegpusupportingdata"""

  data: List[Idlegpusupportingdata] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
