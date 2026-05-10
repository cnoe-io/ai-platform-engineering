---
sidebar_position: 2
sidebar_label: Specification
title: "2026-02-10: UI Scroll Performance & Rendering Fixes"
---

# UI Scroll Performance & Rendering Fixes

**Date**: 2026-02-10
**Status**: Implemented
**Author**: Sri Aradhyula `<sraradhy@cisco.com>`

## Motivation

The CAIPE UI was experiencing performance issues in three areas:

1. **Thinking messages**: Auto-scroll forced users to the bottom on every 100ms content update, causing layout thrashing and preventing users from reading earlier content.
2. **A2A Debug panel**: Broken scroll (ref pointed to non-scrollable element), all events rendered without virtualization, and excessive re-renders from broad Zustand store subscriptions.
3. **History rendering**: No `React.memo` on any component, causing the entire message list to re-render on every streaming update. `ReactMarkdown` ran on every token chunk during streaming.


## Related

- Architecture: [architecture.md](./architecture.md)
