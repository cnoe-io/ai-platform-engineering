#!/usr/bin/env python3
"""
Upload Platform Engineer evaluation datasets to Langfuse.

This script uploads the test datasets to your Langfuse instance so you can
trigger evaluations from the Langfuse UI.

Usage:
    python upload_datasets.py
    
    Or from repo root:
    python -m ai_platform_engineering.evaluation.platform_engineer.datasets.upload_datasets

Environment Variables Required:
    LANGFUSE_PUBLIC_KEY - Your Langfuse public key
    LANGFUSE_SECRET_KEY - Your Langfuse secret key  
    LANGFUSE_HOST - Langfuse host URL (default: http://localhost:3000)
"""
import os
import sys
import yaml
from pathlib import Path
from typing import Dict, Any

try:
    from langfuse import Langfuse
except ImportError:
    print("❌ Error: langfuse package not found")
    print("Install with: pip install langfuse")
    sys.exit(1)


class DatasetUploader:
    """Uploads evaluation datasets to Langfuse."""
    
    def __init__(self):
        """Initialize Langfuse client with environment variables."""
        self.langfuse_host = os.getenv("LANGFUSE_HOST", "http://localhost:3000")
        self.langfuse_public_key = os.getenv("LANGFUSE_PUBLIC_KEY")
        self.langfuse_secret_key = os.getenv("LANGFUSE_SECRET_KEY")
        
        if not self.langfuse_public_key or not self.langfuse_secret_key:
            print("❌ Error: Langfuse credentials not configured")
            print("Required environment variables:")
            print("  LANGFUSE_PUBLIC_KEY")
            print("  LANGFUSE_SECRET_KEY")
            print("  LANGFUSE_HOST (optional, defaults to http://localhost:3000)")
            sys.exit(1)
        
        print(f"🔗 Connecting to Langfuse at {self.langfuse_host}")
        
        try:
            self.langfuse = Langfuse(
                public_key=self.langfuse_public_key,
                secret_key=self.langfuse_secret_key,
                host=self.langfuse_host
            )
            print("✅ Connected to Langfuse successfully")
        except Exception as e:
            print(f"❌ Failed to connect to Langfuse: {e}")
            sys.exit(1)
    
    def load_dataset_yaml(self, yaml_path: Path) -> Dict[str, Any]:
        """Load and validate dataset YAML file."""
        try:
            with open(yaml_path, 'r') as f:
                dataset = yaml.safe_load(f)
            
            # Validate required fields
            required_fields = ['name', 'description', 'prompts']
            for field in required_fields:
                if field not in dataset:
                    raise ValueError(f"Missing required field: {field}")
            
            return dataset
            
        except Exception as e:
            print(f"❌ Error loading {yaml_path}: {e}")
            raise
    
    def upload_dataset(self, yaml_path: Path) -> bool:
        """Upload a single dataset to Langfuse."""
        print(f"\n📤 Uploading dataset: {yaml_path.name}")
        
        try:
            # Load dataset
            dataset = self.load_dataset_yaml(yaml_path)
            dataset_name = dataset['name']
            
            print(f"   Dataset: {dataset_name}")
            print(f"   Description: {dataset['description']}")
            print(f"   Items: {len(dataset['prompts'])}")
            
            # Create or update dataset
            try:
                langfuse_dataset = self.langfuse.create_dataset(
                    name=dataset_name,
                    description=dataset['description']
                )
                print(f"   ✅ Created dataset '{dataset_name}'")
            except Exception:
                # Dataset might already exist, try to get it
                try:
                    langfuse_dataset = self.langfuse.get_dataset(dataset_name)
                    print(f"   ℹ️  Dataset '{dataset_name}' already exists, updating items")
                except Exception as e: 
                    print(f"   ❌ Error with dataset '{dataset_name}': {e}")
                    return False
            
            # Add dataset items
            uploaded_items = 0
            for i, prompt_data in enumerate(dataset['prompts']):
                try:
                    # Extract prompt content
                    if 'messages' in prompt_data and prompt_data['messages']:
                        input_content = prompt_data['messages'][0]['content']
                    else:
                        input_content = prompt_data.get('content', f"Test prompt {i+1}")
                    
                    # Prepare expected output
                    expected_output = {}
                    if 'expected_agents' in prompt_data:
                        expected_output['agents'] = prompt_data['expected_agents']
                    
                    # Prepare metadata
                    metadata = {
                        'id': prompt_data.get('id', f"item_{i+1}"),
                        'category': prompt_data.get('category', 'general'),
                        'operation': prompt_data.get('operation', 'evaluate')
                    }
                    
                    # Create dataset item
                    self.langfuse.create_dataset_item(
                        dataset_name=dataset_name,
                        input=input_content,
                        expected_output=expected_output,
                        metadata=metadata
                    )
                    
                    uploaded_items += 1
                    
                except Exception as e:
                    print(f"   ⚠️  Failed to upload item {i+1}: {e}")
                    continue
            
            print(f"   ✅ Uploaded {uploaded_items}/{len(dataset['prompts'])} items")
            return uploaded_items > 0
            
        except Exception as e:
            print(f"   ❌ Failed to upload dataset: {e}")
            return False
    
    def upload_all_datasets(self) -> int:
        """Upload all dataset YAML files in the current directory."""
        datasets_dir = Path(__file__).parent
        yaml_files = list(datasets_dir.glob("*.yaml")) + list(datasets_dir.glob("*.yml"))
        
        if not yaml_files:
            print("❌ No dataset YAML files found in datasets directory")
            return 0
        
        print(f"📁 Found {len(yaml_files)} dataset file(s):")
        for yaml_file in yaml_files:
            print(f"   - {yaml_file.name}")
        
        uploaded_count = 0
        for yaml_file in yaml_files:
            if self.upload_dataset(yaml_file):
                uploaded_count += 1
        
        print(f"\n🎉 Successfully uploaded {uploaded_count}/{len(yaml_files)} datasets")
        
        if uploaded_count > 0:
            print(f"\n🚀 Next steps:")
            print(f"   1. Open Langfuse UI: {self.langfuse_host}")
            print(f"   2. Go to Datasets section")
            print(f"   3. Select a dataset and click 'Run Evaluation'")
            print(f"   4. Set webhook URL to: http://localhost:8010/evaluate")
            print(f"   5. Trigger evaluation and view results!")
        
        return uploaded_count


def main():
    """Main entry point."""
    print("🚀 Platform Engineer Dataset Uploader")
    print("=" * 50)
    
    uploader = DatasetUploader()
    uploaded_count = uploader.upload_all_datasets()
    
    if uploaded_count == 0:
        sys.exit(1)


if __name__ == "__main__":
    main()