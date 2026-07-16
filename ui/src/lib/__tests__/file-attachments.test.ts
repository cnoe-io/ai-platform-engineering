/**
 * Tests for the multimodal file-attachment helpers.
 *
 * Covers the MIME allowlist + caps (which must mirror the backend), the
 * base64 encoding round-trip into the InputFile shape, and the accepted/
 * rejected split from validateFiles.
 */

import {
  ACCEPTED_MIME_TYPES,
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES,
  fileToInputFile,
  formatBytes,
  isAcceptedMimeType,
  validateFiles,
} from "@/lib/file-attachments";

/** Build a File of a given declared type/size without allocating real bytes. */
function fakeFile(name: string, type: string, size: number, contents = "x"): File {
  const file = new File([contents], name, { type });
  // jsdom derives size from contents; override to exercise the cap logic.
  Object.defineProperty(file, "size", { value: size });
  return file;
}

describe("MIME allowlist", () => {
  it("accepts the backend image + doc types", () => {
    expect(isAcceptedMimeType("image/png")).toBe(true);
    expect(isAcceptedMimeType("application/pdf")).toBe(true);
    expect(isAcceptedMimeType("text/markdown")).toBe(true);
  });

  it("rejects types the backend would drop", () => {
    expect(isAcceptedMimeType("application/zip")).toBe(false);
    expect(isAcceptedMimeType("video/mp4")).toBe(false);
    expect(isAcceptedMimeType("")).toBe(false);
  });

  it("mirrors the documented caps", () => {
    expect(MAX_FILE_BYTES).toBe(20 * 1024 * 1024);
    expect(MAX_TOTAL_BYTES).toBe(40 * 1024 * 1024);
    // A representative sample of the allowlist is present.
    expect(ACCEPTED_MIME_TYPES).toEqual(
      expect.arrayContaining(["image/jpeg", "image/webp", "text/csv"]),
    );
  });
});

describe("fileToInputFile", () => {
  it("produces {mime_type, data, name} with base64 payload only", async () => {
    const file = new File(["hello"], "greeting.txt", { type: "text/plain" });

    const out = await fileToInputFile(file);

    expect(out.name).toBe("greeting.txt");
    expect(out.mime_type).toBe("text/plain");
    // No data: URI prefix should leak into the payload.
    expect(out.data).not.toContain("base64,");
    expect(out.data).not.toContain("data:");
    // Round-trips back to the original content.
    expect(Buffer.from(out.data, "base64").toString("utf-8")).toBe("hello");
  });

  it("falls back to octet-stream when the browser reports no type", async () => {
    const file = new File(["# doc"], "notes.md", { type: "" });

    const out = await fileToInputFile(file);

    expect(out.mime_type).toBe("application/octet-stream");
  });
});

describe("validateFiles", () => {
  it("rejects unsupported MIME types", () => {
    const { accepted, rejected } = validateFiles(
      [],
      [fakeFile("a.zip", "application/zip", 10)],
    );
    expect(accepted).toHaveLength(0);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatch(/unsupported/i);
  });

  it("rejects a single file over the per-file cap", () => {
    const { accepted, rejected } = validateFiles(
      [],
      [fakeFile("big.pdf", "application/pdf", MAX_FILE_BYTES + 1)],
    );
    expect(accepted).toHaveLength(0);
    expect(rejected[0].reason).toMatch(/per-file/i);
  });

  it("admits files up to the total cap and rejects the overflow", () => {
    const half = MAX_TOTAL_BYTES / 2;
    const { accepted, rejected } = validateFiles(
      [],
      [
        fakeFile("a.png", "image/png", half),
        fakeFile("b.png", "image/png", half),
        fakeFile("c.png", "image/png", 1),
      ],
    );
    expect(accepted.map((f) => f.name)).toEqual(["a.png", "b.png"]);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].name).toBe("c.png");
    expect(rejected[0].reason).toMatch(/total/i);
  });

  it("counts already-staged files against the total cap", () => {
    const existing = [fakeFile("staged.pdf", "application/pdf", MAX_TOTAL_BYTES - 10)];
    const { accepted, rejected } = validateFiles(existing, [
      fakeFile("new.pdf", "application/pdf", 100),
    ]);
    expect(accepted).toHaveLength(0);
    expect(rejected[0].reason).toMatch(/total/i);
  });

  it("preserves order and passes valid files through", () => {
    const { accepted, rejected } = validateFiles(
      [],
      [
        fakeFile("a.png", "image/png", 1024),
        fakeFile("b.pdf", "application/pdf", 2048),
      ],
    );
    expect(accepted.map((f) => f.name)).toEqual(["a.png", "b.pdf"]);
    expect(rejected).toHaveLength(0);
  });
});

describe("formatBytes", () => {
  it("renders human-readable sizes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(20 * 1024 * 1024)).toBe("20 MB");
  });
});
