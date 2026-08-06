import asyncio
from unittest import TestCase

import httpx

from tome_agent.agent.verbatim_pages import VerbatimPage, fetch_verbatim_pages


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


class FetchVerbatimPagesTest(TestCase):
    def test_fetches_only_markdown_files_from_pages_dir(self) -> None:
        listing = [
            {
                "name": "overview.md",
                "type": "file",
                "sha": "abc123",
                "download_url": "https://raw.example.test/overview.md",
            },
            {
                "name": "notes.txt",
                "type": "file",
                "sha": "def456",
                "download_url": "https://raw.example.test/notes.txt",
            },
            {
                "name": "subdir",
                "type": "dir",
                "sha": "ghi789",
                "download_url": None,
            },
        ]

        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.path.endswith("/contents/.tome/pages"):
                return httpx.Response(200, json=listing)
            if str(request.url) == "https://raw.example.test/overview.md":
                return httpx.Response(200, text="# Overview\n\nReal content.\n")
            raise AssertionError(f"unexpected request: {request.url}")

        import tome_agent.agent.verbatim_pages as mod

        original_client = mod.httpx.AsyncClient
        mod.httpx.AsyncClient = lambda *a, **kw: original_client(
            *a, **{**kw, "transport": httpx.MockTransport(handler)}
        )
        try:
            result = _run(fetch_verbatim_pages(["https://github.com/acme/widgets"], token="tok"))
        finally:
            mod.httpx.AsyncClient = original_client

        self.assertEqual(
            result,
            [VerbatimPage(repo="acme/widgets", name="overview", body="# Overview\n\nReal content.\n", sha="abc123")],
        )

    def test_missing_pages_dir_returns_empty(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(404)

        import tome_agent.agent.verbatim_pages as mod

        original_client = mod.httpx.AsyncClient
        mod.httpx.AsyncClient = lambda *a, **kw: original_client(
            *a, **{**kw, "transport": httpx.MockTransport(handler)}
        )
        try:
            result = _run(fetch_verbatim_pages(["https://github.com/acme/widgets"]))
        finally:
            mod.httpx.AsyncClient = original_client

        self.assertEqual(result, [])

    def test_no_repos_short_circuits_without_a_request(self) -> None:
        result = _run(fetch_verbatim_pages([]))
        self.assertEqual(result, [])
