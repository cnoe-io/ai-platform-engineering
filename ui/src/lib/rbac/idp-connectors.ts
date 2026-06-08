// Registry + dispatch for IdP directory connectors that back the Identity Sync
// admin tab. Today only Okta is implemented; this is the single extension point
// where future connectors (Duo, Active Directory, …) get wired in. The routes,
// store, and UI are all provider-scoped, so adding a connector is: implement a
// fetch/health/configured trio and add an entry here.

import type { ExternalGroup } from "@/types/identity-group-sync";
import {
  checkOktaConnectorHealth,
  fetchOktaExternalGroups,
  isOktaConnectorConfigured,
  type OktaConnectorHealth,
} from "./okta-directory-connector";

export type IdpConnectorHealth =
  | { ok: true; mode: string }
  | { ok: false; mode: string; error: string };

export interface IdpConnectorDescriptor {
  id: string;
  label: string;
  implemented: boolean;
}

// Options a caller (the sync runner) can pass per fetch. `groupFilter` narrows
// which directory groups are pulled; `onProgress` reports member-scan progress
// for the live "Scanning members (x/y)" status.
export interface FetchGroupsOptions {
  providerId: string;
  groupFilter?: string;
  onProgress?: (scanned: number, total: number) => void;
}

interface IdpConnectorImpl extends IdpConnectorDescriptor {
  fetchExternalGroups: (options: FetchGroupsOptions) => Promise<ExternalGroup[]>;
  checkHealth: () => Promise<IdpConnectorHealth>;
  isConfigured: () => boolean;
}

const OKTA_CONNECTOR: IdpConnectorImpl = {
  id: "okta",
  label: "Okta",
  implemented: true,
  fetchExternalGroups: (options) => fetchOktaExternalGroups(options),
  checkHealth: async () => (await checkOktaConnectorHealth()) as OktaConnectorHealth,
  isConfigured: () => isOktaConnectorConfigured(),
};

// To add a connector (Duo, Active Directory, …): implement the
// fetch/health/configured trio and register it here. Nothing else in the
// routes, store, or UI is connector-specific.
const IMPLEMENTED: Record<string, IdpConnectorImpl> = {
  [OKTA_CONNECTOR.id]: OKTA_CONNECTOR,
};

export const DEFAULT_CONNECTOR_ID = OKTA_CONNECTOR.id;

/** All registered (implemented) connectors for the UI selector. */
export function listIdpConnectors(): IdpConnectorDescriptor[] {
  return Object.values(IMPLEMENTED).map(({ id, label, implemented }) => ({ id, label, implemented }));
}

/** True when `providerId` is a known, implemented connector. */
export function isImplementedConnector(providerId: string): boolean {
  return providerId in IMPLEMENTED;
}

function requireConnector(providerId: string): IdpConnectorImpl {
  const connector = IMPLEMENTED[providerId];
  if (!connector) {
    throw new Error(`No directory connector is implemented for provider "${providerId}"`);
  }
  return connector;
}

export async function fetchExternalGroupsForProvider(
  providerId: string,
  options?: Omit<FetchGroupsOptions, "providerId">
): Promise<ExternalGroup[]> {
  return requireConnector(providerId).fetchExternalGroups({ providerId, ...options });
}

export async function checkConnectorHealthForProvider(
  providerId: string
): Promise<IdpConnectorHealth> {
  return requireConnector(providerId).checkHealth();
}

export function isConnectorConfigured(providerId: string): boolean {
  const connector = IMPLEMENTED[providerId];
  return connector ? connector.isConfigured() : false;
}
