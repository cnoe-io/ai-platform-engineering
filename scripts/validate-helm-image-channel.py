#!/usr/bin/env python3
"""Validate CAIPE Helm image channel defaults.

Pre-release charts should default maintained CAIPE images to the
``ghcr.io/cnoe-io/pre-release`` repository namespace. Operators can opt
into root published images with ``global.image.channel=release``.
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path


PARENT_EXPECTED_IMAGE_NAMES = (
    "mcp-argocd",
    "caipe-ui",
    "caipe-dynamic-agents",
    "caipe-slack-bot",
    "caipe-webex-bot",
    "keycloak-init",
    "openfga-authz-bridge",
    "skill-scanner",
)

RAG_EXPECTED_IMAGE_NAMES = (
    "caipe-rag-server",
    "caipe-rag-ingestors",
    "caipe-rag-agent-ontology",
)


PARENT_HELM_ARGS = (
    "--set",
    "tags.basic=true",
    "--set",
    "tags.caipe-ui=true",
    "--set",
    "tags.dynamic-agents=true",
    "--set",
    "tags.slack-bot=true",
    "--set",
    "tags.webex-bot=true",
    "--set",
    "tags.keycloak=true",
    "--set",
    "keycloak.admin.secretRef=caipe-keycloak-admin",
    "--set",
    "global.skillScanner.enabled=true",
    "--set",
    "openfgaAuthzBridge.enabled=true",
    "--set",
    "openfga-authz-bridge.tokenValidation.issuer=https://idp.example.com/realms/caipe",
    "--set",
    "openfga-authz-bridge.tokenValidation.audiences[0]=agentgateway",
)

RAG_SUBCHART_HELM_ARGS = (
    "--set",
    "global.vpa.enabled=false",
    "--set",
    "global.image.tag=",
)


def render_chart(chart: Path, helm_args: tuple[str, ...], *extra_args: str) -> str:
    command = (
        "helm",
        "template",
        "image-channel-test",
        str(chart),
        *helm_args,
        *extra_args,
    )
    result = subprocess.run(
        command,
        check=True,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    return result.stdout


def rendered_images(manifest: str) -> set[str]:
    images: set[str] = set()
    for line in manifest.splitlines():
        match = re.match(r"^\s*image:\s*[\"']?([^\"'\s]+)", line)
        if match:
            images.add(match.group(1))
    return images


def render_rag_subcharts(rag_chart: Path, *extra_args: str) -> set[str]:
    images: set[str] = set()
    for subchart in ("rag-server", "rag-ingestors", "agent-ontology"):
        manifest = render_chart(
            rag_chart / "charts" / subchart,
            RAG_SUBCHART_HELM_ARGS,
            *extra_args,
        )
        images.update(rendered_images(manifest))
    return images


def require_images(images: set[str], prefix: str, image_names: tuple[str, ...]) -> list[str]:
    missing: list[str] = []
    for name in image_names:
        expected_prefix = f"{prefix}/{name}:"
        if not any(image.startswith(expected_prefix) for image in images):
            missing.append(f"{expected_prefix}<tag>")
    return missing


def forbid_images(images: set[str], prefix: str, image_names: tuple[str, ...]) -> list[str]:
    forbidden: list[str] = []
    for name in image_names:
        forbidden_prefix = f"{prefix}/{name}:"
        forbidden.extend(sorted(image for image in images if image.startswith(forbidden_prefix)))
    return forbidden


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--chart",
        default="charts/ai-platform-engineering",
        type=Path,
        help="Path to the ai-platform-engineering chart",
    )
    parser.add_argument(
        "--rag-chart",
        default="charts/rag-stack",
        type=Path,
        help="Path to the rag-stack chart",
    )
    args = parser.parse_args()

    default_images = rendered_images(render_chart(args.chart, PARENT_HELM_ARGS))
    auto_images = rendered_images(
        render_chart(args.chart, PARENT_HELM_ARGS, "--set", "global.image.channel=auto")
    )
    release_images = rendered_images(
        render_chart(args.chart, PARENT_HELM_ARGS, "--set", "global.image.channel=release")
    )
    default_rag_images = render_rag_subcharts(args.rag_chart)
    auto_rag_images = render_rag_subcharts(args.rag_chart, "--set", "global.image.channel=auto")
    release_rag_images = render_rag_subcharts(args.rag_chart, "--set", "global.image.channel=release")

    missing_default = require_images(
        default_images,
        "ghcr.io/cnoe-io/pre-release",
        PARENT_EXPECTED_IMAGE_NAMES,
    ) + require_images(
        default_rag_images,
        "ghcr.io/cnoe-io/pre-release",
        RAG_EXPECTED_IMAGE_NAMES,
    )
    missing_auto = require_images(
        auto_images,
        "ghcr.io/cnoe-io/pre-release",
        PARENT_EXPECTED_IMAGE_NAMES,
    ) + require_images(
        auto_rag_images,
        "ghcr.io/cnoe-io/pre-release",
        RAG_EXPECTED_IMAGE_NAMES,
    )
    missing_release = require_images(
        release_images,
        "ghcr.io/cnoe-io",
        PARENT_EXPECTED_IMAGE_NAMES,
    ) + require_images(
        release_rag_images,
        "ghcr.io/cnoe-io",
        RAG_EXPECTED_IMAGE_NAMES,
    )
    forbidden_default = forbid_images(
        default_images,
        "ghcr.io/cnoe-io",
        PARENT_EXPECTED_IMAGE_NAMES,
    ) + forbid_images(
        default_rag_images,
        "ghcr.io/cnoe-io",
        RAG_EXPECTED_IMAGE_NAMES,
    )
    forbidden_auto = forbid_images(
        auto_images,
        "ghcr.io/cnoe-io",
        PARENT_EXPECTED_IMAGE_NAMES,
    ) + forbid_images(
        auto_rag_images,
        "ghcr.io/cnoe-io",
        RAG_EXPECTED_IMAGE_NAMES,
    )
    forbidden_release = forbid_images(
        release_images,
        "ghcr.io/cnoe-io/pre-release",
        PARENT_EXPECTED_IMAGE_NAMES,
    ) + forbid_images(
        release_rag_images,
        "ghcr.io/cnoe-io/pre-release",
        RAG_EXPECTED_IMAGE_NAMES,
    )

    if (
        missing_default
        or missing_auto
        or missing_release
        or forbidden_default
        or forbidden_auto
        or forbidden_release
    ):
        if missing_default:
            print("Missing default pre-release images:", file=sys.stderr)
            print("\n".join(f"  - {image}" for image in missing_default), file=sys.stderr)
        if missing_auto:
            print("Missing auto-channel pre-release images:", file=sys.stderr)
            print("\n".join(f"  - {image}" for image in missing_auto), file=sys.stderr)
        if missing_release:
            print("Missing release-channel images:", file=sys.stderr)
            print("\n".join(f"  - {image}" for image in missing_release), file=sys.stderr)
        if forbidden_default:
            print("Default channel rendered release images:", file=sys.stderr)
            print("\n".join(f"  - {image}" for image in forbidden_default), file=sys.stderr)
        if forbidden_auto:
            print("Auto channel rendered release images:", file=sys.stderr)
            print("\n".join(f"  - {image}" for image in forbidden_auto), file=sys.stderr)
        if forbidden_release:
            print("Release channel rendered pre-release images:", file=sys.stderr)
            print("\n".join(f"  - {image}" for image in forbidden_release), file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
