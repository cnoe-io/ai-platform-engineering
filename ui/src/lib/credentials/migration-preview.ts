interface LegacyMcpServer {
  _id: string;
  name: string;
  env?: Record<string, string>;
}

export interface CredentialMigrationCandidate {
  sourceId: string;
  sourceName: string;
  sourceKind: "mcp_server_env";
  envName: string;
  envRef: string;
  proposedSecretName: string;
}

const SECRET_ENV_NAME_RE = /(TOKEN|SECRET|PASSWORD|API_KEY|ACCESS_KEY|PRIVATE_KEY)$/i;
const ENV_REF_RE = /^[A-Z_][A-Z0-9_]{2,127}$/;

export function buildCredentialMigrationPreview(
  servers: LegacyMcpServer[],
): CredentialMigrationCandidate[] {
  const candidates: CredentialMigrationCandidate[] = [];

  for (const server of servers) {
    for (const [envName, envRef] of Object.entries(server.env ?? {})) {
      if (!SECRET_ENV_NAME_RE.test(envName) || !ENV_REF_RE.test(envRef)) {
        continue;
      }
      candidates.push({
        sourceId: server._id,
        sourceName: server.name,
        sourceKind: "mcp_server_env",
        envName,
        envRef,
        proposedSecretName: `${server.name} ${envName}`,
      });
    }
  }

  return candidates;
}
