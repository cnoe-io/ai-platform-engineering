#!/usr/bin/env python3
"""
Verify Milvus schema and test JSON field queries.
Run: python scripts/check_milvus_schema.py

Prerequisites:
  docker compose -f docker-compose.dev.yaml --profile graph_rag up -d
  pip install pymilvus
"""

from pymilvus import MilvusClient
import json
import os

MILVUS_URI = os.getenv("MILVUS_URI", "http://localhost:19530")
COLLECTION_NAME = "rag_default"

def main():
    print(f"Connecting to Milvus at {MILVUS_URI}...")
    client = MilvusClient(uri=MILVUS_URI)

    # 1. List collections
    print("\n=== Collections ===")
    collections = client.list_collections()
    print(f"Collections: {collections}")

    if COLLECTION_NAME not in collections:
        print(f"\nCollection '{COLLECTION_NAME}' not found!")
        print("Make sure you have ingested some data first.")
        return

    # 2. Describe collection schema
    print(f"\n=== Collection Schema: {COLLECTION_NAME} ===")
    info = client.describe_collection(COLLECTION_NAME)
    print(f"Enable dynamic field: {info.get('enable_dynamic_field')}")
    print("\nFields:")
    for field in info.get('fields', []):
        print(f"  - {field['name']}: {field['type']}")

    # 3. Query sample documents to see actual field structure
    print(f"\n=== Sample Documents ===")
    results = client.query(
        collection_name=COLLECTION_NAME,
        filter="",  # No filter - get any documents
        output_fields=["*"],  # Get all fields
        limit=3
    )

    if not results:
        print("No documents found in collection!")
        return

    print(f"Found {len(results)} documents")
    for i, doc in enumerate(results[:2]):
        print(f"\n--- Document {i+1} ---")
        for key, value in doc.items():
            if key in ['dense', 'sparse']:  # Skip vector fields
                print(f"  {key}: <vector>")
            elif isinstance(value, dict):
                print(f"  {key}: {json.dumps(value, indent=4)[:500]}...")
            else:
                val_str = str(value)[:100]
                print(f"  {key}: {val_str}")

    # 4. Test JSON path query (the key test!)
    print(f"\n=== Testing JSON Path Queries ===")

    # Test different query syntaxes
    test_queries = [
        # Try different query syntaxes for last_modified (used for data retention pruning)
        ('metadata["last_modified"] > 0', "JSON bracket notation for last_modified"),
        ('last_modified > 0', "Direct field last_modified (if flattened)"),
        ('datasource_id != ""', "Top-level field (baseline)"),
    ]

    for expr, desc in test_queries:
        print(f"\nTesting: {desc}")
        print(f"  Expression: {expr}")
        try:
            results = client.query(
                collection_name=COLLECTION_NAME,
                filter=expr,
                output_fields=["datasource_id", "document_id"],
                limit=1
            )
            print(f"  Result: SUCCESS - found {len(results)} document(s)")
            if results:
                print(f"  Sample: {results[0]}")
        except Exception as e:
            print(f"  Result: FAILED - {e}")

    # 5. Find actual field names containing timestamp-related data
    print(f"\n=== Looking for timestamp fields in documents ===")
    # Re-query to get full docs
    results = client.query(
        collection_name=COLLECTION_NAME,
        filter="",
        output_fields=["*"],
        limit=3
    )

    for doc in results[:1]:
        def find_timestamp_fields(obj, path=""):
            if isinstance(obj, dict):
                for k, v in obj.items():
                    new_path = f"{path}.{k}" if path else k
                    if 'timestamp' in k.lower() or 'modified' in k.lower() or 'ts' == k.lower():
                        print(f"  Found: {new_path} = {v}")
                    find_timestamp_fields(v, new_path)
        find_timestamp_fields(doc)

    print("\n=== Summary ===")
    print("If JSON bracket notation works, we can use: metadata[\"content_timestamp\"] < cutoff")
    print("If direct field works, the metadata is flattened and we can use: content_timestamp < cutoff")
    print("Check the output above to determine which approach to use.")

if __name__ == "__main__":
    main()
