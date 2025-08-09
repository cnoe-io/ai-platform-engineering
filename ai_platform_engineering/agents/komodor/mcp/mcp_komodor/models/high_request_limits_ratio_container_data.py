"""Model for Highrequestlimitsratiocontainerdata"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Highrequestlimitsratiocontainerdata(BaseModel):
    """Highrequestlimitsratiocontainerdata model"""


class HighrequestlimitsratiocontainerdataResponse(APIResponse):
    """Response model for Highrequestlimitsratiocontainerdata"""

    data: Optional[Highrequestlimitsratiocontainerdata] = None


class HighrequestlimitsratiocontainerdataListResponse(APIResponse):
    """List response model for Highrequestlimitsratiocontainerdata"""

    data: List[Highrequestlimitsratiocontainerdata] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
