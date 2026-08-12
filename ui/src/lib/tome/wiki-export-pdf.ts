import path from "node:path";

import { marked, type Token, type Tokens } from "marked";
import PDFDocument from "pdfkit";

import type { WikiExportDocument } from "@/lib/tome/wiki-export";

const FONT_DIRECTORY = path.join(
  /* turbopackIgnore: true */ process.cwd(),
  "node_modules",
  "dejavu-fonts-ttf",
  "ttf",
);
const FONT_REGULAR = "DejaVu";
const FONT_ITALIC = "DejaVuItalic";
const FONT_BOLD = "DejaVuBold";
const FONT_MONO = "DejaVuMono";
const FONT_FILES = {
  [FONT_REGULAR]: path.join(FONT_DIRECTORY, "DejaVuSans.ttf"),
  [FONT_ITALIC]: path.join(FONT_DIRECTORY, "DejaVuSans-Oblique.ttf"),
  [FONT_BOLD]: path.join(FONT_DIRECTORY, "DejaVuSans-Bold.ttf"),
  [FONT_MONO]: path.join(FONT_DIRECTORY, "DejaVuSansMono.ttf"),
} as const;

const COLORS = {
  ink: "#172033",
  strong: "#101828",
  muted: "#667085",
  blue: "#175CD3",
  blueSoft: "#EFF6FF",
  border: "#D0D5DD",
  panel: "#F9FAFB",
} as const;

/** Replace emoji that the embedded monochrome fonts cannot render with readable glyphs. */
export function toPdfSafeText(value: string): string {
  return value
    .replace(/✅/gu, "✓")
    .replace(/❌/gu, "×")
    .replace(/[🔴🟠🟡🟢🔵🟣🟤⚫⚪]/gu, "●")
    .replace(/[\u{1F000}-\u{1FAFF}]/gu, "◆")
    .replace(/\uFE0F/gu, "");
}

function contentWidth(doc: PDFKit.PDFDocument): number {
  return doc.page.width - doc.page.margins.left - doc.page.margins.right;
}

function spaceRemaining(doc: PDFKit.PDFDocument): number {
  return doc.page.height - doc.page.margins.bottom - doc.y;
}

function ensureSpace(doc: PDFKit.PDFDocument, minimumHeight: number): void {
  if (spaceRemaining(doc) < minimumHeight) doc.addPage();
}

function renderCodeBlock(doc: PDFKit.PDFDocument, value: string): void {
  const lines = toPdfSafeText(value || " ").split("\n");
  let offset = 0;

  while (offset < lines.length) {
    ensureSpace(doc, 42);
    doc.font(FONT_MONO).fontSize(8.2);
    const width = contentWidth(doc) - 20;
    const maxTextHeight = Math.max(18, spaceRemaining(doc) - 16);
    const chunk: string[] = [];
    let height = 0;

    while (offset < lines.length) {
      const candidate = [...chunk, lines[offset]].join("\n") || " ";
      const candidateHeight = doc.heightOfString(candidate, { width, lineGap: 1 });
      if (chunk.length > 0 && candidateHeight > maxTextHeight) break;
      chunk.push(lines[offset]);
      height = candidateHeight;
      offset += 1;
    }

    const y = doc.y;
    doc
      .roundedRect(doc.page.margins.left, y, contentWidth(doc), height + 16, 5)
      .fill(COLORS.panel);
    doc
      .fillColor(COLORS.ink)
      .font(FONT_MONO)
      .fontSize(8.2)
      .text(chunk.join("\n") || " ", doc.page.margins.left + 10, y + 8, {
        lineGap: 1,
        width,
      });
    doc.x = doc.page.margins.left;
    doc.y = y + height + 22;

    if (offset < lines.length) doc.addPage();
  }
}

