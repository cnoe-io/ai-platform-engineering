/** @jest-environment node */

import JSZip from "jszip";
import PDFDocument from "pdfkit";

import {
  convertDocumentImport,
  importedPagePath,
} from "@/lib/tome/document-import";
import { MAX_IMPORT_FILE_BYTES } from "@/lib/tome/document-import-formats";

jest.mock("unpdf", () => ({
  getDocumentProxy: jest.fn().mockResolvedValue({}),
  extractText: jest.fn().mockResolvedValue({
    totalPages: 1,
    text: "Validated research finding",
  }),
}));

async function minimalDocx(text: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
  );
  zip.folder("_rels")?.file(
    ".rels",
    `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  );
  zip.folder("word")?.file(
    "document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body>
</w:document>`,
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

async function minimalPdf(text: string): Promise<Buffer> {
  const document = new PDFDocument();
  const chunks: Buffer[] = [];
  const output = new Promise<Buffer>((resolve, reject) => {
    document.on("data", (chunk: Buffer) => chunks.push(chunk));
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);
  });
  document.text(text);
  document.end();
  return output;
}

describe("Tome document import", () => {
  it("normalizes every supported source extension to a .md page", () => {
    expect(importedPagePath("notes.md")).toBe("notes.md");
    expect(importedPagePath("guides/intro.mdx")).toBe("guides/intro.md");
    expect(importedPagePath("docs/brief.DOCX")).toBe("docs/brief.md");
    expect(importedPagePath("reports/status.pdf")).toBe("reports/status.md");
    expect(() => importedPagePath("../secret.txt")).toThrow("Invalid import path");
    expect(() => importedPagePath("archive.zip")).toThrow("Unsupported import format");
  });

  it("keeps Markdown verbatim and converts text to a stable page", async () => {
    const markdown = await convertDocumentImport({
      sourcePath: "README.mdx",
      data: Buffer.from("# Existing markdown\n"),
    });
    const text = await convertDocumentImport({
      sourcePath: "meeting-notes.txt",
      data: Buffer.from("Decision: ship it."),
    });

    expect(markdown).toEqual({
      path: "README.md",
      markdown: "# Existing markdown\n",
      warnings: [],
    });
    expect(text.path).toBe("meeting-notes.md");
    expect(text.markdown).toContain("title: Meeting Notes");
    expect(text.markdown).toContain("kind: stable");
    expect(text.markdown).toContain("Decision: ship it.");
  });

  it("converts HTML without executable elements", async () => {
    const result = await convertDocumentImport({
      sourcePath: "overview.html",
      data: Buffer.from(
        "<h1>Overview</h1><p><strong>Ready</strong></p><script>steal()</script>",
      ),
    });

    expect(result.markdown).toContain("# Overview");
    expect(result.markdown).toContain("**Ready**");
    expect(result.markdown).not.toContain("steal()");
  });

  it("extracts text from DOCX", async () => {
    const result = await convertDocumentImport({
      sourcePath: "design.docx",
      data: await minimalDocx("Architecture decision"),
    });

    expect(result.path).toBe("design.md");
    expect(result.markdown).toContain("Architecture decision");
  });

  it("extracts text from PDF", async () => {
    const result = await convertDocumentImport({
      sourcePath: "research.pdf",
      data: await minimalPdf("Validated research finding"),
    });

    expect(result.path).toBe("research.md");
    expect(result.markdown).toContain("Validated research finding");
  });

  it("rejects an oversized document before parsing", async () => {
    await expect(
      convertDocumentImport({
        sourcePath: "large.pdf",
        data: Buffer.alloc(MAX_IMPORT_FILE_BYTES + 1),
      }),
    ).rejects.toThrow("exceeds 10 MB");
  });
});
