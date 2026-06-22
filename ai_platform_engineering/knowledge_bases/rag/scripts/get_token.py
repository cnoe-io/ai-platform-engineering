#!/usr/bin/env python3
"""
Get a Bearer token using OAuth2 client credentials flow.

Usage:
    python scripts/get_token.py --issuer https://your-idp/realms/myrealm \
                                 --client-id my-client \
                                 --client-secret my-secret \
                                 --output-file /tmp/rag-ingestor-token

    # Or pick up values from env:
    OIDC_ISSUER=... INGESTOR_OIDC_CLIENT_ID=... INGESTOR_OIDC_CLIENT_SECRET=... \
        python scripts/get_token.py --output-file /tmp/rag-ingestor-token
"""
import argparse
import os
import sys

import httpx

# assisted-by Codex Codex-sonnet-4-6


def get_token(issuer: str, client_id: str, client_secret: str) -> str:
    # Discover token endpoint
    discovery_url = f"{issuer.rstrip('/')}/.well-known/openid-configuration"
    resp = httpx.get(discovery_url, timeout=10, follow_redirects=True)
    resp.raise_for_status()
    token_endpoint = resp.json()["token_endpoint"]

    # Client credentials grant
    resp = httpx.post(
        token_endpoint,
        data={
            "grant_type": "client_credentials",
            "client_id": client_id,
            "client_secret": client_secret,
        },
        timeout=10,
    )
    resp.raise_for_status()
    return resp.json()["access_token"]


def write_token_file(path: str, token: str) -> None:
    flags = os.O_WRONLY | os.O_CREAT | os.O_TRUNC
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    fd = os.open(path, flags, 0o600)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            fd = -1
            handle.write(token)
            handle.write("\n")
    finally:
        if fd != -1:
            os.close(fd)


def main() -> int:
    parser = argparse.ArgumentParser(description="Fetch a Bearer token via client credentials")
    parser.add_argument("--issuer", default=os.getenv("OIDC_ISSUER") or os.getenv("INGESTOR_OIDC_ISSUER"))
    parser.add_argument("--client-id", default=os.getenv("INGESTOR_OIDC_CLIENT_ID") or os.getenv("OIDC_CLIENT_ID"))
    parser.add_argument("--client-secret", default=os.getenv("INGESTOR_OIDC_CLIENT_SECRET") or os.getenv("OIDC_CLIENT_SECRET"))
    parser.add_argument(
        "--output-file",
        help="Write the bearer token to this file with mode 0600.",
    )
    args = parser.parse_args()

    if not (args.issuer and args.client_id and args.client_secret):
        print("Error: one or more required arguments are missing.", file=sys.stderr)
        parser.print_help()
        return 1

    token = get_token(args.issuer, args.client_id, args.client_secret)
    if args.output_file:
        write_token_file(args.output_file, token)
        print(f"Token written to {args.output_file} with file mode 0600.", file=sys.stderr)
    else:
        print("Token acquired. Re-run with --output-file PATH to store it in a 0600 file.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
