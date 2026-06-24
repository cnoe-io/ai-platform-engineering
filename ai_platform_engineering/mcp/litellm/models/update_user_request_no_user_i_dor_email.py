"""Model for Updateuserrequestnouseridoremail"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Updateuserrequestnouseridoremail(BaseModel):
  """Updateuserrequestnouseridoremail model"""


class UpdateuserrequestnouseridoremailResponse(APIResponse):
  """Response model for Updateuserrequestnouseridoremail"""

  data: Optional[Updateuserrequestnouseridoremail] = None


class UpdateuserrequestnouseridoremailListResponse(APIResponse):
  """List response model for Updateuserrequestnouseridoremail"""

  data: List[Updateuserrequestnouseridoremail] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
