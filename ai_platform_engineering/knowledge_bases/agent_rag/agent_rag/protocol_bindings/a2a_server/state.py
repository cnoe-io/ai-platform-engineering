# state.py
"""
State models for RAG Agent.
"""

from typing import Optional

class InputState:
    def __init__(self, url: Optional[str] = None, question: Optional[str] = None):
        self.url = url
        self.question = question

class OutputState:
    def __init__(self, answer: Optional[str] = None):
        self.answer = answer 