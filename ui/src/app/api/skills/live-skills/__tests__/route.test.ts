/**
 * @jest-environment node
 *
 * Tests for GET /api/skills/live-skills
 *
 * Covers:
 *   - Default (no query) renders Claude with default command/description
 *     and reports `agent_fallback: false`.
 *   - Per-agent rendering picks the right format/install_path/argRef.
 *   - Unknown agent ids fall back to Claude with `agent_fallback: true`.
 *   - Sanitization of `command_name`, `description`, and `base_url` rejects
 *     hostile inputs and falls back to safe defaults.
 *   - Template resolution order: SKILLS_LIVE_SKILLS_TEMPLATE env >
 *     SKILLS_LIVE_SKILLS_FILE env > chart-relative file > built-in fallback.
 *   - The response carries the catalog of all agents and the canonical
 *     template for the UI.
 *   - Cache-Control: no-store is set.
 */

const mockNextResponseJson = jest.fn(
  (data: any, init?: { headers?: Record<string, string>; status?: number }) => ({
    json: async () => data,
    status: init?.status ?? 200,
    headers: new Map(Object.entries(init?.headers ?? {})),
  }),
);

jest.mock('next/server', () => ({
  NextResponse: { json: (...args: any[]) => mockNextResponseJson(...args) },
}));

// fs is consulted by safeReadFile — mock both `existsSync` and `statSync` so
// we can stage virtual filesystem layouts per test.
jest.mock('fs', () => ({
  existsSync: jest.fn(),
  statSync: jest.fn(),
  readFileSync: jest.fn(),
}));

import fs from 'fs';
import { GET } from '../route';

const mockExists = fs.existsSync as jest.Mock;
const mockStat = fs.statSync as jest.Mock;
const mockRead = fs.readFileSync as jest.Mock;

const ORIG_ENV = { ...process.env };

beforeEach(() => {
  jest.clearAllMocks();
  // Default: no files exist anywhere — falls through to built-in template.
  mockExists.mockReturnValue(false);
  mockStat.mockReturnValue({ isFile: () => false, size: 0 });
  delete process.env.SKILLS_LIVE_SKILLS_TEMPLATE;
  delete process.env.SKILLS_LIVE_SKILLS_FILE;
});

afterAll(() => {
  process.env = { ...ORIG_ENV };
});

// All pre-existing tests assert the legacy `commands` layout (the only
// layout that existed before the skills/<name>/SKILL.md toggle was added).
// We inject `layout=commands` here so a single change keeps every existing
// expectation valid; skills-layout coverage lives in its own describe block
// that calls GET directly with `layout=skills`.
const callGET = async (url: string) => {
  const u = new URL(url);
  if (!u.searchParams.has('layout')) {
    u.searchParams.set('layout', 'commands');
  }
  const res = await GET(new Request(u.toString()));
  return res.json() as Promise<any>;
};

