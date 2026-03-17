---
sidebar_position: 2
sidebar_label: Specification
title: "2026-02-03: Ingress Redirect Template for Domain Migration"
---

# Ingress Redirect Template for Domain Migration

**Date**: 2026-02-03
**Status**: Implemented
**Type**: Feature Addition

## Summary

Added an optional ingress redirect template to the CAIPE UI Helm chart that creates separate ingress resources for redirecting old domains to new domains. This enables zero-downtime domain migrations with automatic HTTP 301 permanent redirects while maintaining SEO, bookmarks, and user sessions.


## Motivation

Organizations frequently need to migrate applications to new domain names due to:
- **Rebranding**: Company or product name changes
- **Domain Consolidation**: Merging multiple domains into one
- **Infrastructure Changes**: Moving to new infrastructure or cloud providers
- **SEO Improvements**: Better domain names for discoverability

Manual redirect configuration is error-prone and varies across ingress controllers. Users needed:
- Declarative redirect configuration via Helm values
- Automatic TLS certificate provisioning for old domains
- Clean separation between primary and redirect ingresses
- Preservation of request paths and query parameters


## Related

- Ingress Guide: [CAIPE UI Ingress Configuration Guide](2026-02-03-caipe-ui-ingress-configuration-guide.md)
- Example Config: `charts/caipe-ui/values-ingress-redirect.yaml.example`
- NGINX Ingress Annotations: https://kubernetes.github.io/ingress-nginx/user-guide/nginx-configuration/annotations/
- HTTP Status Codes: https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/301
- SEO Best Practices: https://developers.google.com/search/docs/crawling-indexing/301-redirects


- Architecture: [architecture.md](./architecture.md)
