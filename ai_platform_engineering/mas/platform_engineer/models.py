# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Models shared between exchange components."""

from pydantic import BaseModel


class Action(BaseModel):
    """Definition of an available tool action."""

    name: str
    description: str
    jsonSchema: str
    available: str = "enabled"
