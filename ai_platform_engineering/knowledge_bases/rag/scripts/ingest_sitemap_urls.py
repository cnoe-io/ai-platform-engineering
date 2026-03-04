#!/usr/bin/env python3
"""
Ingest every URL in a sitemap as a separate datasource.

Usage:
    python scripts/ingest_sitemap_urls.py
    python scripts/ingest_sitemap_urls.py --sitemap https://example.com/sitemap.xml
    python scripts/ingest_sitemap_urls.py --server http://localhost:9446 --token <bearer>
    python scripts/ingest_sitemap_urls.py --dry-run          # print URLs, don't ingest
    python scripts/ingest_sitemap_urls.py --concurrency 5    # parallel ingest requests
"""
import argparse
import asyncio
import sys
import xml.etree.ElementTree as ET

import httpx

DEFAULT_SITEMAP = "https://outshift.cisco.com/sitemap.xml"
DEFAULT_SERVER = "http://localhost:9446"


def parse_sitemap(content: str) -> list[str]:
    root = ET.fromstring(content)
    ns = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}
    return [loc.text.strip() for loc in root.findall(".//sm:loc", ns) if loc.text]


async def ingest_url(client: httpx.AsyncClient, server: str, url: str) -> tuple[str, bool, str]:
    try:
        resp = await client.post(
            f"{server}/v1/ingest/webloader/url",
            json={"url": url, "description": f"Outshift page: {url}"},
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()
        return url, True, data.get("datasource_id", "")
    except httpx.HTTPStatusError as e:
        return url, False, f"HTTP {e.response.status_code}: {e.response.text[:200]}"
    except Exception as e:
        return url, False, str(e)


async def main():
    parser = argparse.ArgumentParser(description="Ingest each sitemap URL as a separate datasource")
    parser.add_argument("--sitemap", default=DEFAULT_SITEMAP)
    parser.add_argument("--server", default=DEFAULT_SERVER)
    parser.add_argument("--token", default=None, help="Bearer token (or set BEARER_TOKEN env)")
    parser.add_argument("--concurrency", type=int, default=3, help="Parallel requests (default: 3)")
    parser.add_argument("--dry-run", action="store_true", help="Print URLs without ingesting")
    args = parser.parse_args()

    import os
    token = args.token or os.getenv("BEARER_TOKEN")
    headers = {"Authorization": f"Bearer {token}"} if token else {}

    # Fetch sitemap
    print(f"Fetching sitemap: {args.sitemap}")
    async with httpx.AsyncClient(follow_redirects=True) as client:
        resp = await client.get(args.sitemap, timeout=15)
        resp.raise_for_status()

    urls = parse_sitemap(resp.text)
    print(f"Found {len(urls)} URLs\n")

    if args.dry_run:
        for u in urls:
            print(u)
        return

    sem = asyncio.Semaphore(args.concurrency)
    ok = fail = 0

    async def bounded(client, url):
        async with sem:
            return await ingest_url(client, args.server, url)

    async with httpx.AsyncClient(headers=headers, follow_redirects=True) as client:
        tasks = [bounded(client, u) for u in urls]
        for i, coro in enumerate(asyncio.as_completed(tasks), 1):
            url, success, detail = await coro
            if success:
                ok += 1
                print(f"[{i}/{len(urls)}] ✓  {url}  →  {detail}")
            else:
                fail += 1
                print(f"[{i}/{len(urls)}] ✗  {url}  →  {detail}", file=sys.stderr)

    print(f"\nDone: {ok} ingested, {fail} failed")
    if fail:
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
