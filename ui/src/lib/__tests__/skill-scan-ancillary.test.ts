/**
 * Tests for `scanSkillContent` ancillary-file packaging.
 *
 * The agent runtime materializes `ancillary_files` into the StateBackend
 * at /skills/<source>/<name>/<rel_path> (see
 * `skills_middleware/backend_sync.py` and
 * `dynamic_agents/services/skills.py`), so the scanner must analyze
 * those same files — otherwise prompt-injection / shell-injection in a
 * sibling script bypasses scanning entirely.
 *
 * We assert:
 *   1. Ancillary files are uploaded alongside SKILL.md.
 *   2. Path traversal / absolute paths / SKILL.md collisions are dropped.
 *   3. The total ancillary payload is capped (smallest-first) and the
 *      truncation reason is surfaced in `scan_summary`.
 *   4. Empty / missing ancillary maps fall back to the SKILL.md-only behaviour.
 */

// Avoid loading the real mongodb driver (ESM `bson`) — skill-scan
// imports `getCollection` for the hub auto-scan helper.
jest.mock("@/lib/mongodb", () => ({
  getCollection: jest.fn(),
  isMongoDBConfigured: false,
}));

jest.mock("@/lib/skill-scan-history", () => ({
  recordScanEvent: jest.fn(),
}));

import JSZip from "jszip";

const SCANNER_URL = "http://skill-scanner.test:8000";
const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  jest.resetModules();
  process.env = { ...ORIGINAL_ENV, SKILL_SCANNER_URL: SCANNER_URL };
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

interface CapturedZip {
  /** Map of in-zip path → UTF-8 content. */
  entries: Record<string, string>;
}

/**
 * jsdom's Blob doesn't implement `arrayBuffer()` and we deliberately
 * avoid polyfilling Web Response. Use the FileReader API which jsdom
 * does support, falling back to JSZip's stream reader.
 */
function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"));
    reader.readAsArrayBuffer(blob);
  });
}

/**
 * Stub global.fetch with a happy-path scanner response that records the
 * uploaded ZIP for later assertions.
 */
function stubScannerOk(): { captured: CapturedZip } {
  const captured: CapturedZip = { entries: {} };
  const impl = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    expect(url).toBe(`${SCANNER_URL}/scan-upload`);
    const form = init?.body as FormData;
    const file = form.get("file") as Blob;
    // jsdom's Blob lacks arrayBuffer(); FileReader-style read via
    // node-buffer keeps this working without polyfilling Response.
    const ab = await blobToArrayBuffer(file);
    const zip = await JSZip.loadAsync(ab);
    for (const [path, entry] of Object.entries(zip.files)) {
      // jszip exposes folders as entries too; only pick file contents.
      if (!entry.dir) {
        captured.entries[path] = await entry.async("string");
      }
    }
    // Return a fetch-Response-shaped duck so we don't need to polyfill
    // the Web Response class in jsdom.
    const payload = {
      is_safe: true,
      max_severity: "safe",
      findings_count: 0,
      findings: [],
      scan_duration_seconds: 0.05,
    };
    return {
      ok: true,
      status: 200,
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    } as unknown as Response;
  };
  (global as unknown as { fetch: typeof fetch }).fetch = jest.fn(impl) as unknown as typeof fetch;
  return { captured };
}

describe("scanSkillContent ancillary packaging", () => {
  it("packages ancillary files alongside SKILL.md", async () => {
    const { captured } = stubScannerOk();
    const { scanSkillContent } = await import("../skill-scan");

    const result = await scanSkillContent(
      "my-skill",
      "# Skill body\nUses `scripts/check.sh`.",
      "id-1",
      {
        ancillaryFiles: {
          "scripts/check.sh": "#!/bin/sh\necho hi\n",
          "examples/report.md": "# Example\n",
        },
      },
    );

    expect(result.scan_status).toBe("passed");
    expect(captured.entries).toEqual({
      "my-skill/SKILL.md": "# Skill body\nUses `scripts/check.sh`.",
      "my-skill/scripts/check.sh": "#!/bin/sh\necho hi\n",
      "my-skill/examples/report.md": "# Example\n",
    });
  });

  it("drops unsafe paths (traversal / absolute / SKILL.md collision)", async () => {
    const { captured } = stubScannerOk();
    const { scanSkillContent } = await import("../skill-scan");

    await scanSkillContent("safe", "# body", "id-2", {
      ancillaryFiles: {
        "../escape.sh": "should not appear",
        "/abs.sh": "should not appear",
        "subdir/../../escape.sh": "should not appear",
        "SKILL.md": "should not overwrite root",
        "ok/keep.txt": "kept",
      },
    });

    const paths = Object.keys(captured.entries).sort();
    expect(paths).toEqual(["safe/SKILL.md", "safe/ok/keep.txt"]);
    // Root SKILL.md was *not* clobbered by the malicious entry.
    expect(captured.entries["safe/SKILL.md"]).toBe("# body");
  });

  it("caps total ancillary bytes and surfaces truncation in scan_summary", async () => {
    process.env.SKILL_SCAN_ANCILLARY_BYTE_CAP = "1024";
    const { captured } = stubScannerOk();
    const { scanSkillContent } = await import("../skill-scan");

    // 700-byte file fits, 700-byte file doesn't (cap = 1024).
    // Smallest-first ordering ensures the small one always lands.
    const result = await scanSkillContent("big", "# body", "id-3", {
      ancillaryFiles: {
        "small.txt": "x".repeat(50),
        "medium.txt": "y".repeat(700),
        "large.txt": "z".repeat(700),
      },
    });

    const paths = Object.keys(captured.entries).sort();
    // small + medium fit (50 + 700 = 750 ≤ 1024); large is dropped.
    expect(paths).toEqual([
      "big/SKILL.md",
      "big/medium.txt",
      "big/small.txt",
    ]);
    expect(result.scan_status).toBe("passed");
    expect(result.scan_summary).toMatch(/1 ancillary file\(s\) skipped/);
  });

  it("falls back to SKILL.md-only when ancillaryFiles is omitted or empty", async () => {
    const { captured } = stubScannerOk();
    const { scanSkillContent } = await import("../skill-scan");

    await scanSkillContent("plain", "# only body", "id-4", {});
    expect(Object.keys(captured.entries)).toEqual(["plain/SKILL.md"]);

    await scanSkillContent("plain2", "# only body", "id-5", {
      ancillaryFiles: {},
    });
  });

  it("ignores legacy ScanAuth fourth-arg without breaking compatibility", async () => {
    const { captured } = stubScannerOk();
    const { scanSkillContent } = await import("../skill-scan");

    // Old call sites passed `{ accessToken, catalogKey }` here. Must not
    // be misinterpreted as ancillary files.
    await scanSkillContent("legacy", "# body", "id-6", {
      accessToken: "tok",
      catalogKey: "key",
    } as unknown as never);
    expect(Object.keys(captured.entries)).toEqual(["legacy/SKILL.md"]);
  });
});
