/**
 * Shared Agent entity type — matches data-model.md Agent entity.
 */

export interface Agent {
  name: string;
  displayName: string;
  description: string;
  endpoint: string;
  protocols: "agui"[];
  available: boolean;
  domain: string;
}

export const DEFAULT_AGENT: Agent = {
  name: "hello-world",
  displayName: "Hello World",
  description: "Default starter agent",
  endpoint: "",
  protocols: ["agui"],
  available: true,
  domain: "general",
};
