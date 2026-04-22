/**
 * @jest-environment node
 *
 * Unit tests for the bootstrap-skill agent registry and renderer.
 *
 * These tests pin the user-visible contract:
 *   - Each shipped agent has a coherent spec (id, install path, format, argRef).
 *   - The frontmatter parser correctly splits canonical templates.
 *   - Placeholders are substituted in every supported context (body, install
 *     paths, launch guides) and no `{{...}}` token leaks through to output.
 *   - Per-agent rendering produces syntactically valid Markdown / TOML / JSON
 *     and round-trips the description from the canonical template.
 *   - YAML/TOML/JSON quoting helpers are injection-safe for hostile inputs.
 */

import {
  AGENTS,
  DEFAULT_AGENT_ID,
  parseFrontmatter,
  scopesAvailableFor,
  substitutePlaceholders,
  renderForAgent,
  type AgentScope,
  type AgentSpec,
  type RenderInputs,
} from '../agents';

const CANONICAL = `---
description: Browse and install skills from the CAIPE skill catalog
---

## User Input

\`\`\`text
{{ARG_REF}}
\`\`\`

## Steps

1. Search at {{BASE_URL}}/api/skills.
2. Slash command: /{{COMMAND_NAME}}.
`;

const baseInputs = (overrides: Partial<RenderInputs> = {}): RenderInputs => ({
  canonicalTemplate: CANONICAL,
  commandName: 'skills',
  description: '',
  baseUrl: 'https://gateway.example.com',
  ...overrides,
});

