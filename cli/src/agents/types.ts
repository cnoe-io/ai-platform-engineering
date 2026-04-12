/**
 * Shared Agent entity type — matches data-model.md Agent entity.
 */

export interface Agent {
  name: string;
  displayName: string;
  description: string;
  endpoint: string;
  protocols: ("a2a" | "agui")[];
  available: boolean;
  domain: string;
}

export const DEFAULT_AGENT: Agent = {
  name: "default",
  displayName: "Default Agent",
  description: "General-purpose CAIPE server agent",
  endpoint: "",
  protocols: ["a2a"],
  available: true,
  domain: "general",
};
