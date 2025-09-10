#!/usr/bin/env python3
"""
Standalone dataset upload script for Langfuse.

This script uploads evaluation datasets to Langfuse for manual testing and development.
It is separate from the webhook server and intended for local use only.

Usage:
    uv run python upload_dataset.py datasets/single_agent.yaml
    uv run python upload_dataset.py datasets/multi_agent.yaml
"""

import os
import sys
import yaml
import argparse
from typing import Dict, Any
from pathlib import Path
from dotenv import load_dotenv

from langfuse import Langfuse
from models.dataset import Dataset


def check_credentials() -> bool:
    """Check if Langfuse credentials are properly configured."""
    required_env_vars = ["LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY"]
    missing_vars = []
    
    for var in required_env_vars:
        if not os.getenv(var):
            missing_vars.append(var)
    
    if missing_vars:
        print("❌ Missing Langfuse credentials:")
        for var in missing_vars:
            print(f"   {var}")
        print("\nPlease set these environment variables:")
        for var in missing_vars:
            print(f"   export {var}=your_key")
        print(f"\nOptionally set LANGFUSE_HOST (defaults to https://cloud.langfuse.com)")
        return False
    
    return True


def load_dataset(file_path: str) -> Dataset:
    """Load dataset from YAML file."""
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"Dataset file not found: {file_path}")
    
    with open(file_path, 'r') as f:
        data = yaml.safe_load(f)
    
    return Dataset(**data)


def upload_dataset_to_langfuse(dataset: Dataset) -> Dict[str, Any]:
    """Upload dataset to Langfuse with proper expected_output handling."""
    # Initialize Langfuse client
    langfuse = Langfuse()
    
    try:
        # Create dataset in Langfuse
        print(f"📤 Creating dataset '{dataset.name}' in Langfuse...")
        langfuse_dataset = langfuse.create_dataset(
            name=dataset.name,
            description=dataset.description,
            metadata=dataset.metadata
        )
        print(f"✅ Created dataset with ID: {langfuse_dataset.id}")
        
        # Upload dataset items
        print(f"📤 Uploading {len(dataset.items)} items...")
        
        for i, item in enumerate(dataset.items, 1):
            # Handle input format
            if len(item.messages) == 1 and item.messages[0].role == "user":
                input_data = item.messages[0].content
            else:
                input_data = [{"role": msg.role, "content": msg.content} for msg in item.messages]
            
            # Use expected_output if provided, otherwise use placeholder
            if item.expected_output:
                expected_output = item.expected_output
            else:
                expected_output = "Platform Engineer will process this request using appropriate agents and provide a relevant response."
            
            # Create dataset item
            langfuse.create_dataset_item(
                dataset_name=dataset.name,
                id=item.id,
                input=input_data,
                expected_output=expected_output,
                metadata={
                    "expected_agents": item.expected_agents,
                    "expected_behavior": item.expected_behavior,
                    **item.metadata
                }
            )
            
            if i % 5 == 0 or i == len(dataset.items):
                print(f"   Uploaded {i}/{len(dataset.items)} items...")
        
        print(f"✅ Successfully uploaded all {len(dataset.items)} items")
        
        return {
            "status": "success",
            "dataset_name": dataset.name,
            "dataset_id": langfuse_dataset.id,
            "items_uploaded": len(dataset.items),
            "message": f"Dataset '{dataset.name}' uploaded successfully to Langfuse"
        }
        
    except Exception as e:
        print(f"❌ Failed to upload dataset: {e}")
        return {
            "status": "error",
            "error": str(e)
        }


def main():
    """Main entry point."""
    # Load environment variables from root .env file
    root_env_path = Path(__file__).parent.parent / '.env'
    if root_env_path.exists():
        load_dotenv(root_env_path)
        print(f"📁 Loaded environment from {root_env_path}")
    else:
        print("⚠️  No .env file found in root directory")
    
    parser = argparse.ArgumentParser(
        description="Upload evaluation datasets to Langfuse",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    uv run python upload_dataset.py datasets/single_agent.yaml
    uv run python upload_dataset.py datasets/multi_agent.yaml
    
    # Upload all datasets
    uv run python upload_dataset.py datasets/*.yaml
        """
    )
    parser.add_argument(
        "dataset_files",
        nargs="+",
        help="Path to dataset YAML file(s) to upload"
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Force upload even if dataset exists (will create new dataset)"
    )
    
    args = parser.parse_args()
    
    # Check credentials
    if not check_credentials():
        sys.exit(1)
    
    print("🚀 Starting dataset upload to Langfuse")
    print(f"   Host: {os.getenv('LANGFUSE_HOST', 'https://cloud.langfuse.com')}")
    
    # Process each dataset file
    success_count = 0
    total_files = len(args.dataset_files)
    
    for file_path in args.dataset_files:
        try:
            print(f"\n📂 Processing {file_path}...")
            
            # Load dataset
            dataset = load_dataset(file_path)
            print(f"   Loaded '{dataset.name}' with {len(dataset.items)} items")
            
            # Upload to Langfuse
            result = upload_dataset_to_langfuse(dataset)
            
            if result["status"] == "success":
                success_count += 1
                print(f"   ✅ Upload successful: {result['message']}")
            else:
                print(f"   ❌ Upload failed: {result['error']}")
                
        except Exception as e:
            print(f"   ❌ Error processing {file_path}: {e}")
    
    # Summary
    print(f"\n📊 Upload Summary:")
    print(f"   Successful: {success_count}/{total_files}")
    print(f"   Failed: {total_files - success_count}/{total_files}")
    
    if success_count == total_files:
        print("🎉 All datasets uploaded successfully!")
        sys.exit(0)
    else:
        print("⚠️  Some uploads failed. Check the logs above.")
        sys.exit(1)


if __name__ == "__main__":
    main()