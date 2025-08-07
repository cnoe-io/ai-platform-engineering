# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""
State models for RAG Agent.
"""

from typing import Optional

class OutputState:
    def __init__(self, answer: Optional[str] = None, error: Optional[str] = None):
        self.answer = answer
        self.error = error 