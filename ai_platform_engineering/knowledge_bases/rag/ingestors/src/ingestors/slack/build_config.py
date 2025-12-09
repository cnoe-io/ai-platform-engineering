#!/usr/bin/env python3
"""
Helper script to build SLACK_CHANNELS configuration interactively.
Usage: python3 build_config.py
"""

import json

def main():
    print("=== Slack Channels Configuration Builder ===\n")
    channels = {}
    
    while True:
        print("\n--- Add a Channel ---")
        channel_id = input("Channel ID (e.g., C1234567890) [or press Enter to finish]: ").strip()
        
        if not channel_id:
            break
            
        name = input("Channel name (e.g., general): ").strip() or "unknown"
        
        lookback_days_input = input("Lookback days for initial sync (default: 30, 0 = all history): ").strip()
        lookback_days = int(lookback_days_input) if lookback_days_input else 30
        
        include_bots_input = input("Include bot messages? (y/N): ").strip().lower()
        include_bots = include_bots_input in ['y', 'yes']
        
        channels[channel_id] = {
            "name": name,
            "lookback_days": lookback_days,
            "include_bots": include_bots
        }
        
        print(f"✓ Added channel: {name} ({channel_id})")
    
    if channels:
        config_json = json.dumps(channels, separators=(',', ':'))
        print("\n=== Configuration Complete ===")
        print("\nAdd this to your environment:\n")
        print(f"export SLACK_CHANNELS='{config_json}'")
        print("\nOr use in docker-compose:")
        print(f'SLACK_CHANNELS: \'{config_json}\'')
    else:
        print("\nNo channels configured.")

if __name__ == "__main__":
    main()

