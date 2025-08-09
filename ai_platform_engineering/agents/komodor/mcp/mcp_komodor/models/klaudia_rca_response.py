"""Model for Klaudiarcaresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Klaudiarcaresponse(BaseModel):
    """Klaudiarcaresponse model"""


class KlaudiarcaresponseResponse(APIResponse):
    """Response model for Klaudiarcaresponse"""

    data: Optional[Klaudiarcaresponse] = None


class KlaudiarcaresponseListResponse(APIResponse):
    """List response model for Klaudiarcaresponse"""

    data: List[Klaudiarcaresponse] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
