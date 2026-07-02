/**
 * @jest-environment node
 */
/**
 * Contract test for the explicit "data source author" capability
 * (spec 2026-06-03-explicit-ingest-capability).
 *
 * Locks the deployed OpenFGA authorization model so the org-level capability
 * cannot silently regress:
 *  - `organization#ingestor` exists and is grantable to TEAMS ONLY
 *    (`team#member`, `team#admin`) — never to `user` or `service_account`,
 *    which would let an individual self-grant authoring.
 *  - `organization#can_ingest` is the union `ingestor or admin`, so org admins
 *    author implicitly and opted-in teams author explicitly.
 *
 * Reads the chart JSON (the runtime source of truth mounted into openfga-init).
 */

import { readFileSync } from "fs";
import { join } from "path";

interface RelationDef {
  union?: { child: Array<{ computedUserset?: { relation: string } }> };
  this?: Record<string, never>;
  computedUserset?: { relation: string };
}
interface TypeDef {
  type: string;
  relations: Record<string, RelationDef>;
  metadata?: {
    relations?: Record<string, { directly_related_user_types?: Array<{ type: string; relation?: string }> }>;
  };
}

const MODEL_PATH = join(
  __dirname,
  "../../../../../../charts/ai-platform-engineering/charts/openfga/authorization-model.json",
);

function loadOrgType(): TypeDef {
  const model = JSON.parse(readFileSync(MODEL_PATH, "utf8")) as {
    type_definitions: TypeDef[];
  };
  const org = model.type_definitions.find((t) => t.type === "organization");
  if (!org) throw new Error("organization type not found in authorization model");
  return org;
}

describe("organization data-source author capability (contract)", () => {
  const org = loadOrgType();

  it("defines an `ingestor` relation grantable to teams only", () => {
    expect(org.relations.ingestor).toBeDefined();
    const allowed = org.metadata?.relations?.ingestor?.directly_related_user_types ?? [];
    // Teams (member + admin) only.
    expect(allowed).toEqual(
      expect.arrayContaining([
        { type: "team", relation: "member" },
        { type: "team", relation: "admin" },
      ]),
    );
    // CRITICAL: no individual self-grant.
    const types = allowed.map((a) => a.type);
    expect(types).not.toContain("user");
    expect(types).not.toContain("service_account");
    expect(types).not.toContain("external_group");
  });

  it("defines `can_ingest` as the union of `ingestor` and `admin`", () => {
    const canIngest = org.relations.can_ingest;
    expect(canIngest).toBeDefined();
    const children = (canIngest.union?.child ?? []).map((c) => c.computedUserset?.relation);
    expect(children).toEqual(expect.arrayContaining(["ingestor", "admin"]));
    expect(children).toHaveLength(2);
  });
});