describe('GET /api/skills/live-skills — defaults', () => {
  it('returns Claude rendering with default command/description when no query', async () => {
    const data = await callGET('https://app.example.com/api/skills/live-skills');

    expect(data.agent).toBe('claude');
    expect(data.agent_fallback).toBe(false);
    expect(data.label).toBe('Claude Code');
    expect(data.format).toBe('markdown-frontmatter');
    expect(data.file_extension).toBe('md');
    expect(data.is_fragment).toBe(false);
    // Without ?scope=, install_path is null and the UI must prompt the user.
    expect(data.install_path).toBeNull();
    expect(data.scope).toBeNull();
    expect(data.scope_requested).toBeNull();
    expect(data.scope_fallback).toBe(false);
    expect(data.scopes_available).toEqual(['user', 'project']);
    expect(data.install_paths).toEqual({
      user: '~/.claude/commands/skills.md',
      project: './.claude/commands/skills.md',
    });

    // The default template uses {{ARG_REF}} which renders to $ARGUMENTS for
    // Claude. Verify it's substituted, not leaked.
    expect(data.template).toContain('$ARGUMENTS');
    expect(data.template).not.toContain('{{ARG_REF}}');

    // base_url defaults to the request origin
    expect(data.inputs.base_url).toBe('https://app.example.com');
    expect(data.inputs.command_name).toBe('skills');

    // Catalog of all agents must be present and well-formed
    expect(Array.isArray(data.agents)).toBe(true);
    expect(data.agents).toHaveLength(6);
    const ids = data.agents.map((a: any) => a.id).sort();
    expect(ids).toEqual([
      'claude',
      'codex',
      'continue',
      'cursor',
      'gemini',
      'specify',
    ]);

    // Defaults block reflects what the UI uses when fields are blank
    expect(data.defaults.command_name).toBe('skills');
    expect(data.defaults.description.length).toBeGreaterThan(0);
  });

  it('sets Cache-Control: no-store', async () => {
    const res = await GET(
      new Request('https://app.example.com/api/skills/live-skills'),
    );
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('reports the source as fallback when no file/env source is configured', async () => {
    const data = await callGET('https://app.example.com/api/skills/live-skills');
    expect(data.source).toBe('fallback');
  });
});

describe('GET /api/skills/live-skills — per-agent rendering', () => {
  // Each row picks a scope that the agent actually supports — Codex is
  // user-only, Spec Kit is project-only, the rest support both and we
  // exercise both flavours below.
  it.each([
    ['claude', 'user', '~/.claude/commands/skills.md', 'markdown-frontmatter', '$ARGUMENTS'],
    ['claude', 'project', './.claude/commands/skills.md', 'markdown-frontmatter', '$ARGUMENTS'],
    ['cursor', 'user', '~/.cursor/commands/skills.md', 'markdown-frontmatter', '$ARGUMENTS'],
    ['cursor', 'project', './.cursor/commands/skills.md', 'markdown-frontmatter', '$ARGUMENTS'],
    [
      'specify',
      'project',
      './.specify/templates/commands/skills.md',
      'markdown-frontmatter',
      '$ARGUMENTS',
    ],
    ['codex', 'user', '~/.codex/prompts/skills.md', 'markdown-plain', '$1'],
    ['gemini', 'user', '~/.gemini/commands/skills.toml', 'gemini-toml', '$1'],
    ['gemini', 'project', './.gemini/commands/skills.toml', 'gemini-toml', '$1'],
    ['continue', 'user', '~/.continue/config.json', 'continue-json-fragment', '{{input}}'],
    ['continue', 'project', './.continue/config.json', 'continue-json-fragment', '{{input}}'],
  ])(
    'agent=%s scope=%s renders with the right install path / format / argRef',
    async (agent, scope, installPath, format, argRef) => {
      const data = await callGET(
        `https://app.example.com/api/skills/live-skills?agent=${agent}&scope=${scope}`,
      );
      expect(data.agent).toBe(agent);
      expect(data.agent_fallback).toBe(false);
      expect(data.install_path).toBe(installPath);
      expect(data.scope).toBe(scope);
      expect(data.scope_fallback).toBe(false);
      expect(data.format).toBe(format);
      expect(data.template).toContain(argRef);
    },
  );

  it('returns scope_fallback=true when the requested scope is not supported', async () => {
    // Codex CLI has no project scope (per openai/codex#9848).
    const data = await callGET(
      'https://app.example.com/api/skills/live-skills?agent=codex&scope=project',
    );
    expect(data.agent).toBe('codex');
    expect(data.scope_requested).toBe('project');
    expect(data.scope).toBeNull();
    expect(data.install_path).toBeNull();
    expect(data.scope_fallback).toBe(true);
    expect(data.scopes_available).toEqual(['user']);
  });

  it('ignores invalid scope values and treats them as unset', async () => {
    const data = await callGET(
      'https://app.example.com/api/skills/live-skills?agent=claude&scope=root',
    );
    expect(data.scope_requested).toBeNull();
    expect(data.install_path).toBeNull();
    expect(data.scope_fallback).toBe(false);
  });

  it('Continue is the only fragment-style result', async () => {
    const cont = await callGET(
      'https://app.example.com/api/skills/live-skills?agent=continue&scope=user',
    );
    expect(cont.is_fragment).toBe(true);

    const claude = await callGET(
      'https://app.example.com/api/skills/live-skills?agent=claude&scope=user',
    );
    expect(claude.is_fragment).toBe(false);
  });

  it('Gemini output is a TOML payload that lints as basic TOML', async () => {
    const data = await callGET(
      'https://app.example.com/api/skills/live-skills?agent=gemini&scope=user',
    );
    expect(data.template).toMatch(/^description = ".+"\nprompt = """\n/);
    expect(data.template).toMatch(/"""\n$/);
  });

  it('Continue output is parseable JSON', async () => {
    const data = await callGET(
      'https://app.example.com/api/skills/live-skills?agent=continue&scope=user',
    );
    const parsed = JSON.parse(data.template);
    expect(parsed.name).toBe('skills');
    expect(typeof parsed.prompt).toBe('string');
  });

  it('falls back to Claude with agent_fallback=true for unknown agents', async () => {
    const data = await callGET(
      'https://app.example.com/api/skills/live-skills?agent=does-not-exist',
    );
    expect(data.agent).toBe('claude');
    expect(data.agent_fallback).toBe(true);
  });

  it('treats agent ids case-insensitively', async () => {
    const data = await callGET(
      'https://app.example.com/api/skills/live-skills?agent=GEMINI',
    );
    expect(data.agent).toBe('gemini');
    expect(data.agent_fallback).toBe(false);
  });
});

describe('GET /api/skills/live-skills — input sanitization', () => {
  it('substitutes a clean command_name into install path and body', async () => {
    const data = await callGET(
      'https://app.example.com/api/skills/live-skills?command_name=my-skills&scope=project',
    );
    expect(data.inputs.command_name).toBe('my-skills');
    expect(data.install_path).toBe('./.claude/commands/my-skills.md');
    expect(data.install_paths.user).toBe('~/.claude/commands/my-skills.md');
    expect(data.template).toContain('/my-skills');
  });

  it.each([
    ['rm -rf /', 'shell metachars'],
    ['../../etc/passwd', 'path traversal'],
    ['name with spaces', 'whitespace'],
    ['name;injection', 'semicolon'],
    ['<script>', 'angle brackets'],
    ['', 'empty string (trimmed)'],
    ['   ', 'whitespace-only'],
    ['x'.repeat(65), 'too long (>64 chars)'],
  ])('rejects hostile command_name (%s) and uses default "skills"', async (bad) => {
    const data = await callGET(
      `https://app.example.com/api/skills/live-skills?command_name=${encodeURIComponent(
        bad,
      )}&scope=project`,
    );
    expect(data.inputs.command_name).toBe('skills');
    expect(data.install_path).toBe('./.claude/commands/skills.md');
  });

  it('caps description at 500 chars', async () => {
    const long = 'a'.repeat(600);
    const data = await callGET(
      `https://app.example.com/api/skills/live-skills?description=${encodeURIComponent(long)}`,
    );
    expect(data.inputs.description.length).toBe(500);
  });

  it('uses a custom base_url when valid (https)', async () => {
    const data = await callGET(
      'https://app.example.com/api/skills/live-skills?base_url=https://gateway.test.io',
    );
    expect(data.inputs.base_url).toBe('https://gateway.test.io');
    expect(data.template).toContain('https://gateway.test.io/api/skills');
  });

  it('strips trailing slashes from base_url', async () => {
    const data = await callGET(
      'https://app.example.com/api/skills/live-skills?base_url=https://gateway.test.io/',
    );
    expect(data.inputs.base_url).toBe('https://gateway.test.io');
  });

  it.each([
    ['javascript:alert(1)', 'javascript: scheme'],
    ['file:///etc/passwd', 'file: scheme'],
    ['ftp://example.com', 'ftp: scheme'],
    ['http://user:pass@example.com', 'embedded credentials'],
    ['not a url', 'invalid URL'],
  ])('rejects hostile base_url (%s) and falls back to request origin', async (bad) => {
    const data = await callGET(
      `https://app.example.com/api/skills/live-skills?base_url=${encodeURIComponent(bad)}`,
    );
    expect(data.inputs.base_url).toBe('https://app.example.com');
  });
});

describe('GET /api/skills/live-skills — template resolution order', () => {
  it('SKILLS_LIVE_SKILLS_TEMPLATE env wins over everything else', async () => {
    process.env.SKILLS_LIVE_SKILLS_TEMPLATE =
      '---\ndescription: From env\n---\nbody from env {{ARG_REF}}\n';
    process.env.SKILLS_LIVE_SKILLS_FILE = '/path/to/file.md';
    mockExists.mockReturnValue(true);
    mockStat.mockReturnValue({ isFile: () => true, size: 100 });
    mockRead.mockReturnValue(
      '---\ndescription: From file\n---\nbody from file\n',
    );

    const data = await callGET(
      'https://app.example.com/api/skills/live-skills',
    );
    expect(data.source).toBe('env:SKILLS_LIVE_SKILLS_TEMPLATE');
    expect(data.template).toContain('body from env');
    expect(data.template).not.toContain('body from file');
    // Description should come from the env template's frontmatter
    expect(data.template).toContain('description: From env');
  });

  it('SKILLS_LIVE_SKILLS_FILE wins when SKILLS_LIVE_SKILLS_TEMPLATE is empty', async () => {
    process.env.SKILLS_LIVE_SKILLS_FILE = '/var/data/live-skills.md';
    mockExists.mockImplementation((p: string) => p === '/var/data/live-skills.md');
    mockStat.mockReturnValue({ isFile: () => true, size: 100 });
    mockRead.mockReturnValue(
      '---\ndescription: From file\n---\nbody from file {{ARG_REF}}\n',
    );

    const data = await callGET(
      'https://app.example.com/api/skills/live-skills',
    );
    expect(data.source).toBe('file:/var/data/live-skills.md');
    expect(data.template).toContain('body from file');
    expect(data.template).toContain('description: From file');
  });

  it('rejects oversized files (>256 KiB) and falls through to the next source', async () => {
    process.env.SKILLS_LIVE_SKILLS_FILE = '/huge.md';
    mockExists.mockReturnValue(true);
    mockStat.mockReturnValue({ isFile: () => true, size: 257 * 1024 });
    mockRead.mockReturnValue('would-be-content');

    // Suppress the expected console.warn from safeReadFile.
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const data = await callGET(
      'https://app.example.com/api/skills/live-skills',
    );
    warnSpy.mockRestore();

    // Falls through to chart-relative path (also missing) → fallback.
    expect(data.source).toBe('fallback');
    expect(mockRead).not.toHaveBeenCalled();
  });

  it('ignores SKILLS_LIVE_SKILLS_FILE when the path is not a regular file', async () => {
    process.env.SKILLS_LIVE_SKILLS_FILE = '/etc';
    mockExists.mockReturnValue(true);
    mockStat.mockReturnValue({ isFile: () => false, size: 0 });
    const data = await callGET(
      'https://app.example.com/api/skills/live-skills',
    );
    expect(data.source).toBe('fallback');
  });

  it('treats a whitespace-only SKILLS_LIVE_SKILLS_TEMPLATE as unset', async () => {
    process.env.SKILLS_LIVE_SKILLS_TEMPLATE = '   \n  ';
    const data = await callGET(
      'https://app.example.com/api/skills/live-skills',
    );
    expect(data.source).toBe('fallback');
  });
});

describe('GET /api/skills/live-skills — response shape', () => {
  it('exposes placeholders, defaults, and the canonical template for the UI', async () => {
    const data = await callGET(
      'https://app.example.com/api/skills/live-skills',
    );
    expect(data.placeholders).toEqual([
      '{{COMMAND_NAME}}',
      '{{DESCRIPTION}}',
      '{{BASE_URL}}',
      '{{ARG_REF}}',
    ]);
    expect(typeof data.canonical_template).toBe('string');
    expect(data.canonical_template.length).toBeGreaterThan(0);
  });

  it('agents catalog reflects the user-supplied command_name in install paths', async () => {
    const data = await callGET(
      'https://app.example.com/api/skills/live-skills?command_name=catalog',
    );
    const claudeMeta = data.agents.find((a: any) => a.id === 'claude');
    const geminiMeta = data.agents.find((a: any) => a.id === 'gemini');
    const codexMeta = data.agents.find((a: any) => a.id === 'codex');
    const specifyMeta = data.agents.find((a: any) => a.id === 'specify');

    // Claude's default layout is now `skills` (Oct 2025 standard), so
    // its top-level install_paths reflect <scope>/.claude/skills/<name>/SKILL.md.
    // The legacy `commands` paths still exist under install_paths_by_layout.
    expect(claudeMeta.default_layout).toBe('skills');
    expect(claudeMeta.layouts_available).toEqual(['skills', 'commands']);
    expect(claudeMeta.install_paths).toEqual({
      user: '~/.claude/skills/catalog/SKILL.md',
      project: './.claude/skills/catalog/SKILL.md',
    });
    expect(claudeMeta.install_paths_by_layout?.commands).toEqual({
      user: '~/.claude/commands/catalog.md',
      project: './.claude/commands/catalog.md',
    });
    expect(claudeMeta.scopes_available).toEqual(['user', 'project']);

    expect(geminiMeta.install_paths.user).toBe('~/.gemini/commands/catalog.toml');
    expect(geminiMeta.install_paths.project).toBe('./.gemini/commands/catalog.toml');

    // Codex CLI is user-only.
    expect(codexMeta.install_paths).toEqual({
      user: '~/.codex/prompts/catalog.md',
    });
    expect(codexMeta.scopes_available).toEqual(['user']);

    // Spec Kit is project-only.
    expect(specifyMeta.install_paths).toEqual({
      project: './.specify/templates/commands/catalog.md',
    });
    expect(specifyMeta.scopes_available).toEqual(['project']);
  });
});

describe('GET /api/skills/live-skills — layout=skills (Shubham C: skills/<name>/SKILL.md)', () => {
  // Uses GET directly (bypasses callGET wrapper) so `layout=skills` is the
  // only layout in the query string — exercises the new skills-layout branch.
  const callGetRaw = async (url: string) => {
    const res = await GET(new Request(url));
    return res.json() as Promise<any>;
  };

  it('renders Claude with the skills layout, frontmatter `name:`, and SKILL.md path', async () => {
    const data = await callGetRaw(
      'https://app.example.com/api/skills/live-skills?agent=claude&layout=skills&scope=user',
    );
    expect(data.layout).toBe('skills');
    expect(data.layout_requested).toBe('skills');
    expect(data.layout_fallback).toBe(false);
    expect(data.layouts_available).toEqual(['skills', 'commands']);
    expect(data.install_path).toBe('~/.claude/skills/skills/SKILL.md');
    // Claude/Cursor/opencode auto-discover skills via the YAML `name:` field;
    // missing it means the skill silently won't load.
    expect(data.template).toMatch(/^---\nname: skills\ndescription: /);
  });

  it('falls back to commands when an agent does not support the skills layout (codex)', async () => {
    const data = await callGetRaw(
      'https://app.example.com/api/skills/live-skills?agent=codex&layout=skills&scope=user',
    );
    expect(data.layout).toBe('commands');
    expect(data.layout_requested).toBe('skills');
    expect(data.layout_fallback).toBe(true);
    expect(data.install_path).toBe('~/.codex/prompts/skills.md');
  });

  it('agents catalog advertises install_paths_by_layout and default_layout', async () => {
    const data = await callGetRaw(
      'https://app.example.com/api/skills/live-skills?layout=skills',
    );
    const claudeMeta = data.agents.find((a: any) => a.id === 'claude');
    expect(claudeMeta.default_layout).toBe('skills');
    expect(claudeMeta.install_paths_by_layout).toEqual({
      commands: {
        user: '~/.claude/commands/skills.md',
        project: './.claude/commands/skills.md',
      },
      skills: {
        user: '~/.claude/skills/skills/SKILL.md',
        project: './.claude/skills/skills/SKILL.md',
      },
    });

    // Codex has no skills layout — only `commands` should appear.
    const codexMeta = data.agents.find((a: any) => a.id === 'codex');
    expect(codexMeta.default_layout).toBe('commands');
    expect(Object.keys(codexMeta.install_paths_by_layout)).toEqual(['commands']);
  });
});
