"""Caller-authenticated submission to the configured service desk, without a GitHub token in model context."""

import hashlib
from collections.abc import Callable

import requests
from langchain_core.tools import StructuredTool, tool


def create_service_desk_tool(
    base_url: str, token_provider: Callable[[], str], conversation_id: str
) -> StructuredTool:
    @tool
    def submit_service_desk_ticket(title: str, description: str) -> dict:
        """Submit a support ticket after the user approves this title and description.

        Use only when the user's GitHub connection is unavailable or issue creation
        definitively failed with 401, 403 or 404. Never use after a timeout or an
        uncertain write result; first verify whether an issue was created.
        The server fixes the repository, labels and reporter. Returns the real issue URL.
        """
        token = token_provider().strip()
        if not token or not conversation_id:
            return {"error": "An authenticated chat is required for service-desk submission."}
        title, description = title.strip(), description.strip()
        if not title or len(title) > 256 or not description or len(description) > 50000:
            return {"error": "Provide a title of 1–256 characters and a description of 1–50000 characters."}
        request_id = hashlib.sha256(f"{conversation_id}\0{title}\0{description}".encode()).hexdigest()
        try:
            response = requests.post(
                f"{base_url.rstrip('/')}/api/tickets/service-desk",
                headers={"Authorization": token if token.lower().startswith("bearer ") else f"Bearer {token}"},
                json={
                    "title": title,
                    "description": description,
                    "conversationId": conversation_id,
                    "requestId": request_id,
                },
                timeout=30,
                allow_redirects=False,
            )
        except requests.RequestException:
            return {"error": "Submission outcome is unknown. Check the service desk before trying another submission."}
        if response.status_code != 200:
            return {"error": f"Service-desk submission returned HTTP {response.status_code}. Preserve the draft; do not claim success."}
        try:
            payload = response.json()
            result = payload["data"]
            if payload.get("success") is not True or not result.get("url") or not result.get("id"):
                raise ValueError("Missing ticket result")
        except (ValueError, KeyError, TypeError, AttributeError):
            return {"error": "Submission outcome is unknown. Check the service desk before trying another submission."}
        return {"id": result["id"], "url": result["url"], "provider": "github", "submitted_via": "service_desk"}

    return submit_service_desk_ticket