function inlineText(tokens: Token[] | undefined): string {
  if (!tokens) return "";
  return toPdfSafeText(tokens
    .map((token) => {
      switch (token.type) {
        case "text":
          return token.tokens ? inlineText(token.tokens) : token.text;
        case "escape":
        case "codespan":
          return token.text;
        case "strong":
        case "em":
        case "del":
          return inlineText(token.tokens);
        case "br":
          return "\n";
        case "link": {
          const label = inlineText(token.tokens);
          return label === token.href ? label : `${label} (${token.href})`;
        }
        case "image":
          return `[Image: ${token.text || token.title || "image"}] ${token.href}`;
        case "html":
          return token.text.replace(/<[^>]+>/g, "");
        default:
          return "text" in token && typeof token.text === "string" ? token.text : "";
      }
    })
    .join(""));
}

function tokenText(tokens: Token[]): string {
  return toPdfSafeText(tokens
    .map((token) => {
      if ("tokens" in token && Array.isArray(token.tokens)) return inlineText(token.tokens);
      if (token.type === "code") return token.text;
      if (token.type === "list") return token.items.map((item) => tokenText(item.tokens)).join(" ");
      return "text" in token && typeof token.text === "string" ? token.text : "";
    })
    .filter(Boolean)
    .join(" ")
    .trim());
}

function renderTokens(doc: PDFKit.PDFDocument, tokens: Token[], depth = 0): void {
  for (const token of tokens) {
    switch (token.type) {
      case "space":
      case "def":
        break;
      case "heading": {
        const size = token.depth === 1 ? 18 : token.depth === 2 ? 15 : token.depth === 3 ? 13 : 11;
        ensureSpace(doc, size * 2.3);
        doc.moveDown(token.depth <= 2 ? 0.55 : 0.35);
        doc.font(FONT_BOLD).fontSize(size).fillColor(COLORS.strong).text(inlineText(token.tokens), {
          paragraphGap: 4,
        });
        break;
      }
      case "paragraph":
        doc
          .font(FONT_REGULAR)
          .fontSize(10)
          .fillColor(COLORS.ink)
          .text(inlineText(token.tokens), { lineGap: 2, paragraphGap: 5 });
        break;
      case "code":
        renderCodeBlock(doc, token.text);
        break;
      case "blockquote": {
        const text = tokenText(token.tokens);
        doc.font(FONT_ITALIC).fontSize(10);
        const height = doc.heightOfString(text, { width: contentWidth(doc) - 14, lineGap: 2 });
        ensureSpace(doc, Math.min(height + 6, 80));
        const x = doc.x;
        const y = doc.y;
        doc.rect(x, y, 3, Math.max(18, height)).fill(COLORS.border);
        doc
          .font(FONT_ITALIC)
          .fontSize(10)
          .fillColor(COLORS.muted)
          .text(text, x + 12, y, { indent: 0, lineGap: 2, paragraphGap: 5, width: contentWidth(doc) - 14 });
        doc.x = doc.page.margins.left;
        break;
      }
      case "list": {
        const start = typeof token.start === "number" ? token.start : 1;
        const items = token.items.map((item, index) => {
          const marker = token.ordered ? `${start + index}.` : "•";
          const checked = item.task ? (item.checked ? "[x] " : "[ ] ") : "";
          return `${marker} ${checked}${tokenText(item.tokens)}`;
        });
        doc
          .font(FONT_REGULAR)
          .fontSize(10)
          .fillColor(COLORS.ink)
          .text(items.join("\n"), { indent: depth * 10 + 8, lineGap: 3, paragraphGap: 5 });
        break;
      }
      case "table": {
        const cell = (value: Tokens.TableCell): string => inlineText(value.tokens);
        const data: Array<Array<string | PDFKit.Mixins.CellOptions>> = [
          token.header.map((value) => ({
            text: cell(value),
            type: "TH" as const,
            backgroundColor: COLORS.panel,
            font: { family: FONT_BOLD, size: 8 },
          })),
          ...token.rows.map((row) => row.map(cell)),
        ];
        ensureSpace(doc, 64);
        doc.font(FONT_REGULAR).fontSize(8).fillColor(COLORS.ink).table({
          data,
          maxWidth: doc.page.width - doc.page.margins.left - doc.page.margins.right,
          defaultStyle: {
            border: [0.5, 0.5, 0.5, 0.5],
            borderColor: COLORS.border,
            padding: 5,
          },
        });
        doc.moveDown(0.6);
        break;
      }
      case "hr":
        doc.moveDown(0.4);
        doc.moveTo(doc.page.margins.left, doc.y)
          .lineTo(doc.page.width - doc.page.margins.right, doc.y)
          .lineWidth(0.6)
          .stroke(COLORS.border);
        doc.moveDown(0.5);
        break;
      case "html": {
        const text = token.text.replace(/<[^>]+>/g, "").trim();
        if (text) doc.font(FONT_REGULAR).fontSize(9).fillColor(COLORS.muted).text(text);
        break;
      }
      default: {
        const text = "text" in token && typeof token.text === "string" ? token.text : "";
        if (text) doc.font(FONT_REGULAR).fontSize(10).fillColor(COLORS.ink).text(text);
      }
    }
  }
}

