"""Model for Certificateexpirationsupportingdata"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Certificateexpirationsupportingdata(BaseModel):
    """Certificateexpirationsupportingdata model"""


class CertificateexpirationsupportingdataResponse(APIResponse):
    """Response model for Certificateexpirationsupportingdata"""

    data: Optional[Certificateexpirationsupportingdata] = None


class CertificateexpirationsupportingdataListResponse(APIResponse):
    """List response model for Certificateexpirationsupportingdata"""

    data: List[Certificateexpirationsupportingdata] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
