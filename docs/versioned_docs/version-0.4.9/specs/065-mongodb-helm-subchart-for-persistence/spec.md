---
sidebar_position: 2
sidebar_label: Specification
title: "2026-02-03: MongoDB Helm Subchart for CAIPE UI Persistence"
---

# MongoDB Helm Subchart for CAIPE UI Persistence

**Date**: 2026-02-03
**Status**: Implemented
**Type**: Feature Addition

## Summary

Added a MongoDB Helm subchart to the ai-platform-engineering chart to provide persistent storage for CAIPE UI chat history and workflows. The subchart includes StatefulSet deployment with PVC/PV support, external secrets integration, and comprehensive configuration options for production and development environments.

## Motivation

CAIPE UI previously supported two storage modes:
1. **localStorage**: Client-side only, data lost on browser clear, no sharing
2. **MongoDB (external)**: Required users to deploy MongoDB separately

Users needed a simpler way to enable persistent, shareable chat history without managing separate MongoDB deployments. The platform needed:
- One-command deployment with MongoDB included
- Persistent storage with proper PVC/PV management
- Production-ready security with external secrets support
- Easy migration from localStorage to MongoDB

## Related

- MongoDB Chart: `charts/ai-platform-engineering/charts/caipe-ui-mongodb/`
- Setup Guide: [2026-02-03-mongodb-setup-guide](../066-mongodb-setup-guide/architecture.md)
- Example Values: `charts/ai-platform-engineering/values-mongodb.yaml.example`
- MongoDB Documentation: https://docs.mongodb.com/
- Kubernetes StatefulSets: https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/

- Architecture: [architecture.md](./architecture.md)
