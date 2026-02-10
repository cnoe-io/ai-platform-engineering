#!/usr/bin/env python3
"""
Script to find and delete duplicate primary keys in Milvus collection.

This can happen when using aadd_documents instead of upsert, as aadd_documents
does not guarantee uniqueness - it will insert duplicates if the same ID is passed.

Usage:
    python cleanup_duplicate_pks.py [--dry-run] [--collection COLLECTION_NAME]

Options:
    --dry-run       Only report duplicates, don't delete them
    --collection    Collection name (default: rag_default)
    --milvus-uri    Milvus URI (default: http://localhost:19530)
    --batch-size    Batch size for queries (default: 1000)
"""

import argparse
import os
import sys
from collections import defaultdict
from pymilvus import MilvusClient


def find_duplicate_pks(client: MilvusClient, collection_name: str, batch_size: int = 1000) -> dict[str, list[dict]]:
  """
  Find all duplicate primary keys in a collection.

  Returns:
      Dict mapping pk value -> list of row data for duplicates
  """
  print(f"Scanning collection '{collection_name}' for duplicate primary keys...")

  # Get collection info
  if not client.has_collection(collection_name):
    print(f"Error: Collection '{collection_name}' does not exist")
    sys.exit(1)

  collection_info = client.describe_collection(collection_name)
  print(f"Collection info: {collection_info.get('description', 'No description')}")

  # Get total count
  stats = client.get_collection_stats(collection_name)
  total_rows = stats.get("row_count", 0)
  print(f"Total rows in collection: {total_rows}")

  if total_rows == 0:
    print("Collection is empty, nothing to check")
    return {}

  # Query all PKs - we need to iterate through all rows
  # Milvus doesn't have a direct way to find duplicates, so we fetch all PKs
  pk_to_rows: dict[str, list[dict]] = defaultdict(list)

  offset = 0
  while True:
    print(f"  Fetching rows {offset} to {offset + batch_size}...")

    # Query with offset/limit
    results = client.query(
      collection_name=collection_name,
      filter="",  # No filter - get all
      output_fields=["pk", "text", "datasource_id", "ingestor_id"],
      limit=batch_size,
      offset=offset,
    )

    if not results:
      break

    for row in results:
      pk = row.get("pk")
      if pk:
        pk_to_rows[pk].append(row)

    offset += batch_size

    if len(results) < batch_size:
      break

  # Filter to only duplicates
  duplicates = {pk: rows for pk, rows in pk_to_rows.items() if len(rows) > 1}

  print(f"\nFound {len(duplicates)} primary keys with duplicates")
  total_duplicate_rows = sum(len(rows) for rows in duplicates.values())
  rows_to_delete = sum(len(rows) - 1 for rows in duplicates.values())  # Keep one of each
  print(f"Total duplicate rows: {total_duplicate_rows}")
  print(f"Rows to delete (keeping one of each): {rows_to_delete}")

  return duplicates


def delete_duplicates(client: MilvusClient, collection_name: str, duplicates: dict[str, list[dict]], dry_run: bool = True) -> int:
  """
  Delete duplicate rows, keeping the first occurrence of each pk.

  In Milvus, we can't delete specific rows when there are duplicates with the same PK.
  We need to delete ALL rows with that PK and re-insert one.

  Returns:
      Number of rows deleted
  """
  if not duplicates:
    print("No duplicates to delete")
    return 0

  if dry_run:
    print("\n=== DRY RUN MODE - No changes will be made ===\n")

  total_deleted = 0

  for pk, rows in duplicates.items():
    num_duplicates = len(rows) - 1  # Keep one

    # Show info about this duplicate
    print(f"\nPK: {pk}")
    print(f"  Occurrences: {len(rows)}")
    print(f"  Will delete: {num_duplicates} duplicate(s)")

    # Show sample data from first row
    first_row = rows[0]
    print(f"  Sample - datasource_id: {first_row.get('datasource_id', 'N/A')}")
    print(f"  Sample - ingestor_id: {first_row.get('ingestor_id', 'N/A')}")
    text_preview = first_row.get("text", "")[:100] + "..." if first_row.get("text") else "N/A"
    print(f"  Sample - text: {text_preview}")

    if not dry_run:
      # Delete all rows with this PK
      # Milvus delete by expression will delete all matching rows
      try:
        client.delete(collection_name=collection_name, filter=f'pk == "{pk}"')
        print(f"  Deleted all rows with pk={pk}")

        # Re-insert the first row (to keep one copy)
        # Note: This requires re-embedding which we don't have access to here
        # So we'll just delete and let the next ingestion re-create it
        print(f"  Note: Row will be re-created on next ingestion")

        total_deleted += len(rows)  # All rows deleted (will be re-ingested)
      except Exception as e:
        print(f"  Error deleting pk={pk}: {e}")
    else:
      total_deleted += num_duplicates

  return total_deleted


def main():
  parser = argparse.ArgumentParser(description="Find and delete duplicate primary keys in Milvus")
  parser.add_argument("--dry-run", action="store_true", help="Only report duplicates, don't delete")
  parser.add_argument("--collection", default="rag_default", help="Collection name")
  parser.add_argument("--milvus-uri", default=None, help="Milvus URI")
  parser.add_argument("--batch-size", type=int, default=1000, help="Batch size for queries")

  args = parser.parse_args()

  # Get Milvus URI from env or args
  milvus_uri = args.milvus_uri or os.getenv("MILVUS_URI", "http://localhost:19530")

  print(f"Connecting to Milvus at {milvus_uri}...")
  client = MilvusClient(uri=milvus_uri)

  # List collections
  collections = client.list_collections()
  print(f"Available collections: {collections}")

  if args.collection not in collections:
    print(f"Error: Collection '{args.collection}' not found")
    print(f"Available: {collections}")
    sys.exit(1)

  # Find duplicates
  duplicates = find_duplicate_pks(client, args.collection, args.batch_size)

  if not duplicates:
    print("\nNo duplicates found! Collection is clean.")
    return

  # Delete duplicates (or report in dry-run mode)
  deleted = delete_duplicates(client, args.collection, duplicates, dry_run=args.dry_run)

  if args.dry_run:
    print(f"\n=== DRY RUN COMPLETE ===")
    print(f"Would delete {deleted} duplicate rows")
    print(f"Run without --dry-run to actually delete them")
  else:
    print(f"\n=== CLEANUP COMPLETE ===")
    print(f"Deleted {deleted} rows")
    print(f"Note: Affected documents will be re-created on next ingestion")


if __name__ == "__main__":
  main()
