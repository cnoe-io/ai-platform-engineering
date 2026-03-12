# Spec: Enterprise Identity Federation Architecture Docs + Git Worktree Workflow

## Overview

Add the Enterprise Identity Federation and User Impersonation architecture document to the CAIPE docs site, and update all developer-facing rules files to reflect the git worktree workflow with the corrected `prebuild/<type>/<description>` branch naming convention.

## Motivation

The enterprise identity federation document describes a critical security architecture pattern — propagating enterprise user identity through the CAIPE multi-agent system using OAuth 2.0 Token Exchange (RFC 8693), OBO delegation, and Keycloak. This belongs in the architecture docs alongside the existing gateway and MAS architecture documents.

Additionally, the project uses git worktrees for isolated branch development, but CLAUDE.md and the `.cursorrules` files were referencing the old `prebuild/<short-description>` pattern and bare `git checkout -b` workflow. This creates confusion for contributors and AI assistants.

## Scope

### In Scope
- Copy `enterprise-identity-federation.md` to `docs/docs/architecture/`
- Update `CLAUDE.md` with git worktree workflow and `prebuild/<type>/<description>` naming
- Update `.cursorrules` Development Workflow section with worktree commands and correct branch names
- Update `.specify/.cursorrules` with worktree workflow under Development Standards

### Out of Scope
- Changes to the content of the identity federation document
- Docusaurus sidebar configuration (can be auto-discovered)
- Implementing the identity federation architecture itself

## Design

### Architecture

No code changes. Documentation and developer-tooling updates only.

### Components Affected
- [x] Documentation (`docs/`)
- [x] `.cursorrules` (root)
- [x] `.specify/.cursorrules`
- [x] `CLAUDE.md`

## Acceptance Criteria

- [x] `docs/docs/architecture/enterprise-identity-federation.md` exists and matches source
- [x] `CLAUDE.md` documents `prebuild/<type>/<description>` naming and `git worktree` usage
- [x] `.cursorrules` Development Workflow uses `prebuild/<type>/...` branch names and worktree commands
- [x] `.specify/.cursorrules` has a Git Worktree Workflow section under Development Standards
- [ ] PR created and passes CI

## Implementation Plan

### Phase 1: Documentation
- [x] Copy enterprise-identity-federation.md to docs/docs/architecture/

### Phase 2: Rules Updates
- [x] Update CLAUDE.md git workflow section
- [x] Update .cursorrules branch naming and workflow
- [x] Update .specify/.cursorrules development standards

## Testing Strategy

- Manual verification: confirm `docs/docs/architecture/enterprise-identity-federation.md` is present
- Manual verification: review all three rules files for consistent branch naming

## Rollout Plan

Merge to main via PR. No deployment steps needed — docs are built by Docusaurus CI.

## Related

- ADR: N/A (documentation and tooling change, not an architectural decision)
- Issues: N/A
- PRs: this branch `prebuild/docs/enterprise-identity-federation`