function collectPdf(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
}

/** Render a deterministic, downloadable PDF without browser print settings. */
export async function renderWikiPdf(document: WikiExportDocument): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "A4",
    // PDFKit otherwise initializes its built-in Helvetica font before custom
    // fonts are registered. Next.js standalone images do not trace PDFKit's
    // AFM data files, so use the bundled TrueType font from the first byte.
    font: FONT_FILES[FONT_REGULAR],
    margins: { top: 52, right: 48, bottom: 54, left: 48 },
    bufferPages: true,
    info: {
      Title: `${document.projectName} — Wiki export`,
      Author: "TOME",
      Subject: `${document.pages.length}-page project wiki export`,
      CreationDate: document.exportedAt,
    },
  });
  const output = collectPdf(doc);
  Object.entries(FONT_FILES).forEach(([name, file]) => doc.registerFont(name, file));

  // Cover.
  doc.rect(0, 0, doc.page.width, 10).fill(COLORS.blue);
  doc.y = 156;
  doc.font(FONT_BOLD).fontSize(10).fillColor(COLORS.blue).text("TOME  /  WIKI EXPORT", {
    characterSpacing: 1.2,
  });
  doc.moveDown(0.8);
  doc.font(FONT_BOLD).fontSize(34).fillColor(COLORS.strong).text(toPdfSafeText(document.projectName), {
    lineGap: 2,
  });
  doc.moveDown(0.3);
  doc.font(FONT_REGULAR).fontSize(14).fillColor(COLORS.muted).text("Project knowledge base");
  doc.moveDown(2.3);
  const coverBoxY = doc.y;
  doc.roundedRect(doc.page.margins.left, coverBoxY, contentWidth(doc), 72, 7).fill(COLORS.blueSoft);
  doc
    .font(FONT_BOLD)
    .fontSize(22)
    .fillColor(COLORS.blue)
    .text(String(document.pages.length), doc.page.margins.left + 18, coverBoxY + 14, {
      lineBreak: false,
    });
  doc
    .font(FONT_REGULAR)
    .fontSize(9)
    .fillColor(COLORS.muted)
    .text("WIKI PAGES", doc.page.margins.left + 18, coverBoxY + 43, {
      characterSpacing: 0.6,
      lineBreak: false,
    });
  doc
    .font(FONT_REGULAR)
    .fontSize(10)
    .fillColor(COLORS.muted)
    .text(`Exported ${document.exportedAt.toISOString()}`, doc.page.margins.left + 92, coverBoxY + 27, {
      lineBreak: false,
    });

  // Linked table of contents.
  doc.addPage();
  doc.font(FONT_BOLD).fontSize(22).fillColor(COLORS.strong).text("Contents");
  doc.moveDown(0.25);
  doc.font(FONT_REGULAR).fontSize(10).fillColor(COLORS.muted).text("Jump to any page in this export.");
  doc.moveDown(1);
  for (const [index, page] of document.pages.entries()) {
    ensureSpace(doc, 38);
    const y = doc.y;
    if (index % 2 === 0) {
      doc.roundedRect(doc.page.margins.left, y, contentWidth(doc), 34, 4).fill(COLORS.panel);
    }
    doc
      .font(FONT_BOLD)
      .fontSize(9)
      .fillColor(COLORS.blue)
      .text(String(index + 1).padStart(2, "0"), doc.page.margins.left + 10, y + 8, {
        goTo: page.anchor,
        lineBreak: false,
        width: 22,
      });
    doc
      .font(FONT_BOLD)
      .fontSize(9.5)
      .fillColor(COLORS.strong)
      .text(toPdfSafeText(page.title), doc.page.margins.left + 42, y + 6, {
        goTo: page.anchor,
        lineBreak: false,
        width: contentWidth(doc) - 190,
      });
    doc
      .font(FONT_REGULAR)
      .fontSize(8)
      .fillColor(COLORS.muted)
      .text(toPdfSafeText(page.path), doc.page.margins.left + 42, y + 19, {
        goTo: page.anchor,
        lineBreak: false,
        width: contentWidth(doc) - 52,
      });
    doc.y = y + 38;
  }

  // Each wiki page starts on a fresh PDF page and appears in PDF bookmarks.
  for (const page of document.pages) {
    doc.addPage();
    doc.outline.addItem(`${page.title} — ${page.path}`);
    doc
      .font(FONT_REGULAR)
      .fontSize(8.5)
      .fillColor(COLORS.blue)
      .text(toPdfSafeText(page.path), { destination: page.anchor });
    doc.moveDown(0.45);
    doc.font(FONT_BOLD).fontSize(22).fillColor(COLORS.strong).text(toPdfSafeText(page.title));
    doc.moveDown(0.35);
    const badgeY = doc.y;
    const badgeLabel = page.kind.toUpperCase();
    const badgeWidth = doc.font(FONT_BOLD).fontSize(7.5).widthOfString(badgeLabel) + 14;
    doc.roundedRect(doc.page.margins.left, badgeY, badgeWidth, 17, 8).fill(COLORS.blueSoft);
    doc.font(FONT_BOLD).fontSize(7.5).fillColor(COLORS.blue).text(badgeLabel, doc.page.margins.left + 7, badgeY + 5, {
      characterSpacing: 0.8,
      lineBreak: false,
    });
    doc.x = doc.page.margins.left;
    doc.y = badgeY + 29;
    doc.moveTo(doc.page.margins.left, doc.y)
      .lineTo(doc.page.width - doc.page.margins.right, doc.y)
      .lineWidth(0.8)
      .stroke(COLORS.border);
    doc.moveDown(0.8);
    if (page.body) {
      renderTokens(doc, marked.lexer(page.body, { gfm: true }));
    } else {
      doc.font(FONT_ITALIC).fontSize(10).fillColor(COLORS.muted).text("(no content)");
    }
  }

  // Stable page numbers, independent of browser print headers/footers.
  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    const pageWidth = contentWidth(doc);
    const bottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc
      .font(FONT_REGULAR)
      .fontSize(8)
      .fillColor(COLORS.muted)
      .text(toPdfSafeText(document.projectName), doc.page.margins.left, doc.page.height - 32, {
        align: "left",
        width: pageWidth,
        lineBreak: false,
      })
      .text(`${index + 1} / ${range.count}`, doc.page.margins.left, doc.page.height - 32, {
        align: "right",
        width: pageWidth,
        lineBreak: false,
      });
    doc.page.margins.bottom = bottomMargin;
  }

  doc.end();
  return output;
}