describe('AGENTS registry', () => {
  it('contains the six shipped agents', () => {
    expect(Object.keys(AGENTS).sort()).toEqual([
      'claude',
      'codex',
      'continue',
      'cursor',
      'gemini',
      'specify',
    ]);
  });

  it('uses claude as the default agent', () => {
    expect(DEFAULT_AGENT_ID).toBe('claude');
    expect(AGENTS[DEFAULT_AGENT_ID]).toBeDefined();
  });

  describe.each(Object.values(AGENTS))('spec for %s', (agent: AgentSpec) => {
    it('has stable, well-formed metadata', () => {
      // id must be URL-safe (used in ?agent= query) and lowercase
      expect(agent.id).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(agent.label.length).toBeGreaterThan(0);

      // ext should not have a leading dot
      expect(agent.ext).toMatch(/^[a-z]+$/);
      expect(agent.ext.startsWith('.')).toBe(false);

      // Every agent must declare at least one scope.
      const scopes = scopesAvailableFor(agent);
      expect(scopes.length).toBeGreaterThan(0);

      // Each declared install path must contain `{name}` for non-fragment
      // agents (fragment agents like Continue write to a fixed config file
      // — config.json — so they don't templatize the filename).
      for (const s of scopes) {
        const p = agent.installPaths[s]!;
        if (!agent.isFragment) {
          expect(p).toContain('{name}');
        }
        // No raw shell metacharacters allowed; we render these straight into
        // copy-paste install commands.
        expect(p).not.toMatch(/[;&|`$()<>]/);
      }

      // User-scope paths start with `~/`; project-scope paths start with `./`.
      if (agent.installPaths.user) {
        expect(agent.installPaths.user.startsWith('~/')).toBe(true);
      }
      if (agent.installPaths.project) {
        expect(agent.installPaths.project.startsWith('./')).toBe(true);
      }

      // launch guide must reference the slash command (`{name}`) at least
      // once so users learn the actual invocation syntax.
      expect(agent.launchGuide).toContain('{name}');

      // argRef must be one of the known patterns
      expect(['$ARGUMENTS', '$1', '{{input}}']).toContain(agent.argRef);
    });

    it('docs URL, when present, is https', () => {
      if (agent.docsUrl) {
        expect(agent.docsUrl.startsWith('https://')).toBe(true);
      }
    });
  });

  it('Claude/Cursor/Spec Kit use $ARGUMENTS; Codex/Gemini use $1; Continue uses {{input}}', () => {
    expect(AGENTS.claude.argRef).toBe('$ARGUMENTS');
    expect(AGENTS.cursor.argRef).toBe('$ARGUMENTS');
    expect(AGENTS.specify.argRef).toBe('$ARGUMENTS');
    expect(AGENTS.codex.argRef).toBe('$1');
    expect(AGENTS.gemini.argRef).toBe('$1');
    expect(AGENTS.continue.argRef).toBe('{{input}}');
  });

  it('only Continue is a fragment-style agent', () => {
    const fragments = Object.values(AGENTS).filter((a) => a.isFragment);
    expect(fragments.map((a) => a.id)).toEqual(['continue']);
  });

  describe('scope availability matrix', () => {
    it('Codex CLI exposes user-only (no project scope per openai/codex#9848)', () => {
      expect(scopesAvailableFor(AGENTS.codex)).toEqual(['user']);
      expect(AGENTS.codex.installPaths.project).toBeUndefined();
    });

    it('Spec Kit exposes project-only (no user scope per github/spec-kit#317)', () => {
      expect(scopesAvailableFor(AGENTS.specify)).toEqual(['project']);
      expect(AGENTS.specify.installPaths.user).toBeUndefined();
    });

    it('Claude / Cursor / Gemini / Continue support both scopes', () => {
      for (const id of ['claude', 'cursor', 'gemini', 'continue'] as const) {
        expect(scopesAvailableFor(AGENTS[id])).toEqual(['user', 'project']);
      }
    });
  });
});

describe('parseFrontmatter', () => {
  it('extracts a single-line description and strips the fence', () => {
    const out = parseFrontmatter(CANONICAL);
    expect(out.description).toBe(
      'Browse and install skills from the CAIPE skill catalog',
    );
    expect(out.body.startsWith('## User Input')).toBe(true);
    expect(out.body).not.toContain('---');
  });

  it('returns empty description and full body when no frontmatter', () => {
    const input = '## Heading\n\nbody\n';
    const out = parseFrontmatter(input);
    expect(out.description).toBe('');
    expect(out.body).toBe(input);
  });

  it('ignores non-description frontmatter keys', () => {
    const input = '---\ntitle: foo\nauthor: bar\n---\nbody\n';
    const out = parseFrontmatter(input);
    expect(out.description).toBe('');
    expect(out.body).toBe('body\n');
  });

  it('only consumes the first --- block, leaving inline --- alone', () => {
    const input = '---\ndescription: x\n---\nbefore\n---\nafter\n';
    const out = parseFrontmatter(input);
    expect(out.description).toBe('x');
    expect(out.body).toBe('before\n---\nafter\n');
  });

  it('handles CRLF or trailing whitespace on the description line', () => {
    const input = '---\ndescription:   spaced out   \n---\nbody\n';
    const out = parseFrontmatter(input);
    expect(out.description).toBe('spaced out');
  });
});

describe('substitutePlaceholders', () => {
  it('replaces all four placeholders globally', () => {
    const body =
      'cmd=/{{COMMAND_NAME}} desc={{DESCRIPTION}} url={{BASE_URL}} arg={{ARG_REF}}\n' +
      'again /{{COMMAND_NAME}} {{ARG_REF}}';
    const out = substitutePlaceholders(body, {
      commandName: 'skills',
      description: 'Catalog',
      baseUrl: 'https://x',
      argRef: '$1',
    });
    expect(out).toBe(
      'cmd=/skills desc=Catalog url=https://x arg=$1\nagain /skills $1',
    );
    expect(out).not.toContain('{{');
  });

  it('does not rewrite unknown {{...}} tokens', () => {
    const body = '{{UNKNOWN}} {{COMMAND_NAME}}';
    const out = substitutePlaceholders(body, {
      commandName: 'x',
      description: 'd',
      baseUrl: 'u',
      argRef: 'a',
    });
    expect(out).toBe('{{UNKNOWN}} x');
  });
});

describe('renderForAgent — Markdown frontmatter agents (Claude/Cursor/Spec Kit)', () => {
  it.each(['claude', 'cursor', 'specify'])(
    '%s: emits valid frontmatter and substitutes $ARGUMENTS',
    (id) => {
      // Pick a scope the agent supports (Spec Kit only has project).
      const scope: AgentScope = scopesAvailableFor(AGENTS[id])[0];
      const out = renderForAgent(AGENTS[id], baseInputs({ scope }));
      expect(out.format).toBe('markdown-frontmatter');
      expect(out.file_extension).toBe('md');
      expect(out.is_fragment).toBe(false);
      expect(out.scope).toBe(scope);
      expect(out.scope_fallback).toBe(false);

      // Starts with frontmatter
      expect(out.template.startsWith('---\ndescription: ')).toBe(true);
      expect(out.template).toMatch(/^---\ndescription: .+\n---\n\n/);

      // Argument reference is the agent's $ARGUMENTS
      expect(out.template).toContain('$ARGUMENTS');
      expect(out.template).not.toContain('$1');
      expect(out.template).not.toContain('{{ARG_REF}}');
      expect(out.template).not.toContain('{{COMMAND_NAME}}');
      expect(out.template).not.toContain('{{BASE_URL}}');
      expect(out.template).not.toContain('{{DESCRIPTION}}');

      // Install path is rendered with the command name
      expect(out.install_path).not.toBeNull();
      expect(out.install_path).toContain('skills.md');
      expect(out.install_path).not.toContain('{name}');
    },
  );

  it('substitutes a custom command name into both body and install path (project scope)', () => {
    const out = renderForAgent(
      AGENTS.claude,
      baseInputs({ commandName: 'my-skills', scope: 'project' }),
    );
    expect(out.install_path).toBe('./.claude/commands/my-skills.md');
    expect(out.install_paths.project).toBe('./.claude/commands/my-skills.md');
    expect(out.install_paths.user).toBe('~/.claude/commands/my-skills.md');
    expect(out.template).toContain('/my-skills');
    expect(out.launch_guide).toContain('/my-skills');
  });

  it('substitutes a custom command name into the user-scope install path', () => {
    const out = renderForAgent(
      AGENTS.claude,
      baseInputs({ commandName: 'my-skills', scope: 'user' }),
    );
    expect(out.install_path).toBe('~/.claude/commands/my-skills.md');
    expect(out.scope).toBe('user');
  });

  it('falls back to the canonical description when the input description is empty', () => {
    const out = renderForAgent(AGENTS.claude, baseInputs({ description: '' }));
    expect(out.template).toContain(
      'description: Browse and install skills from the CAIPE skill catalog',
    );
  });

  it('uses the explicit input description when provided', () => {
    const out = renderForAgent(
      AGENTS.claude,
      baseInputs({ description: 'Custom catalog' }),
    );
    expect(out.template).toContain('description: Custom catalog');
  });

  it('treats an unsubstituted {{DESCRIPTION}} placeholder as missing', () => {
    // Regression for PR #1268 review feedback (Jeff Napper #4): the canonical
    // template at charts/.../bootstrap.md ships
    // `description: {{DESCRIPTION}}` so a single template can be reused
    // across agents. Before the fix, parseFrontmatter picked up the literal
    // `{{DESCRIPTION}}` string and quoteYaml emitted
    // `description: "{{DESCRIPTION}}"` into the rendered file — which agents
    // then interpreted as a literal description containing curly braces.
    const placeholderTemplate =
      '---\n' +
      'description: {{DESCRIPTION}}\n' +
      '---\n' +
      '\n' +
      'Body using {{ARG_REF}}.\n';

    // No input description → fall back to the default (NOT the placeholder).
    const out = renderForAgent(
      AGENTS.claude,
      baseInputs({
        canonicalTemplate: placeholderTemplate,
        description: '',
      }),
    );
    expect(out.template).toContain(
      'description: Browse and install skills from the CAIPE skill catalog',
    );
    expect(out.template).not.toContain('{{DESCRIPTION}}');
    expect(out.template).not.toContain('description: "{{DESCRIPTION}}"');

    // Explicit input description wins over both the placeholder and the
    // default.
    const overridden = renderForAgent(
      AGENTS.claude,
      baseInputs({
        canonicalTemplate: placeholderTemplate,
        description: 'Custom catalog',
      }),
    );
    expect(overridden.template).toContain('description: Custom catalog');
    expect(overridden.template).not.toContain('{{DESCRIPTION}}');
  });
});

describe('renderForAgent — Codex (plain Markdown)', () => {
  it('emits a heading and no YAML frontmatter, with $1 as argRef', () => {
    const out = renderForAgent(AGENTS.codex, baseInputs({ scope: 'user' }));
    expect(out.format).toBe('markdown-plain');
    expect(out.template.startsWith('# skills\n\n')).toBe(true);
    expect(out.template).not.toMatch(/^---/);
    expect(out.template).toContain('$1');
    expect(out.template).not.toContain('$ARGUMENTS');
    expect(out.install_path).toBe('~/.codex/prompts/skills.md');
    expect(out.scopes_available).toEqual(['user']);
  });

  it('rejects scope=project (Codex has no project scope)', () => {
    const out = renderForAgent(AGENTS.codex, baseInputs({ scope: 'project' }));
    expect(out.install_path).toBeNull();
    expect(out.scope).toBeNull();
    expect(out.scope_fallback).toBe(true);
    // The body still renders so the UI can show a preview.
    expect(out.template).toContain('$1');
  });
});

describe('renderForAgent — Gemini (TOML)', () => {
  it('emits valid TOML with description and prompt keys (user scope)', () => {
    const out = renderForAgent(AGENTS.gemini, baseInputs({ scope: 'user' }));
    expect(out.format).toBe('gemini-toml');
    expect(out.file_extension).toBe('toml');
    expect(out.install_path).toBe('~/.gemini/commands/skills.toml');
    expect(out.install_paths.project).toBe('./.gemini/commands/skills.toml');

    expect(out.template).toMatch(/^description = "[^"]+"\nprompt = """\n/);
    expect(out.template).toMatch(/"""\n$/);

    // Body content survives inside the multi-line basic string
    expect(out.template).toContain('$1');
    expect(out.template).toContain('https://gateway.example.com/api/skills');
  });

  it('escapes embedded backslashes and triple quotes safely', () => {
    const description = 'has "quote" and \\backslash';
    const out = renderForAgent(
      AGENTS.gemini,
      baseInputs({ description }),
    );
    // Description line is a TOML basic string with " and \ escaped.
    expect(out.template).toContain(
      'description = "has \\"quote\\" and \\\\backslash"',
    );
  });

  it('escapes a literal """ inside the rendered prompt body', () => {
    const evilTemplate =
      '---\ndescription: x\n---\nbody with """ literal triple-quote\n';
    const out = renderForAgent(
      AGENTS.gemini,
      baseInputs({ canonicalTemplate: evilTemplate }),
    );
    // The inner """ must not close the multi-line string. Renderer escapes
    // each `"` of a `"""` run individually so the closing fence is unique.
    const stripped = out.template.replace(/^description = .*\nprompt = """\n/, '');
    // Count un-escaped triple quotes in the body — should be exactly one
    // (the closing fence at the end).
    const closingFenceCount = (stripped.match(/(^|[^\\])"""/g) ?? []).length;
    expect(closingFenceCount).toBe(1);
  });
});

describe('renderForAgent — Continue (JSON fragment)', () => {
  it('emits valid JSON with name/description/prompt keys (user scope)', () => {
    const out = renderForAgent(AGENTS.continue, baseInputs({ scope: 'user' }));
    expect(out.format).toBe('continue-json-fragment');
    expect(out.file_extension).toBe('json');
    expect(out.is_fragment).toBe(true);
    expect(out.install_path).toBe('~/.continue/config.json');
    expect(out.install_paths.project).toBe('./.continue/config.json');

    // Must parse as valid JSON
    const parsed = JSON.parse(out.template);
    expect(parsed.name).toBe('skills');
    expect(typeof parsed.description).toBe('string');
    expect(parsed.prompt).toContain('{{input}}');
    expect(parsed.prompt).toContain('https://gateway.example.com/api/skills');
  });

  it('safely handles description with quotes, backslashes, and newlines', () => {
    const description = 'has "quotes" and \\slashes\nand newlines';
    const out = renderForAgent(
      AGENTS.continue,
      baseInputs({ description }),
    );
    // JSON.parse round-trips the value losslessly — proves no injection.
    const parsed = JSON.parse(out.template);
    expect(parsed.description).toBe(description);
  });

  it('safely handles an XSS-style command name (server still sanitizes upstream)', () => {
    // The route validates `command_name` strictly; the renderer itself
    // should not crash or produce invalid JSON for unusual but
    // technically-allowed strings.
    const out = renderForAgent(
      AGENTS.continue,
      baseInputs({ commandName: 'a.b-c_d' }),
    );
    const parsed = JSON.parse(out.template);
    expect(parsed.name).toBe('a.b-c_d');
  });
});

describe('renderForAgent — launch_guide', () => {
  it('substitutes {name} with the slash-command name', () => {
    const out = renderForAgent(AGENTS.gemini, baseInputs({ commandName: 'cat' }));
    expect(out.launch_guide).toContain('/cat');
    expect(out.launch_guide).not.toContain('{name}');
  });

  it('preserves the agent label and docs URL in the result', () => {
    const out = renderForAgent(AGENTS.cursor, baseInputs());
    expect(out.label).toBe(AGENTS.cursor.label);
    expect(out.docs_url).toBe(AGENTS.cursor.docsUrl);
  });
});

describe('renderForAgent — base URL handling', () => {
  it('surfaces the provided base URL inside the body', () => {
    const out = renderForAgent(
      AGENTS.claude,
      baseInputs({ baseUrl: 'https://other.example.com' }),
    );
    expect(out.template).toContain('https://other.example.com/api/skills');
    expect(out.template).not.toContain('https://gateway.example.com');
  });
});
