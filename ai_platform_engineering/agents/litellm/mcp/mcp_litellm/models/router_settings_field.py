"""Model for Routersettingsfield"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Routersettingsfield(BaseModel):
  """Routersettingsfield model"""


class RoutersettingsfieldResponse(APIResponse):
  """Response model for Routersettingsfield"""

  data: Optional[Routersettingsfield] = None


class RoutersettingsfieldListResponse(APIResponse):
  """List response model for Routersettingsfield"""

  data: List[Routersettingsfield] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
