# Keycloak OAuth Server Setup

This directory starts a local Keycloak server for CAIPE development. The
canonical realm export and init scripts live under the Helm chart; this
directory keeps Docker Compose-friendly symlinks to those files.

## Init Scripts

`init-idp.sh` and `init-token-exchange.sh` are symlinks into:

```text
charts/ai-platform-engineering/charts/keycloak/scripts/
```

- Edit the canonical chart files only.
- Keep scripts busybox-`sh`/`sed` portable.
- Docker Compose resolves the host symlink before mounting.
- Helm reads the chart-local files through `.Files.Get`.

## Realm Import

Docker Compose mounts:

```text
charts/ai-platform-engineering/charts/keycloak/realm-config.json
```

Do not create `deploy/keycloak/realm-config.json`; a missing bind-mount target
can become a directory, which causes Keycloak to start with only the `master`
realm.

## Quick Start

```bash
cd deploy/keycloak
docker compose up
```

Admin console:

- URL: http://localhost:7080
- Username: `admin`
- Password: `admin`

Switch to the `caipe` realm after login.

## Local Client

Create a local confidential client when you need CLI or service-token testing:

1. Open **Clients** -> **Create** in the `caipe` realm.
2. Set **Client ID** to `caipe-cli`.
3. Enable the standard flow, direct access grants, and service accounts.
4. Save and copy the client secret from the **Credentials** tab.

Useful local values:

```bash
JWKS_URI=http://localhost:7080/realms/caipe/protocol/openid-connect/certs
AUDIENCE=caipe-platform
ISSUER=http://localhost:7080/realms/caipe
OAUTH2_CLIENT_ID=caipe-cli
OAUTH2_CLIENT_SECRET=<client-secret>
TOKEN_ENDPOINT=http://localhost:7080/realms/caipe/protocol/openid-connect/token
```
