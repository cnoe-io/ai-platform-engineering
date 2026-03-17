---
sidebar_position: 2
sidebar_label: Specification
title: "2026-02-25: CAIPE UI Test Coverage Improvement Plan"
---

# CAIPE UI Test Coverage Improvement Plan

**Status**: Planned
**Category**: Testing / Quality
**Date**: February 25, 2026
**Estimated Effort**: 12–18 working days (2.5–3.5 weeks)

## Overview

Comprehensive plan to improve CAIPE UI unit test coverage from ~31% file coverage (~55 of ~175 source files) to near-complete coverage. This ADR captures the current state analysis, identified gaps, and a phased implementation plan.


## Related

- Test suite output: `make caipe-ui-tests` (72 suites, 1,804 tests as of Feb 25, 2026)
- Existing test patterns: `ui/src/app/api/__tests__/`, `ui/src/components/__tests__/`, `ui/src/hooks/__tests__/`
- Conversation fixture generator: `ui/src/__test-utils__/conversation-fixtures.ts`
- Related work: Spinner/loading fix and auth redirect `callbackUrl` preservation tests added Feb 24, 2026


- Architecture: [architecture.md](./architecture.md)
