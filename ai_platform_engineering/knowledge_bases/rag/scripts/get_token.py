#!/usr/bin/env python3
"""
Get a Bearer token using OAuth2 client credentials flow.

Usage:
    python scripts/get_token.py --issuer https://your-idp/realms/myrealm \
                                 --client-id my-client \
                                 --client-secret my-secret

    # Or pick up values from env:
    OIDC_ISSUER=... INGESTOR_OIDC_CLIENT_ID=... INGESTOR_OIDC_CLIENT_SECRET=... \
        python scripts/get_token.py
"""
import argparse
import os
import sys

import httpx


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


def main():
    parser = argparse.ArgumentParser(description="Fetch a Bearer token via client credentials")
    parser.add_argument("--issuer", default=os.getenv("OIDC_ISSUER") or os.getenv("INGESTOR_OIDC_ISSUER"))
    parser.add_argument("--client-id", default=os.getenv("INGESTOR_OIDC_CLIENT_ID") or os.getenv("OIDC_CLIENT_ID"))
    parser.add_argument("--client-secret", default=os.getenv("INGESTOR_OIDC_CLIENT_SECRET") or os.getenv("OIDC_CLIENT_SECRET"))
    args = parser.parse_args()

    missing = [name for name, val in [("--issuer", args.issuer), ("--client-id", args.client_id), ("--client-secret", args.client_secret)] if not val]
    if missing:
        print(f"Error: missing required args: {', '.join(missing)}", file=sys.stderr)
        parser.print_help()
        sys.exit(1)

    token = get_token(args.issuer, args.client_id, args.client_secret)
    print(token)


if __name__ == "__main__":
    main()
