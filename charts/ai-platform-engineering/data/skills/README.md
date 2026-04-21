# Bootstrap skill template

`bootstrap.md` is the default markdown body of the `/skills` slash command
that the **Skills API Gateway** UI page renders for users to copy into their
coding agent (Claude Code, Cursor, Spec Kit, etc.).

The chart packages it into the `skills-bootstrap` ConfigMap, which is mounted
into the `caipe-ui` pod at `/app/data/skills-bootstrap/bootstrap.md` and read
by the `/api/skills/bootstrap` endpoint.

## Placeholders (substituted by the UI)

| Placeholder         | Replaced with                                       |
| ------------------- | --------------------------------------------------- |
| `{{COMMAND_NAME}}`  | Slash command name from the UI form (default `skills`) |
| `{{DESCRIPTION}}`   | Description from the UI form                        |
| `{{BASE_URL}}`      | Gateway base URL (auto-detected from the browser)   |

## Override resolution order

The UI server picks the first source that resolves:

1. `SKILLS_BOOTSTRAP_TEMPLATE` env (raw markdown, highest priority)
2. File at `SKILLS_BOOTSTRAP_FILE` env (defaults to the mounted ConfigMap)
3. Packaged default at `data/skills/bootstrap.md`
4. A minimal built-in fallback string

## Customizing via Helm

```yaml
# Inline override (highest priority Helm path)
skillsBootstrap: |
  ---
  description: My company's skill catalog
  ---
  ## Steps
  1. Fetch from {{BASE_URL}}/api/skills with X-Caipe-Catalog-Key header.

# Or pre-shipped variant (looks up data/skills/bootstrap.<name>.md)
skillsBootstrapName: enterprise
```

To ship a pre-baked variant with the chart, drop a file alongside
`bootstrap.md`, e.g. `bootstrap.enterprise.md`, then set
`skillsBootstrapName: enterprise`.

See [`docs/docs/ui/skills-bootstrap.md`](../../../docs/docs/ui/skills-bootstrap.md)
for the full guide including BYO ConfigMap and env-only overrides.
