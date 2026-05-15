"""Model for ConfigurableclientsideparamscustomauthInput"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class ConfigurableclientsideparamscustomauthInput(BaseModel):
  """ConfigurableclientsideparamscustomauthInput model"""


class ConfigurableclientsideparamscustomauthInputResponse(APIResponse):
  """Response model for ConfigurableclientsideparamscustomauthInput"""

  data: Optional[ConfigurableclientsideparamscustomauthInput] = None


class ConfigurableclientsideparamscustomauthInputListResponse(APIResponse):
  """List response model for ConfigurableclientsideparamscustomauthInput"""

  data: List[ConfigurableclientsideparamscustomauthInput] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
