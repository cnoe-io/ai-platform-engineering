#!/usr/bin/env python3
"""
Helper script to build WEBEX_SPACES configuration interactively.
Usage: python3 build_config.py
"""

import json
import base64
from urllib.parse import urlparse, parse_qs

def extract_and_encode_space_id(space_link: str) -> str:
    """
    Convert Webex space link to base64-encoded space ID.
    
    Input format: webexteams://im?space=c590efb0-cee8-11f0-88a1-05c9cb3973f5
    Output: base64 encoding of ciscospark://us/ROOM/c590efb0-cee8-11f0-88a1-05c9cb3973f5
    """
    # Parse the URL
    parsed = urlparse(space_link)
    
    # Extract the space GUID from query parameters
    query_params = parse_qs(parsed.query)
    space_guid = query_params.get('space', [None])[0]
    
    if not space_guid:
        raise ValueError(f"Could not extract space GUID from link: {space_link}")
    
    # Format as ciscospark URI
    ciscospark_uri = f"ciscospark://us/ROOM/{space_guid}"
    
    # Base64 encode
    space_id = base64.b64encode(ciscospark_uri.encode()).decode()
    
    return space_id

def main():
    print("=== Webex Spaces Configuration Builder ===\n")
    spaces = {}
    
    while True:
        print("\n--- Add a Space ---")
        space_link = input("Space link (e.g., webexteams://im?space=xxx) [or press Enter to finish]: ").strip()
        
        if not space_link:
            break
        
        try:
            space_id = extract_and_encode_space_id(space_link)
            print(f"✓ Converted to space ID: {space_id[:40]}...")
        except Exception as e:
            print(f"✗ Error: {e}")
            continue
            
        name = input("Space name (e.g., General Discussion): ").strip() or "unknown"
        
        include_bots_input = input("Include bot messages? (y/N): ").strip().lower()
        include_bots = include_bots_input in ['y', 'yes']
        
        spaces[space_id] = {
            "name": name,
            "include_bots": include_bots
        }
        
        print(f"✓ Added space: {name}")
    
    if spaces:
        config_json = json.dumps(spaces, separators=(',', ':'))
        print("\n=== Configuration Complete ===")
        print("\nAdd this to your environment:\n")
        print(f"export WEBEX_SPACES='{config_json}'")
        print("\nOr use in docker-compose:")
        print(f'WEBEX_SPACES: \'{config_json}\'')
    else:
        print("\nNo spaces configured.")

if __name__ == "__main__":
    main()

