import { CREDENTIAL_COLLECTIONS } from "@/lib/credentials/collections";
import { getCollection } from "@/lib/mongodb";

import type { AuthorizeRequest, AuthorizeResult } from "../contract";
import {
  evaluatePrivateResourceContext,
  PRIVATE_DATA_ACTIONS,
  type ResourceVisibility,
} from "./private-resource-policy";

export { evaluatePrivateResourceContext } from "./private-resource-policy";

interface VisibilityDocument {
  _id?: string;
  id?: string;
  visibility?: string;
  owner?: { type?: string };
  sharedWithTeams?: string[];
}

async function loadVisibility(req: AuthorizeRequest): Promise<ResourceVisibility> {
  let document: VisibilityDocument | null = null;
  if (req.resource.type === "agent") {
    const collection = await getCollection<VisibilityDocument>("dynamic_agents");
    document = await collection.findOne({ _id: req.resource.id });
  } else if (req.resource.type === "mcp_server") {
    const collection = await getCollection<VisibilityDocument>("mcp_servers");
    document = await collection.findOne({ _id: req.resource.id });
  } else if (req.resource.type === "secret_ref") {
    const collection = await getCollection<VisibilityDocument>(CREDENTIAL_COLLECTIONS.secretRefs);
    document = await collection.findOne({ id: req.resource.id });
  } else {
    return null;
  }

  if (!document) return null;
  if (document.visibility === "private" || document.visibility === "team" || document.visibility === "global") {
    return document.visibility;
  }
  if (req.resource.type === "secret_ref") {
    return document.owner?.type === "user" && (document.sharedWithTeams?.length ?? 0) === 0
      ? "private"
      : "team";
  }
  return null;
}

export async function privateResourcePreCheck(req: AuthorizeRequest): Promise<AuthorizeResult | null> {
  if (!PRIVATE_DATA_ACTIONS.has(req.action)) return null;
  return evaluatePrivateResourceContext(req, await loadVisibility(req));
}
