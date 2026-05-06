"""GridFS-backed BaseStore for persistent file storage outside checkpoints."""

import asyncio
import json
import logging
from collections.abc import Iterable
from datetime import datetime, timezone

from gridfs import GridFS
from langgraph.store.base import (
    BaseStore,
    GetOp,
    Item,
    ListNamespacesOp,
    MatchCondition,
    Op,
    PutOp,
    Result,
    SearchItem,
    SearchOp,
)
from pymongo.database import Database

logger = logging.getLogger(__name__)


class MongoDBGridFSStore(BaseStore):
    """BaseStore implementation backed by MongoDB GridFS.

    Stores file content in GridFS (no 16MB document limit). Each file is
    identified by (namespace, key) stored in GridFS file metadata.

    Args:
        db: A pymongo Database instance.
        bucket_name: GridFS bucket/collection prefix.
    """

    def __init__(
        self,
        *,
        db: Database,
        bucket_name: str = "agent_files",
    ) -> None:
        self._db = db
        self._bucket_name = bucket_name
        self._fs = GridFS(db, collection=bucket_name)
        self._files_collection = db[f"{bucket_name}.files"]

    def batch(self, ops: Iterable[Op]) -> list[Result]:
        results: list[Result] = []
        for op in ops:
            if isinstance(op, GetOp):
                results.append(self._handle_get(op))
            elif isinstance(op, PutOp):
                self._handle_put(op)
                results.append(None)
            elif isinstance(op, SearchOp):
                results.append(self._handle_search(op))
            elif isinstance(op, ListNamespacesOp):
                results.append(self._handle_list_namespaces(op))
            else:
                results.append(None)
        return results

    async def abatch(self, ops: Iterable[Op]) -> list[Result]:
        return await asyncio.to_thread(self.batch, ops)

    def _handle_get(self, op: GetOp) -> Item | None:
        namespace = list(op.namespace)
        logger.debug(f"[gridfs] GET namespace={op.namespace} key={op.key}")
        doc = self._files_collection.find_one({"metadata.namespace": namespace, "metadata.key": op.key})
        if doc is None:
            logger.debug(f"[gridfs] GET not found: namespace={op.namespace} key={op.key}")
            return None
        grid_out = self._fs.get(doc["_id"])
        content = grid_out.read().decode("utf-8")
        value = _deserialize_value(content)
        upload_date = doc.get("uploadDate", datetime.now(timezone.utc))
        logger.debug(f"[gridfs] GET found: namespace={op.namespace} key={op.key} size={len(content)}")
        return Item(
            value=value,
            key=op.key,
            namespace=op.namespace,
            created_at=upload_date,
            updated_at=upload_date,
        )

    def _handle_put(self, op: PutOp) -> None:
        namespace = list(op.namespace)
        # Delete existing file(s) with same namespace+key
        for doc in self._files_collection.find({"metadata.namespace": namespace, "metadata.key": op.key}):
            self._fs.delete(doc["_id"])

        # value=None means delete only
        if op.value is None:
            logger.debug(f"[gridfs] DELETE namespace={op.namespace} key={op.key}")
            return

        content = _serialize_value(op.value)
        self._fs.put(
            content.encode("utf-8"),
            filename=op.key,
            metadata={"namespace": namespace, "key": op.key},
        )
        logger.debug(f"[gridfs] PUT namespace={op.namespace} key={op.key} size={len(content)}")

    def _handle_search(self, op: SearchOp) -> list[SearchItem]:
        namespace_prefix = list(op.namespace_prefix)
        logger.debug(f"[gridfs] SEARCH namespace_prefix={op.namespace_prefix} limit={op.limit} offset={op.offset}")
        prefix_len = len(namespace_prefix)

        # Query: namespace starts with the prefix
        if prefix_len == 0:
            query = {}
        else:
            # Each element at position i must match
            query = {f"metadata.namespace.{i}": namespace_prefix[i] for i in range(prefix_len)}

        cursor = self._files_collection.find(query).sort("uploadDate", -1)

        items: list[SearchItem] = []
        skipped = 0
        for doc in cursor:
            # Apply filter on value if specified
            if op.filter:
                grid_out = self._fs.get(doc["_id"])
                content = grid_out.read().decode("utf-8")
                value = _deserialize_value(content)
                if not _matches_filter(value, op.filter):
                    continue
            else:
                value = None  # lazy load

            if skipped < op.offset:
                skipped += 1
                continue

            if len(items) >= op.limit:
                break

            # Load value if not already loaded
            if value is None:
                grid_out = self._fs.get(doc["_id"])
                content = grid_out.read().decode("utf-8")
                value = _deserialize_value(content)

            ns = tuple(doc["metadata"]["namespace"])
            upload_date = doc.get("uploadDate", datetime.now(timezone.utc))
            items.append(
                SearchItem(
                    namespace=ns,
                    key=doc["metadata"]["key"],
                    value=value,
                    created_at=upload_date,
                    updated_at=upload_date,
                )
            )

        return items

    def _handle_list_namespaces(self, op: ListNamespacesOp) -> list[tuple[str, ...]]:
        # Aggregate distinct namespaces
        pipeline: list[dict] = []

        # Match conditions
        if op.match_conditions:
            match_filters = []
            for cond in op.match_conditions:
                if cond.match_type == "prefix":
                    for i, component in enumerate(cond.path):
                        if component != "*":
                            match_filters.append({f"metadata.namespace.{i}": component})
                elif cond.match_type == "suffix":
                    # Suffix matching requires post-filtering
                    pass
            if match_filters:
                pipeline.append({"$match": {"$and": match_filters}})

        pipeline.append({"$group": {"_id": "$metadata.namespace"}})
        pipeline.append({"$sort": {"_id": 1}})

        results: list[tuple[str, ...]] = []
        for doc in self._files_collection.aggregate(pipeline):
            ns = tuple(doc["_id"])

            # Apply max_depth truncation
            if op.max_depth is not None:
                ns = ns[: op.max_depth]

            # Apply suffix filtering
            if op.match_conditions:
                if not _matches_suffix_conditions(ns, op.match_conditions):
                    continue

            if ns not in results:
                results.append(ns)

        # Apply offset and limit
        return results[op.offset : op.offset + op.limit]

    def delete_by_namespace(self, namespace: tuple[str, ...]) -> int:
        """Delete all files in a namespace. Returns count of deleted files."""
        namespace_list = list(namespace)
        count = 0
        for doc in self._files_collection.find({"metadata.namespace": namespace_list}):
            self._fs.delete(doc["_id"])
            count += 1
        return count

    def ensure_ttl_index(self, ttl_seconds: int = 604800) -> None:
        """Create TTL index on uploadDate for automatic expiry."""
        self._files_collection.create_index("uploadDate", expireAfterSeconds=ttl_seconds)


