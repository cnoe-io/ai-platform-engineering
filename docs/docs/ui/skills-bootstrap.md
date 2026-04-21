---
sidebar_position: 9
title: Skills Bootstrap (`/skills` slash command)
---

# Skills Bootstrap (`/skills` slash command)

The **Skills API Gateway** page (UI → *Skills* → *Skills API Gateway*) renders
a copy-pasteable slash command that lets a coding agent (Claude Code, Cursor,
Spec Kit, etc.) browse, search, run, install, and update skills served by the
CAIPE skill catalog.

The body of that slash command is rendered from a single Markdown template
called the **bootstrap skill**. This page describes how operators can
customize it for their deployment without forking the chart or rebuilding the
image.

## Where the template lives

| Layer            | Location                                                         |
| ---------------- | ---------------------------------------------------------------- |
| Packaged default | [`charts/ai-platform-engineering/data/skills/bootstrap.md`](https://github.com/cnoe-io/ai-platform-engineering/tree/main/charts/ai-platform-engineering/data/skills/bootstrap.md) |
| Helm ConfigMap   | `skills-bootstrap` (key `bootstrap.md`)                          |
| Mounted in pod   | `/app/data/skills-bootstrap/bootstrap.md` on the `caipe-ui` pod  |
| Served at        | `GET /api/skills/bootstrap` (returns `{ template, source, … }`)  |
| Rendered in      | `Skills API Gateway` UI → "Create the bootstrap skill" card      |

The UI substitutes three placeholders client-side based on the form fields
on the page:

| Placeholder         | Replaced with                                            |
| ------------------- | -------------------------------------------------------- |
| `{{COMMAND_NAME}}`  | Slash command name (default `skills`)                    |
| `{{DESCRIPTION}}`   | Description shown in the slash-command picker            |
| `{{BASE_URL}}`      | Gateway base URL (auto-detected from `window.location`)  |

## Override resolution order

The UI server (`/api/skills/bootstrap`) picks the **first** source that
resolves:

1. `SKILLS_BOOTSTRAP_TEMPLATE` env var (raw markdown) &mdash; highest priority
2. File at `SKILLS_BOOTSTRAP_FILE` env var
   (default: `/app/data/skills-bootstrap/bootstrap.md`, mounted by the chart)
3. Packaged default at `data/skills/bootstrap.md` (chart-relative, dev only)
4. A minimal built-in fallback string

The currently active source is shown in the UI under
*"Template source: …"* so operators can verify which override is in effect.

## Override option 1 &mdash; inline Helm value (simplest)

Drop a multi-line string into your Helm values:

~~~yaml
skillsBootstrap: |
  ---
  description: My company's skill catalog
  ---

  ## User Input

  ```text
  $ARGUMENTS
  ```

  ## SECURITY — never expose the API key
  - NEVER print, echo, or display the API key in any output.

  ## Steps

  1. Fetch from {{BASE_URL}}/api/skills with the X-Caipe-Catalog-Key header.
  2. Render results as a table.
  3. Use `/{{COMMAND_NAME}} <query>` to search, `/{{COMMAND_NAME}} run <name>`
     to execute inline, or `/{{COMMAND_NAME}} install <name>` to save locally.
~~~

The chart writes that string verbatim into the `skills-bootstrap`
ConfigMap. No image rebuild required.

## Override option 2 &mdash; named variant shipped with the chart

If you want to ship a small set of opinionated variants with your fork of
the chart (e.g. one per business unit):

1. Drop additional files alongside `bootstrap.md`, named
   `bootstrap.<variant>.md` &mdash; for example `bootstrap.enterprise.md`.
2. Select the variant via Helm:

   ```yaml
   skillsBootstrapName: enterprise
   ```

The template resolves
`data/skills/bootstrap.<variant>.md` and falls back to `bootstrap.md` if
that file isn't found.

## Override option 3 &mdash; bring-your-own ConfigMap or env

For deployments that consume the published chart unchanged:

### Mount your own ConfigMap

```yaml
caipe-ui:
  volumes:
    - name: my-bootstrap
      configMap:
        name: my-custom-skills-bootstrap
  volumeMounts:
    - name: my-bootstrap
      mountPath: /app/data/skills-bootstrap
      readOnly: true
```

The default `SKILLS_BOOTSTRAP_FILE` (already set by the chart) keeps pointing
at `/app/data/skills-bootstrap/bootstrap.md`, so the new ConfigMap content
takes effect immediately.

### Or stuff the markdown into an env var

```yaml
caipe-ui:
  env:
    SKILLS_BOOTSTRAP_TEMPLATE: |
      ---
      description: Inline override via env
      ---
      ## Steps
      1. Fetch from {{BASE_URL}}/api/skills.
```

This wins over any file-based source and is handy for quick experiments.

### Or point at a different file

```yaml
caipe-ui:
  env:
    SKILLS_BOOTSTRAP_FILE: "/etc/caipe/my-bootstrap.md"
```

Useful when mounting a Secret or a sidecar-managed file at a non-default
path.

## What the user sees

Once the template is in place, the **Skills API Gateway** page lets the user:

- Pick a **slash command name** (`skills` by default → becomes
  `.claude/commands/skills.md`).
- Pick a **description** (rendered into the markdown frontmatter).
- Pick **install targets**: `.claude/commands/`, `.cursor/commands/`,
  `.specify/templates/commands/`.
- Copy the generated install command (`mkdir -p … && cat > … << 'SKILL' …`).
- Preview the rendered markdown before installing.

Placeholder substitution is client-side, so a single template serves any
slash-command name without re-rendering the ConfigMap.

## See also

- Chart-side reference: [`charts/ai-platform-engineering/data/skills/README.md`](https://github.com/cnoe-io/ai-platform-engineering/tree/main/charts/ai-platform-engineering/data/skills/README.md)
- Default template: [`bootstrap.md`](https://github.com/cnoe-io/ai-platform-engineering/tree/main/charts/ai-platform-engineering/data/skills/bootstrap.md)
- ConfigMap template: [`templates/skills-bootstrap-config.yaml`](https://github.com/cnoe-io/ai-platform-engineering/tree/main/charts/ai-platform-engineering/templates/skills-bootstrap-config.yaml)
