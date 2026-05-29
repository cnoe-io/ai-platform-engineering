/**
 * Tests for `buildKnowledgeBaseRelationshipTupleDiff` shared-team handling.
 *
 * Mirrors the agent editor's shared-team semantics: adding a team writes
 * the reader+ingestor+manager set, removing a team emits matching deletes,
 * the owner team is always treated as "wanted" so duplicating it in the
 * shared list is a no-op, and invalid slugs are silently dropped.
 */

import { buildKnowledgeBaseRelationshipTupleDiff } from "@/lib/rbac/openfga-owned-resources";

describe("buildKnowledgeBaseRelationshipTupleDiff — shared teams", () => {
  const KB = "knowledge_base:kb-1";

  it("backwards-compatible: only owner is granted when no shared teams supplied", () => {
    const diff = buildKnowledgeBaseRelationshipTupleDiff({
      knowledgeBaseId: "kb-1",
      ownerSubject: "alice-sub",
      ownerTeamSlug: "platform",
    });
    expect(diff.writes).toEqual([
      { user: "user:alice-sub", relation: "owner", object: KB },
      { user: "team:platform#member", relation: "reader", object: KB },
      { user: "team:platform#member", relation: "ingestor", object: KB },
      { user: "team:platform#admin", relation: "manager", object: KB },
    ]);
    expect(diff.deletes).toEqual([]);
  });

  it("adds reader/ingestor/manager tuples for each shared team", () => {
    const diff = buildKnowledgeBaseRelationshipTupleDiff({
      knowledgeBaseId: "kb-1",
      ownerTeamSlug: "platform",
      nextSharedTeamSlugs: ["data-eng", "ml-ops"],
    });
    expect(diff.writes).toEqual(
      expect.arrayContaining([
        { user: "team:platform#member", relation: "reader", object: KB },
        { user: "team:platform#member", relation: "ingestor", object: KB },
        { user: "team:platform#admin", relation: "manager", object: KB },
        { user: "team:data-eng#member", relation: "reader", object: KB },
        { user: "team:data-eng#member", relation: "ingestor", object: KB },
        { user: "team:data-eng#admin", relation: "manager", object: KB },
        { user: "team:ml-ops#member", relation: "reader", object: KB },
        { user: "team:ml-ops#member", relation: "ingestor", object: KB },
        { user: "team:ml-ops#admin", relation: "manager", object: KB },
      ]),
    );
    expect(diff.deletes).toEqual([]);
  });

  it("deletes the reader/ingestor/manager set when a team is removed from the shared list", () => {
    const diff = buildKnowledgeBaseRelationshipTupleDiff({
      knowledgeBaseId: "kb-1",
      ownerTeamSlug: "platform",
      previousSharedTeamSlugs: ["data-eng", "ml-ops"],
      nextSharedTeamSlugs: ["data-eng"],
    });
    expect(diff.writes).toEqual(
      expect.arrayContaining([
        { user: "team:data-eng#member", relation: "reader", object: KB },
        { user: "team:data-eng#member", relation: "ingestor", object: KB },
        { user: "team:data-eng#admin", relation: "manager", object: KB },
      ]),
    );
    expect(diff.deletes).toEqual(
      expect.arrayContaining([
        { user: "team:ml-ops#member", relation: "reader", object: KB },
        { user: "team:ml-ops#member", relation: "ingestor", object: KB },
        { user: "team:ml-ops#admin", relation: "manager", object: KB },
      ]),
    );
    // ml-ops grant is now revoked — no stale tuple is left dangling.
    expect(diff.deletes).toHaveLength(3);
  });

  it("dedupes when the owner team is also listed in the shared array", () => {
    const diff = buildKnowledgeBaseRelationshipTupleDiff({
      knowledgeBaseId: "kb-1",
      ownerTeamSlug: "platform",
      nextSharedTeamSlugs: ["platform", "data-eng"],
    });
    const ownerWrites = diff.writes.filter(
      (tuple) =>
        tuple.object === KB &&
        (tuple.user === "team:platform#member" || tuple.user === "team:platform#admin"),
    );
    expect(ownerWrites).toHaveLength(3);
    expect(diff.deletes).toEqual([]);
  });

  it("treats removed owner team as a delete when previousOwnerTeamSlug supplied", () => {
    const diff = buildKnowledgeBaseRelationshipTupleDiff({
      knowledgeBaseId: "kb-1",
      ownerTeamSlug: "data-eng",
      previousOwnerTeamSlug: "platform",
    });
    expect(diff.writes).toEqual(
      expect.arrayContaining([
        { user: "team:data-eng#member", relation: "reader", object: KB },
        { user: "team:data-eng#member", relation: "ingestor", object: KB },
        { user: "team:data-eng#admin", relation: "manager", object: KB },
      ]),
    );
    expect(diff.deletes).toEqual(
      expect.arrayContaining([
        { user: "team:platform#member", relation: "reader", object: KB },
        { user: "team:platform#member", relation: "ingestor", object: KB },
        { user: "team:platform#admin", relation: "manager", object: KB },
      ]),
    );
  });

  it("silently drops invalid slugs in next/previous shared lists", () => {
    const diff = buildKnowledgeBaseRelationshipTupleDiff({
      knowledgeBaseId: "kb-1",
      ownerTeamSlug: "platform",
      nextSharedTeamSlugs: ["good-team", "", "x".repeat(300), "   "],
      previousSharedTeamSlugs: ["bad team"],
    });
    expect(diff.writes).toEqual(
      expect.arrayContaining([
        { user: "team:good-team#member", relation: "reader", object: KB },
        { user: "team:good-team#member", relation: "ingestor", object: KB },
      ]),
    );
    expect(diff.deletes).toEqual([]);
  });

  it("idempotent across repeated reconcile calls with the same input", () => {
    const input = {
      knowledgeBaseId: "kb-1",
      ownerTeamSlug: "platform",
      nextSharedTeamSlugs: ["data-eng"],
      previousSharedTeamSlugs: ["data-eng"],
    };
    const a = buildKnowledgeBaseRelationshipTupleDiff(input);
    const b = buildKnowledgeBaseRelationshipTupleDiff(input);
    expect(a).toEqual(b);
    expect(a.deletes).toEqual([]);
  });
});
