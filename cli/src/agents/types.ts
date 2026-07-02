/**
 * Shared Agent entity type — matches data-model.md Agent entity.
 */

export interface Agent {
  name: string;
  displayName: string;
  description: string;
  endpoint: string;
  protocols: ("agui")[];
  available: boolean;
  domain: string;
}

export const DEFAULT_AGENT: Agent = {
  name: "default",
  displayName: "Default Agent",
  description: "General-purpose CAIPE server agent",
  endpoint: "",
  protocols: ["agui"],
  available: true,
  domain: "general",
};
