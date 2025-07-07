"""Model for Servicestateyamlresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Servicestateyamlresponse(BaseModel):
    """Servicestateyamlresponse model"""


class ServicestateyamlresponseResponse(APIResponse):
    """Response model for Servicestateyamlresponse"""

    data: Optional[Servicestateyamlresponse] = None


class ServicestateyamlresponseListResponse(APIResponse):
    """List response model for Servicestateyamlresponse"""

    data: List[Servicestateyamlresponse] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
