"""HTTP ext_authz target for AgentGateway — calls OpenFGA Check.

AgentGateway HTTP ext_authz: 2xx = allow, non-2xx = deny.

Security note (dev experiment only):
  JWT payload is decoded **without signature verification** to read `sub`.
  Production must verify via JWKS or trust metadata from AGW gRPC ext_authz instead.
"""

from __future__ import annotations

import os
import sys
from contextlib import asynccontextmanager

import httpx
import jwt
from fastapi import FastAPI, Request, Response

OPENFGA_HTTP = os.environ.get("OPENFGA_HTTP", "http://openfga-exp:8080").rstrip("/")
OPENFGA_STORE_NAME = os.environ.get("OPENFGA_STORE_NAME", "caipe-openfga-experiment").strip()
# Optional explicit store id (skips discovery)
STORE_ID: str = os.environ.get("OPENFGA_STORE_ID", "").strip()
# Optional: if set, only these subs get 200 without calling OpenFGA (escape hatch)
BYPASS_SUBS = frozenset(
    s.strip() for s in os.environ.get("OPENFGA_BYPASS_SUBS", "").split(",") if s.strip()
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    global STORE_ID
    if STORE_ID:
        yield
        return
    async with httpx.AsyncClient(timeout=15.0) as client:
        r = await client.get(f"{OPENFGA_HTTP}/v1/stores")
        r.raise_for_status()
        for s in r.json().get("stores", []):
            if s.get("name") == OPENFGA_STORE_NAME:
                STORE_ID = s["id"]
                print(f"[bridge] discovered store id={STORE_ID}", file=sys.stderr)
                break
    if not STORE_ID:
        print(
            f"[bridge] No store named {OPENFGA_STORE_NAME!r} — all checks will deny",
            file=sys.stderr,
        )
    yield


app = FastAPI(title="openfga-agw-extauthz-bridge", version="0.1.0", lifespan=lifespan)


def _check_openfga(user: str, relation: str, obj: str) -> bool:
    if not STORE_ID:
        return False
    url = f"{OPENFGA_HTTP}/v1/stores/{STORE_ID}/check"
    body: dict = {
        "tuple_key": {"user": user, "relation": relation, "object": obj},
    }
    with httpx.Client(timeout=10.0) as client:
        r = client.post(url, json=body)
        r.raise_for_status()
        return bool(r.json().get("allowed"))


@app.api_route("/check", methods=["GET", "POST", "PUT", "PATCH", "HEAD", "DELETE", "OPTIONS"])
async def ext_authz_check(request: Request) -> Response:
    """Single path for AGW `protocol.http.path: '\"/check\"'`."""
    auth = request.headers.get("authorization") or request.headers.get("Authorization") or ""
    if not auth.startswith("Bearer "):
        return Response(status_code=401)
    token = auth[7:].strip()
    try:
        payload = jwt.decode(token, options={"verify_signature": False})
    except jwt.PyJWTError:
        return Response(status_code=401)
    sub = payload.get("sub")
    if not isinstance(sub, str) or not sub:
        return Response(status_code=401)

    if sub in BYPASS_SUBS:
        return Response(status_code=200)

    user = f"user:{sub}"
    relation = os.environ.get("OPENFGA_RELATION", "can_call")
    obj = os.environ.get("OPENFGA_OBJECT", "document:mcp")
    try:
        allowed = _check_openfga(user, relation, obj)
    except Exception as e:
        print(f"[bridge] OpenFGA check error: {e}", file=sys.stderr)
        return Response(status_code=503)

    return Response(status_code=200 if allowed else 403)


@app.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok"}
