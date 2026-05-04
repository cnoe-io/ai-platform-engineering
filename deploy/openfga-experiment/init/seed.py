#!/usr/bin/env python3
"""One-shot OpenFGA seed: store (idempotent), authorization model, optional tuple."""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

import httpx

OPENFGA = os.environ.get("OPENFGA_HTTP", "http://openfga-exp:8080").rstrip("/")
STORE_NAME = os.environ.get("OPENFGA_STORE_NAME", "caipe-openfga-experiment").strip()
EXPERIMENT_SUB = os.environ.get("OPENFGA_EXPERIMENT_SUB", "").strip()


def wait_ready() -> None:
    for i in range(60):
        try:
            r = httpx.get(f"{OPENFGA}/v1/stores", timeout=2.0)
            if r.status_code == 200:
                return
        except httpx.HTTPError:
            pass
        time.sleep(1)
        print(f"waiting for OpenFGA ({i + 1}/60)...", file=sys.stderr)
    sys.exit("OpenFGA did not become ready")


def main() -> None:
    wait_ready()

    with httpx.Client(timeout=60.0) as client:
        r = client.get(f"{OPENFGA}/v1/stores")
        r.raise_for_status()
        stores = r.json().get("stores", [])
        store_id = next((s["id"] for s in stores if s.get("name") == STORE_NAME), None)
        if not store_id:
            r = client.post(f"{OPENFGA}/v1/stores", json={"name": STORE_NAME})
            r.raise_for_status()
            store_id = r.json()["id"]
            print(f"created store_id={store_id}")
        else:
            print(f"reusing store_id={store_id}")

        model_path = Path(__file__).resolve().parent / "authorization-model.json"
        model_body = json.loads(model_path.read_text())
        r = client.post(
            f"{OPENFGA}/v1/stores/{store_id}/authorization-models",
            json=model_body,
        )
        r.raise_for_status()
        model_id = r.json()["authorization_model_id"]
        print(f"authorization_model_id={model_id}")

        if EXPERIMENT_SUB:
            w = {
                "writes": {
                    "tuple_keys": [
                        {
                            "user": f"user:{EXPERIMENT_SUB}",
                            "relation": "can_call",
                            "object": "document:mcp",
                        }
                    ]
                }
            }
            r = client.post(f"{OPENFGA}/v1/stores/{store_id}/write", json=w)
            r.raise_for_status()
            print(f"tuple written for user:{EXPERIMENT_SUB} can_call document:mcp")
        else:
            print(
                "OPENFGA_EXPERIMENT_SUB not set — no tuple written; "
                "set it to your Keycloak `sub` and re-run: "
                "docker compose ... run --rm openfga-exp-init",
                file=sys.stderr,
            )


if __name__ == "__main__":
    main()
