---
sidebar_position: 2
sidebar_label: Specification
title: "2026-02-03: CAIPE UI Ingress Configuration Guide"
---

# CAIPE UI Ingress Configuration Guide

**Date**: 2026-02-03
**Status**: Reference Guide
**Type**: Configuration Documentation

## Summary

This document describes the comprehensive ingress configuration options for CAIPE UI, including multiple hostnames, custom annotations, automatic redirects, TLS/SSL support, and path-based routing.


## Features

The CAIPE UI Helm chart supports:

1. **Multiple Hostnames** - Serve the application on multiple domains
2. **Custom Annotations** - Add any NGINX ingress annotations
3. **Automatic Redirects** - Redirect old domains to new domains (useful for migrations)
4. **TLS/SSL Support** - Automatic certificate provisioning with cert-manager
5. **Path-based Routing** - Configure different paths for different hosts


## Related

- [Kubernetes Ingress](https://kubernetes.io/docs/concepts/services-networking/ingress/)
- [NGINX Ingress Controller](https://kubernetes.github.io/ingress-nginx/)
- [NGINX Ingress Annotations](https://kubernetes.github.io/ingress-nginx/user-guide/nginx-configuration/annotations/)
- [cert-manager](https://cert-manager.io/docs/)


- Architecture: [architecture.md](./architecture.md)
