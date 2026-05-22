"""Model for Updaterouterconfig"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Updaterouterconfig(BaseModel):
  """Set of params that you can modify via `router.update_settings()`."""


class UpdaterouterconfigResponse(APIResponse):
  """Response model for Updaterouterconfig"""

  data: Optional[Updaterouterconfig] = None


class UpdaterouterconfigListResponse(APIResponse):
  """List response model for Updaterouterconfig"""

  data: List[Updaterouterconfig] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
