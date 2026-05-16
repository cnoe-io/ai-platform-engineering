"""Model for Registerpluginrequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Registerpluginrequest(BaseModel):
  """Request body for registering a plugin in the marketplace.

  LiteLLM acts as a registry/discovery layer. Plugins are hosted on
  GitHub/GitLab/Bitbucket and referenced by their git source."""


class RegisterpluginrequestResponse(APIResponse):
  """Response model for Registerpluginrequest"""

  data: Optional[Registerpluginrequest] = None


class RegisterpluginrequestListResponse(APIResponse):
  """List response model for Registerpluginrequest"""

  data: List[Registerpluginrequest] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
