/**
 * @jest-environment node
 *
 * Tests for GET /api/skills/bootstrap
 *
 * Covers:
 *   - Default (no query) renders Claude with default command/description
 *     and reports `agent_fallback: false`.
 *   - Per-agent rendering picks the right format/install_path/argRef.
 *   - Unknown agent ids fall back to Claude with `agent_fallback: true`.
 *   - Sanitization of `command_name`, `description`, and `base_url` rejects
 *     hostile inputs and falls back to safe defaults.
 *   - Template resolution order: SKILLS_BOOTSTRAP_TEMPLATE env >
 *     SKILLS_BOOTSTRAP_FILE env > chart-relative file > built-in fallback.
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
  delete process.env.SKILLS_BOOTSTRAP_TEMPLATE;
  delete process.env.SKILLS_BOOTSTRAP_FILE;
});

afterAll(() => {
  process.env = { ...ORIG_ENV };
});

const callGET = async (url: string) => {
  const res = await GET(new Request(url));
  return res.json() as Promise<any>;
};

describe('GET /api/skills/bootstrap — defaults', () => {
  it('returns Claude rendering with default command/description when no query', async () => {
    const data = await callGET('https://app.example.com/api/skills/bootstrap');

    expect(data.agent).toBe('claude');
    expect(data.agent_fallback).toBe(false);
    expect(data.label).toBe('Claude Code');
    expect(data.format).toBe('markdown-frontmatter');
    expect(data.file_extension).toBe('md');
    expect(data.is_fragment).toBe(false);
    expect(data.install_path).toBe('.claude/commands/skills.md');

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
      new Request('https://app.example.com/api/skills/bootstrap'),
    );
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('reports the source as fallback when no file/env source is configured', async () => {
    const data = await callGET('https://app.example.com/api/skills/bootstrap');
    expect(data.source).toBe('fallback');
  });
});

describe('GET /api/skills/bootstrap — per-agent rendering', () => {
  it.each([
    ['claude', '.claude/commands/skills.md', 'markdown-frontmatter', '$ARGUMENTS'],
    ['cursor', '.cursor/commands/skills.md', 'markdown-frontmatter', '$ARGUMENTS'],
    [
      'specify',
      '.specify/templates/commands/skills.md',
      'markdown-frontmatter',
      '$ARGUMENTS',
    ],
    ['codex', '~/.codex/prompts/skills.md', 'markdown-plain', '$1'],
    ['gemini', '~/.gemini/commands/skills.toml', 'gemini-toml', '$1'],
    ['continue', '~/.continue/config.json', 'continue-json-fragment', '{{input}}'],
  ])(
    'agent=%s renders with the right install path / format / argRef',
    async (agent, installPath, format, argRef) => {
      const data = await callGET(
        `https://app.example.com/api/skills/bootstrap?agent=${agent}`,
      );
      expect(data.agent).toBe(agent);
      expect(data.agent_fallback).toBe(false);
      expect(data.install_path).toBe(installPath);
      expect(data.format).toBe(format);
      expect(data.template).toContain(argRef);
    },
  );

  it('Continue is the only fragment-style result', async () => {
    const cont = await callGET(
      'https://app.example.com/api/skills/bootstrap?agent=continue',
    );
    expect(cont.is_fragment).toBe(true);

    const claude = await callGET(
      'https://app.example.com/api/skills/bootstrap?agent=claude',
    );
    expect(claude.is_fragment).toBe(false);
  });

  it('Gemini output is a TOML payload that lints as basic TOML', async () => {
    const data = await callGET(
      'https://app.example.com/api/skills/bootstrap?agent=gemini',
    );
    expect(data.template).toMatch(/^description = ".+"\nprompt = """\n/);
    expect(data.template).toMatch(/"""\n$/);
  });

  it('Continue output is parseable JSON', async () => {
    const data = await callGET(
      'https://app.example.com/api/skills/bootstrap?agent=continue',
    );
    const parsed = JSON.parse(data.template);
    expect(parsed.name).toBe('skills');
    expect(typeof parsed.prompt).toBe('string');
  });

  it('falls back to Claude with agent_fallback=true for unknown agents', async () => {
    const data = await callGET(
      'https://app.example.com/api/skills/bootstrap?agent=does-not-exist',
    );
    expect(data.agent).toBe('claude');
    expect(data.agent_fallback).toBe(true);
  });

  it('treats agent ids case-insensitively', async () => {
    const data = await callGET(
      'https://app.example.com/api/skills/bootstrap?agent=GEMINI',
    );
    expect(data.agent).toBe('gemini');
    expect(data.agent_fallback).toBe(false);
  });
});

describe('GET /api/skills/bootstrap — input sanitization', () => {
  it('substitutes a clean command_name into install path and body', async () => {
    const data = await callGET(
      'https://app.example.com/api/skills/bootstrap?command_name=my-skills',
    );
    expect(data.inputs.command_name).toBe('my-skills');
    expect(data.install_path).toBe('.claude/commands/my-skills.md');
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
      `https://app.example.com/api/skills/bootstrap?command_name=${encodeURIComponent(
        bad,
      )}`,
    );
    expect(data.inputs.command_name).toBe('skills');
    expect(data.install_path).toBe('.claude/commands/skills.md');
  });

  it('caps description at 500 chars', async () => {
    const long = 'a'.repeat(600);
    const data = await callGET(
      `https://app.example.com/api/skills/bootstrap?description=${encodeURIComponent(long)}`,
    );
    expect(data.inputs.description.length).toBe(500);
  });

  it('uses a custom base_url when valid (https)', async () => {
    const data = await callGET(
      'https://app.example.com/api/skills/bootstrap?base_url=https://gateway.test.io',
    );
    expect(data.inputs.base_url).toBe('https://gateway.test.io');
    expect(data.template).toContain('https://gateway.test.io/api/skills');
  });

  it('strips trailing slashes from base_url', async () => {
    const data = await callGET(
      'https://app.example.com/api/skills/bootstrap?base_url=https://gateway.test.io/',
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
      `https://app.example.com/api/skills/bootstrap?base_url=${encodeURIComponent(bad)}`,
    );
    expect(data.inputs.base_url).toBe('https://app.example.com');
  });
});

describe('GET /api/skills/bootstrap — template resolution order', () => {
  it('SKILLS_BOOTSTRAP_TEMPLATE env wins over everything else', async () => {
    process.env.SKILLS_BOOTSTRAP_TEMPLATE =
      '---\ndescription: From env\n---\nbody from env {{ARG_REF}}\n';
    process.env.SKILLS_BOOTSTRAP_FILE = '/path/to/file.md';
    mockExists.mockReturnValue(true);
    mockStat.mockReturnValue({ isFile: () => true, size: 100 });
    mockRead.mockReturnValue(
      '---\ndescription: From file\n---\nbody from file\n',
    );

    const data = await callGET(
      'https://app.example.com/api/skills/bootstrap',
    );
    expect(data.source).toBe('env:SKILLS_BOOTSTRAP_TEMPLATE');
    expect(data.template).toContain('body from env');
    expect(data.template).not.toContain('body from file');
    // Description should come from the env template's frontmatter
    expect(data.template).toContain('description: From env');
  });

  it('SKILLS_BOOTSTRAP_FILE wins when SKILLS_BOOTSTRAP_TEMPLATE is empty', async () => {
    process.env.SKILLS_BOOTSTRAP_FILE = '/var/data/bootstrap.md';
    mockExists.mockImplementation((p: string) => p === '/var/data/bootstrap.md');
    mockStat.mockReturnValue({ isFile: () => true, size: 100 });
    mockRead.mockReturnValue(
      '---\ndescription: From file\n---\nbody from file {{ARG_REF}}\n',
    );

    const data = await callGET(
      'https://app.example.com/api/skills/bootstrap',
    );
    expect(data.source).toBe('file:/var/data/bootstrap.md');
    expect(data.template).toContain('body from file');
    expect(data.template).toContain('description: From file');
  });

  it('rejects oversized files (>256 KiB) and falls through to the next source', async () => {
    process.env.SKILLS_BOOTSTRAP_FILE = '/huge.md';
    mockExists.mockReturnValue(true);
    mockStat.mockReturnValue({ isFile: () => true, size: 257 * 1024 });
    mockRead.mockReturnValue('would-be-content');

    // Suppress the expected console.warn from safeReadFile.
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const data = await callGET(
      'https://app.example.com/api/skills/bootstrap',
    );
    warnSpy.mockRestore();

    // Falls through to chart-relative path (also missing) → fallback.
    expect(data.source).toBe('fallback');
    expect(mockRead).not.toHaveBeenCalled();
  });

  it('ignores SKILLS_BOOTSTRAP_FILE when the path is not a regular file', async () => {
    process.env.SKILLS_BOOTSTRAP_FILE = '/etc';
    mockExists.mockReturnValue(true);
    mockStat.mockReturnValue({ isFile: () => false, size: 0 });
    const data = await callGET(
      'https://app.example.com/api/skills/bootstrap',
    );
    expect(data.source).toBe('fallback');
  });

  it('treats a whitespace-only SKILLS_BOOTSTRAP_TEMPLATE as unset', async () => {
    process.env.SKILLS_BOOTSTRAP_TEMPLATE = '   \n  ';
    const data = await callGET(
      'https://app.example.com/api/skills/bootstrap',
    );
    expect(data.source).toBe('fallback');
  });
});

describe('GET /api/skills/bootstrap — response shape', () => {
  it('exposes placeholders, defaults, and the canonical template for the UI', async () => {
    const data = await callGET(
      'https://app.example.com/api/skills/bootstrap',
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
      'https://app.example.com/api/skills/bootstrap?command_name=catalog',
    );
    const claudeMeta = data.agents.find((a: any) => a.id === 'claude');
    const geminiMeta = data.agents.find((a: any) => a.id === 'gemini');
    expect(claudeMeta.install_path).toBe('.claude/commands/catalog.md');
    expect(geminiMeta.install_path).toBe('~/.gemini/commands/catalog.toml');
  });
});
