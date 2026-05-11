# Quickstart: External Agentic Apps Platform

This quickstart describes the target developer/operator flow for the feature. Commands assume the repository root is `agentic-sdlc-ui`.

## 1. Enable the host platform

Set the host feature flag and MongoDB connection in `ui/.env.local` or deployment values:

```bash
AGENTIC_APPS_INSTALL_ENABLED=true
MONGODB_URI=mongodb://localhost:27017
MONGODB_DATABASE=caipe
```

Private app runtime origins and provider credentials stay in environment/deployment configuration, not in public manifests.

## 2. Start a reference app runtime

Run one reference runtime in a separate terminal. Weather uses Open-Meteo public APIs at runtime and needs no API key:

```bash
cd ui
npm run agentic-apps:weather
```

For FinOps, configure `FINOPS_AGENT_ID` if your CAIPE AWS Cost Explorer agent is not registered as `aws-agent`:

```bash
cd ui
npm run agentic-apps:finops
```

For Agentic SDLC:

```bash
cd ui
npm run agentic-apps:sdlc
```

## 3. Configure an app origin

For a local Weather app runtime:

```bash
AGENTIC_APP_WEATHER_ORIGIN=http://localhost:3020
AGENTIC_APP_WEATHER_MOUNT_PATH=/apps/weather
AGENTIC_APPS_ENABLED=weather
```

Equivalent local origins:

```bash
AGENTIC_APP_FINOPS_ORIGIN=http://localhost:3010
AGENTIC_APP_AGENTIC_SDLC_ORIGIN=http://localhost:3030
AGENTIC_APPS_ENABLED=weather,finops,agentic-sdlc
```

The manifest remains public and secret-free. Runtime-specific origins can be supplied through host config or admin installation overrides. To remove a reference app, disable/uninstall its installation record or omit it from `AGENTIC_APPS_ENABLED`.

## 4. Run the CAIPE UI

```bash
cd ui
npm install
npm run dev
```

Open the CAIPE UI, sign in, and visit `/apps`. An enabled and installed app appears in the Apps Hub only when manifest, installation, health, and policy checks allow it.

## 5. Install a package through admin APIs or UI

Use the admin agentic apps package/import endpoint to load a trusted manifest:

```bash
curl -X POST http://localhost:3000/api/admin/agentic-apps/packages \
  -H "content-type: application/json" \
  --data '{"manifest":{...},"source":"admin-import"}'
```

The package import must:

- Validate the manifest schema.
- Reject secret-like fields.
- Check route and app ID conflicts before persisting a new package.
- Persist package metadata separately from installation state.
- Emit an audit event.

Then install the package for the environment:

```bash
curl -X POST http://localhost:3000/api/admin/agentic-apps/installations \
  -H "content-type: application/json" \
  --data '{
    "appId":"weather",
    "packageId":"weather",
    "installed":true,
    "enabled":true,
    "visible":true,
    "runtimeMountPath":"/apps/weather",
    "runtimeOriginOverride":"http://localhost:3102",
    "accessOverrides":{"requiredRoles":["user"]},
    "healthPolicy":{"blockLaunchWhen":["degraded","unreachable"]}
  }'
```

Installation state controls `installed`, `enabled`, visibility, access overrides, health policy, runtime overrides, and route ownership. CAIPE rejects installs that would claim a route already owned by another installed app.

## 6. Launch and verify request forwarding

Launch `/apps/<appId>`.

Expected behavior:

- CAIPE authenticates the user.
- CAIPE denies by default if the app is not installed, disabled, unhealthy by policy, unsupported, or unauthorized.
- CAIPE strips browser cookies, client-supplied `Authorization`, and client-supplied CAIPE identity headers.
- CAIPE calls the PDP boundary.
- CAIPE forwards only allowed requests with an app-scoped token, `decision_id`, and `correlation_id`.
- The app verifies the app-scoped token using the documented issuer/JWKS contract.

## 7. Test a generic webhook

Configure a provider webhook URL in this shape:

```text
/api/agentic-apps/webhooks/<appId>/<provider>/<channel>
```

Expected behavior:

- CAIPE resolves the installed app and declared channel.
- CAIPE enforces method, body size, rate, health, and PDP checks.
- CAIPE preserves raw request bytes and allowlisted provider signature headers when the app owns verification.
- CAIPE forwards to the app runtime's declared `upstreamPath`.
- CAIPE records accepted, denied, dropped, forwarded, and failed outcomes with safe metadata.

## 8. Import any external app manifest

External apps own their manifest JSON in their own repository. CAIPE imports the manifest through a generic seed/import interface and stores only package and installation records.

For a local external app that wants the CAIPE header ribbon, set `runtime.chrome` to `iframe` in the external manifest or pass `--chrome iframe` during import:

```bash
cd ui
npm run agentic-apps:seed -- \
  --manifest /path/to/external-app/agentic-app.manifest.json \
  --origin http://localhost:3001 \
  --mount-path /apps/example \
  --chrome iframe \
  --preserve-mount-path
```

Then open CAIPE at `/apps` and launch the app. The URL should be `/apps/embed/<appId>` with the CAIPE header visible, while the iframe loads app content through `/apps/<appId>`.

To remove a seeded external app:

```bash
cd ui
npm run agentic-apps:seed -- --app-id example --delete
```

## 9. Use the assistant context bridge

Embedded apps use the SDK helper to publish page context to the CAIPE-owned shell. CAIPE validates frame origin, app ID, schema version, payload size, and secret-like content before storing active context for the assistant overlay.

Expected behavior:

- The app does not import CAIPE chat components or stores.
- The CAIPE assistant overlay remains outside the app frame.
- Users can open, close, and clear active app context.
- Invalid or oversized context is ignored and logged without breaking the embedded app.

## 10. Run targeted checks

```bash
cd ui
npm test -- agentic-apps
```

Before merging an implementation slice:

```bash
make caipe-ui-tests
```

If Python backend code changes in a later slice, also run:

```bash
make lint
make test
```
