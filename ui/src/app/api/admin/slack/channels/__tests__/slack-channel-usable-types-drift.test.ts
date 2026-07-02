/**
 * @jest-environment node
 */
/**
 * Drift guard for CHANNEL_USABLE_OBJECT_TYPES.
 *
 * The channel-delete handler (`[workspaceId]/[channelId]/route.ts`) sweeps every
 * OpenFGA tuple where a slack_channel is the `user` (channel→resource grants) so
 * deleting a channel fully cleans up its grants. OpenFGA's /read requires an
 * object TYPE in the filter, so that sweep fans out one read per type in
 * CHANNEL_USABLE_OBJECT_TYPES. If a new resource type starts granting
 * slack_channel subjects in the model but isn't added to that list, channel
 * delete would silently orphan those tuples.
 *
 * This test derives the authoritative set from the deployed chart model
 * (authorization-model.json — the one the running stack imports) by collecting
 * every type whose metadata lists `slack_channel` as a directly-related user
 * type, and asserts it matches CHANNEL_USABLE_OBJECT_TYPES exactly.
 */

import { readFileSync } from "fs";
import { join } from "path";

import { CHANNEL_USABLE_OBJECT_TYPES } from "../[workspaceId]/[channelId]/route";

// __dirname = ui/src/app/api/admin/slack/channels/__tests__ → 8 levels to repo root.
const REPO_ROOT = join(__dirname, "..", "..", "..", "..", "..", "..", "..", "..");
const CHART_JSON = join(
  REPO_ROOT,
  "charts",
  "ai-platform-engineering",
  "charts",
  "openfga",
  "authorization-model.json",
);

interface ModelRelationMeta {
  directly_related_user_types?: Array<{ type?: string; relation?: string; wildcard?: unknown }>;
}
interface ModelTypeDef {
  type: string;
  metadata?: { relations?: Record<string, ModelRelationMeta> };
}

function typesGrantingSlackChannel(): string[] {
  const model = JSON.parse(readFileSync(CHART_JSON, "utf8")) as {
    type_definitions?: ModelTypeDef[];
    authorization_model?: { type_definitions?: ModelTypeDef[] };
  };
  const defs = model.type_definitions ?? model.authorization_model?.type_definitions ?? [];
  const types = new Set<string>();
  for (const def of defs) {
    const relations = def.metadata?.relations ?? {};
    for (const meta of Object.values(relations)) {
      for (const dut of meta.directly_related_user_types ?? []) {
        if (dut.type === "slack_channel") {
          types.add(def.type);
        }
      }
    }
  }
  return Array.from(types);
}

describe("CHANNEL_USABLE_OBJECT_TYPES drift", () => {
  it("matches every model type that grants slack_channel as a subject", () => {
    const fromModel = typesGrantingSlackChannel().sort();
    const fromCode = [...CHANNEL_USABLE_OBJECT_TYPES].sort();
    expect(fromCode).toEqual(fromModel);
  });

  it("is non-empty (sanity: the model still grants slack_channel somewhere)", () => {
    expect(typesGrantingSlackChannel().length).toBeGreaterThan(0);
  });
});
