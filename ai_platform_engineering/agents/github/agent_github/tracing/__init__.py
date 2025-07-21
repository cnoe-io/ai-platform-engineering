# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""
GitHub Agent Tracing Module

Container-specific tracing utilities for the GitHub agent.
This module provides A2A noise reduction to prevent interference
with custom Langfuse tracing within the GitHub agent container.
"""

from .a2a_noise_reduction import disable_a2a_tracing

__all__ = ["disable_a2a_tracing"]