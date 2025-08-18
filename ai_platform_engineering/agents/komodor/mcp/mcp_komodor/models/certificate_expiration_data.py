"""Model for Certificateexpirationdata"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Certificateexpirationdata(BaseModel):
    """Certificateexpirationdata model"""


class CertificateexpirationdataResponse(APIResponse):
    """Response model for Certificateexpirationdata"""

    data: Optional[Certificateexpirationdata] = None


class CertificateexpirationdataListResponse(APIResponse):
    """List response model for Certificateexpirationdata"""

    data: List[Certificateexpirationdata] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
