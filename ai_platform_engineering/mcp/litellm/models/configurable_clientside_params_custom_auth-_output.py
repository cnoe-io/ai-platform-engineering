"""Model for ConfigurableclientsideparamscustomauthOutput"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class ConfigurableclientsideparamscustomauthOutput(BaseModel):
  """ConfigurableclientsideparamscustomauthOutput model"""


class ConfigurableclientsideparamscustomauthOutputResponse(APIResponse):
  """Response model for ConfigurableclientsideparamscustomauthOutput"""

  data: Optional[ConfigurableclientsideparamscustomauthOutput] = None


class ConfigurableclientsideparamscustomauthOutputListResponse(APIResponse):
  """List response model for ConfigurableclientsideparamscustomauthOutput"""

  data: List[ConfigurableclientsideparamscustomauthOutput] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
