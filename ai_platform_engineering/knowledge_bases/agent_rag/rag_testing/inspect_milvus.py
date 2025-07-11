# run this in terminal: python inspect_milvus.py --host localhost --port 19530 --delete-all


import argparse
from pymilvus import connections, utility, Collection, DataType


def connect_milvus(host: str, port: str, alias: str = "default"):
    """Connect to Milvus using the specified host, port, and alias."""
    connections.connect(alias=alias, host=host, port=port)
    print(f"Connected to Milvus at {host}:{port} (alias='{alias}')")


def list_collections():
    """List all collections in the connected Milvus instance."""
    cols = utility.list_collections()
    print("\nCollections in Milvus:")
    for name in cols:
        print(f" - {name}")
    return cols


def describe_collection(name: str):
    """Describe schema, indexes, stats, and sample entries of a collection."""
    print(f"\n===== Collection: {name} =====")
    col = Collection(name)

    # Schema
    print("Schema fields:")
    for field in col.schema.fields:
        print(f"  - {field.name}: {field.dtype}")

    # Indexes
    try:
        idxs = utility.list_indexes(name)
        print(f"\nIndexes: {idxs}")
    except Exception as e:
        print(f"Failed to list indexes: {e}")

    # Entity count
    try:
        count = col.num_entities
    except Exception:
        count = None
    print(f"\nTotal entities (vectors) in '{name}': {count}")

    # Sample entries
    sample_size = min(5, count or 0)
    if sample_size > 0:
        print(f"\nSample {sample_size} entries:")
        # Identify vector field
        vec_field = None
        for field in col.schema.fields:
            if field.dtype == DataType.FLOAT_VECTOR:
                vec_field = field.name
                break
        out_fields = ["source"] + ([vec_field] if vec_field else [])
        results = col.query(expr="", output_fields=out_fields, limit=sample_size)
        for i, row in enumerate(results, 1):
            src = row.get("source")
            print(f" Entry {i} - source: {src}")
            if vec_field and row.get(vec_field) is not None:
                vec = row[vec_field]
                print(f"   {vec_field} length: {len(vec)}, first 5 dims: {vec[:5]}")
    else:
        print("No entries to sample.")


def delete_collections(names):
    """Drop each collection in the provided list."""
    for name in names:
        try:
            utility.drop_collection(name)
            print(f"Dropped collection '{name}'")
        except Exception as e:
            print(f"Failed to drop '{name}': {e}")


def main():
    parser = argparse.ArgumentParser(description="Inspect or delete Milvus collections and data.")
    parser.add_argument("--host", default="localhost", help="Milvus host")
    parser.add_argument("--port", default="19530", help="Milvus port")
    parser.add_argument("--alias", default="default", help="Connection alias")
    parser.add_argument("--delete-all", action="store_true", help="Delete all collections instead of inspecting")
    args = parser.parse_args()

    connect_milvus(args.host, args.port, args.alias)
    collections = list_collections()

    if not collections:
        print("No collections found. Exiting.")
        return

    if args.delete_all:
        confirm = input("Are you sure you want to delete ALL collections? (yes/no): ")
        if confirm.lower() == "yes":
            delete_collections(collections)
        else:
            print("Deletion aborted.")
        return

    for coll in collections:
        describe_collection(coll)


if __name__ == "__main__":
    main()