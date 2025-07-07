"""Model for Costallocationsummaryrow"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Costallocationsummaryrow(BaseModel):
    """A representation of a table row in allocation cost. Scope key/value will be determined according to the selected scope."""


class CostallocationsummaryrowResponse(APIResponse):
    """Response model for Costallocationsummaryrow"""

    data: Optional[Costallocationsummaryrow] = None


class CostallocationsummaryrowListResponse(APIResponse):
    """List response model for Costallocationsummaryrow"""

    data: List[Costallocationsummaryrow] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
