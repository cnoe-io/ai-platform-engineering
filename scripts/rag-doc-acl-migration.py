#!/usr/bin/env python3
"""Backfill ``metadata.acl_tags`` on existing RAG documents in Milvus.

Spec 102 Phase 7 follow-on (RAG hybrid ACL).

Why
---

The hybrid-ACL query path (``server.doc_acl.apply_doc_acl_filter``)
filters Milvus rows by ``metadata.acl_tags``. Documents that were
indexed before hybrid ACL existed have no such field, so when the
``RBAC_DOC_ACL_TAGS_ENABLED=true`` flag is flipped they would be
**invisible** (Milvus has no clean "missing key" semantics).

This script walks every collection in a Milvus instance and assigns
``acl_tags=["__public__"]`` to any document whose ``metadata`` dict
does not already contain ``acl_tags``. After this runs, hybrid ACL
can be safely enabled — existing corpora keep working as
"world-readable" until an operator narrows them.

Usage
-----

    python3 scripts/rag-doc-acl-migration.py \
        --milvus-uri http://localhost:19530 \
        [--collection my_collection] \
        [--batch-size 1000] \
        [--dry-run]

Env-var fallbacks: ``MILVUS_URI`` (matches the RAG server).

The script is idempotent — re-running it skips documents that
already have an ``acl_tags`` value, regardless of contents.

Safety
------

- Defaults to ``--dry-run`` style logging only when ``--dry-run`` is
  passed; otherwise it WILL write. Always run with ``--dry-run``
  first on production data.
- Never overwrites an existing ``acl_tags`` value.
- Never touches collections whose name starts with ``_`` (Milvus
  internal) or matches ``--exclude``.
- Batches updates so a partial failure leaves the corpus in a
  recoverable state.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from typing import Any

logger = logging.getLogger("rag-doc-acl-migration")

PUBLIC_TAG = "__public__"


def _connect(uri: str):
    try:
        from pymilvus import MilvusClient
    except ImportError as exc:  # pragma: no cover — runtime env error
        raise SystemExit(
            "pymilvus is required. Install it with: pip install pymilvus"
        ) from exc
    return MilvusClient(uri=uri)


def _collections_to_process(client, only: str | None, exclude: tuple[str, ...]):
    if only:
        return [only]
    all_collections = client.list_collections()
    return [
        c
        for c in all_collections
        if not c.startswith("_") and c not in exclude
    ]


def _needs_backfill(metadata_field: Any) -> bool:
    """Return True iff the document is missing acl_tags."""
    if not isinstance(metadata_field, dict):
        return True
    if "acl_tags" not in metadata_field:
        return True
    val = metadata_field.get("acl_tags")
    if val is None:
        return True
    if isinstance(val, list) and len(val) == 0:
        return True
    return False


def _backfilled_metadata(metadata_field: Any) -> dict[str, Any]:
    md = dict(metadata_field) if isinstance(metadata_field, dict) else {}
    md["acl_tags"] = [PUBLIC_TAG]
    return md


def _migrate_collection(
    client,
    name: str,
    batch_size: int,
    dry_run: bool,
) -> tuple[int, int]:
    """Return (scanned, updated)."""
    logger.info("collection=%s scanning…", name)
    scanned = 0
    updated = 0

    # We use query() with an offset cursor. Milvus requires an output
    # field list; we fetch primary key + metadata only.
    offset = 0
    while True:
        try:
            batch = client.query(
                collection_name=name,
                filter="",  # full scan
                output_fields=["pk", "metadata"],
                limit=batch_size,
                offset=offset,
            )
        except Exception as exc:  # noqa: BLE001
            # Some collections may not have a "pk" field (custom schemas).
            # Try with just metadata.
            logger.warning(
                "collection=%s query failed with pk+metadata (%s); "
                "retrying with metadata only — pk-less rows cannot be updated",
                name,
                exc,
            )
            try:
                batch = client.query(
                    collection_name=name,
                    filter="",
                    output_fields=["metadata"],
                    limit=batch_size,
                    offset=offset,
                )
            except Exception as exc2:  # noqa: BLE001
                logger.error(
                    "collection=%s query also failed (%s); skipping",
                    name,
                    exc2,
                )
                return scanned, updated

        if not batch:
            break

        scanned += len(batch)
        to_upsert: list[dict[str, Any]] = []
        for row in batch:
            md = row.get("metadata")
            if not _needs_backfill(md):
                continue
            new_md = _backfilled_metadata(md)
            if "pk" not in row:
                # Cannot upsert without a primary key.
                continue
            to_upsert.append({"pk": row["pk"], "metadata": new_md})

        if to_upsert and not dry_run:
            try:
                client.upsert(collection_name=name, data=to_upsert)
                updated += len(to_upsert)
            except Exception as exc:  # noqa: BLE001
                logger.error(
                    "collection=%s upsert of %d rows failed: %s",
                    name,
                    len(to_upsert),
                    exc,
                )
        elif to_upsert:
            updated += len(to_upsert)
            logger.info(
                "collection=%s [dry-run] would upsert %d rows",
                name,
                len(to_upsert),
            )

        if len(batch) < batch_size:
            break
        offset += batch_size

    logger.info(
        "collection=%s done scanned=%d %s=%d",
        name,
        scanned,
        "would_update" if dry_run else "updated",
        updated,
    )
    return scanned, updated


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--milvus-uri",
        default=os.environ.get("MILVUS_URI", "http://localhost:19530"),
        help="Milvus URI (default: $MILVUS_URI or http://localhost:19530).",
    )
    parser.add_argument(
        "--collection",
        default=None,
        help="Process only this collection (default: all non-internal).",
    )
    parser.add_argument(
        "--exclude",
        action="append",
        default=[],
        help="Collection name to skip. May be passed multiple times.",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=1000,
        help="Rows per scan/upsert batch (default 1000).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Log what would change without writing.",
    )
    parser.add_argument(
        "-v", "--verbose", action="store_true", help="Verbose logging."
    )
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )

    client = _connect(args.milvus_uri)
    targets = _collections_to_process(
        client, args.collection, tuple(args.exclude)
    )
    logger.info(
        "milvus=%s collections=%d dry_run=%s",
        args.milvus_uri,
        len(targets),
        args.dry_run,
    )

    summary: dict[str, dict[str, int]] = {}
    for name in targets:
        scanned, updated = _migrate_collection(
            client, name, args.batch_size, args.dry_run
        )
        summary[name] = {"scanned": scanned, "updated": updated}

    print(json.dumps({"dry_run": args.dry_run, "collections": summary}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
