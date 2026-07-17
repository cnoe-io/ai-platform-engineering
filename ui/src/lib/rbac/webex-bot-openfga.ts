import type { OpenFgaTupleKey } from "./openfga";
import { webexSpaceSubjectId, webexWorkspaceRef } from "./webex-space-grant-store";

export function webexBotInstallationId(
  botId: string,
  workspaceId: string,
  spaceId: string,
): string {
  return `${botId}--${webexWorkspaceRef(workspaceId)}--${spaceId}`;
}

export function webexBotInstallationUser(
  botId: string,
  workspaceId: string,
  spaceId: string,
): string {
  return `webex_bot_installation:${webexBotInstallationId(botId, workspaceId, spaceId)}`;
}

export function webexBotInstallationAgentTuple(
  botId: string,
  workspaceId: string,
  spaceId: string,
  agentId: string,
): OpenFgaTupleKey {
  return {
    user: webexBotInstallationUser(botId, workspaceId, spaceId),
    relation: "user",
    object: `agent:${agentId}`,
  };
}

export function webexBotInstallationIdentityTuples(
  botId: string,
  workspaceId: string,
  spaceId: string,
): OpenFgaTupleKey[] {
  const object = webexBotInstallationUser(botId, workspaceId, spaceId);
  return [
    { user: `webex_bot:${botId}`, relation: "bot", object },
    {
      user: `webex_space:${webexSpaceSubjectId(workspaceId, spaceId)}`,
      relation: "space",
      object,
    },
  ];
}
