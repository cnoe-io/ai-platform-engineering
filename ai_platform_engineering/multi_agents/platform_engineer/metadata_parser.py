# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""
Metadata Parser for AI Platform Engineer
Extracts structured metadata from agent responses when they request user input.
"""

import re
import logging
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)


def parse_metadata_from_response(response_text: str) -> Optional[Dict]:
    """
    Parse metadata from an agent response that requests user input.
    
    Detects patterns like:
    - "I need the following information:"
    - "Please provide:"
    - "To create X, I need:"
    
    And extracts field information from bullet points or numbered lists.
    
    Args:
        response_text: The plain text response from the agent
        
    Returns:
        Dict with metadata structure if input is detected, None otherwise
    """
    if not response_text:
        return None
        
    # Patterns that indicate the agent is requesting user input
    input_request_patterns = [
        r"(?:i'?ll\s+)?need\s+(?:the\s+)?following\s+(?:information|details)",
        r"please\s+provide\s+(?:the\s+)?(?:following|these)\s+(?:information|details)",
        r"to\s+(?:create|update|modify)\s+\w+,?\s+i'?ll?\s+need",
        r"please\s+(?:enter|specify|provide)\s+(?:the\s+)?following",
        r"i\s+need\s+(?:to\s+know|information\s+about)",
    ]
    
    # Check if the response contains any input request pattern
    has_input_request = any(
        re.search(pattern, response_text, re.IGNORECASE)
        for pattern in input_request_patterns
    )
    
    if not has_input_request:
        return None
        
    logger.info("📝 Detected input request in response")
    
    # Extract input fields from the response
    input_fields = _extract_input_fields(response_text)
    
    if not input_fields:
        logger.debug("No structured input fields found in response")
        return None
        
    logger.info(f"📝 Extracted {len(input_fields)} input fields")
    
    return {
        "request_type": "user_input",
        "input_fields": input_fields
    }


def _extract_input_fields(text: str) -> List[Dict]:
    """
    Extract input field information from numbered or bulleted lists.
    
    Looks for patterns like:
    1. **Field name**: Description (optional)
    2. **Field name** (required/optional)
    - **Field name**: Description
    
    Args:
        text: The response text containing field descriptions
        
    Returns:
        List of field dictionaries with name, description, required status
    """
    fields = []
    
    # Pattern to match numbered or bulleted list items with bold field names
    # Matches: 1. **Repository owner**: Description
    #          - **Repository name** (optional): Description
    field_pattern = r'(?:^\s*[\d]+\.|\s*[-*])\s*\*\*([^*:]+)\*\*(?:\s*\(([^)]+)\))?\s*:?\s*(.*)$'
    
    for line in text.split('\n'):
        match = re.match(field_pattern, line, re.MULTILINE)
        if match:
            field_name = match.group(1).strip()
            optionality = match.group(2).strip().lower() if match.group(2) else ""
            description = match.group(3).strip() if match.group(3) else ""
            
            # Determine if field is required
            is_required = "optional" not in optionality and "optional" not in description.lower()
            
            # Clean up description (remove trailing periods, parentheses about optionality)
            description = re.sub(r'\s*\(optional\)\s*\.?$', '', description, flags=re.IGNORECASE)
            description = description.rstrip('.')
            
            field = {
                "name": field_name,
                "description": description if description else f"The {field_name}",
                "required": is_required,
                "type": "text"  # Default to text input
            }
            
            fields.append(field)
            logger.debug(f"Extracted field: {field_name} (required={is_required})")
    
    return fields
