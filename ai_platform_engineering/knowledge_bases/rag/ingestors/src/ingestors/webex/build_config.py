#!/usr/bin/env python3
"""
Helper script to build WEBEX_SPACES configuration interactively.
Usage: python3 build_config.py
"""

import json

def main():
    print("=== Webex Spaces Configuration Builder ===\n")
    spaces = {}
    
    while True:
        print("\n--- Add a Space ---")
        space_id = input("Space ID (long base64 string) [or press Enter to finish]: ").strip()
        
        if not space_id:
            break
            
        name = input("Space name (e.g., General Discussion): ").strip() or "unknown"
        
        lookback_days_input = input("Lookback days for initial sync (default: 30, 0 = all history): ").strip()
        lookback_days = int(lookback_days_input) if lookback_days_input else 30
        
        include_bots_input = input("Include bot messages? (y/N): ").strip().lower()
        include_bots = include_bots_input in ['y', 'yes']
        
        spaces[space_id] = {
            "name": name,
            "lookback_days": lookback_days,
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