def _maybe_pretty_print_json(value: dict) -> None:
    """If value contains single-line JSON content, pretty-print it in place.

    This makes grep return individual matching lines instead of the entire blob.
    Modifies value["content"] in place.
    """
    content = value.get("content")
    if not isinstance(content, list) or len(content) != 1:
        return
    line = content[0]
    if not isinstance(line, str) or len(line) < 1000:
        return  # Not worth pretty-printing small content
    # Check if it starts with { or [ (fast heuristic before attempting parse)
    stripped = line.lstrip()
    if not stripped or stripped[0] not in ("{", "["):
        return
    try:
        parsed = json.loads(line)
        pretty = json.dumps(parsed, indent=2, ensure_ascii=False)
        value["content"] = pretty.split("\n")
        logger.debug("[gridfs] Pretty-printed JSON content: 1 line -> %d lines", len(value["content"]))
    except (json.JSONDecodeError, ValueError):
        pass


def _serialize_value(value: dict) -> str:
    """Serialize a value dict to JSON string for GridFS storage."""
    return json.dumps(value, ensure_ascii=False)


def _deserialize_value(content: str) -> dict:
    """Deserialize JSON string from GridFS back to a value dict."""
    return json.loads(content)


def _matches_filter(value: dict, filter_dict: dict) -> bool:
    """Check if a value matches the filter criteria."""
    for key, expected in filter_dict.items():
        actual = value.get(key)
        if actual != expected:
            return False
    return True


def _matches_suffix_conditions(
    namespace: tuple[str, ...],
    conditions: tuple[MatchCondition, ...],
) -> bool:
    """Check if namespace matches all suffix conditions."""
    for cond in conditions:
        if cond.match_type != "suffix":
            continue
        path = cond.path
        if len(namespace) < len(path):
            return False
        suffix = namespace[-len(path) :]
        for i, component in enumerate(path):
            if component != "*" and suffix[i] != component:
                return False
    return True
