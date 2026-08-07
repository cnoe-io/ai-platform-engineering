/**
 * Expand @file and @glob: patterns in user prompts (inline attachments).
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";

const MAX_FILE_BYTES = 80_000;
const MAX_GLOB_FILES = 20;

export function expandPromptAttachments(cwd: string, text: string): string {
  let out = text;

  // @glob:pattern — e.g. @glob:src/**/*.ts (simple * suffix/prefix only)
  out = out.replace(/@glob:([^\s]+)/g, (_match, pattern: string) => {
    const files = simpleGlob(cwd, pattern.trim());
    if (files.length === 0) {
      return `\n[attachment: glob "${pattern}" matched no files under ${cwd}]\n`;
    }
    const blocks = files.map((f) => readFileBlock(cwd, f)).filter(Boolean);
    return `\n${blocks.join("\n\n")}\n`;
  });

  // @path or @"path with spaces"
  out = out.replace(/@"([^"]+)"|@([^\s@]+)/g, (match, quoted: string, bare: string) => {
    if (match.startsWith("@glob:")) return match;
    const rel = (quoted ?? bare).trim();
    if (!rel || rel === "glob:") return match;
    const block = readFileBlock(cwd, rel);
    return block ?? `\n[attachment: could not read ${rel}]\n`;
  });

  return out;
}

function readFileBlock(cwd: string, relPath: string): string | null {
  const abs = isAbsolute(relPath) ? relPath : resolve(cwd, relPath);
  const rel = relative(cwd, abs);
  if (rel.startsWith("..")) return null;
  try {
    const st = statSync(abs);
    if (!st.isFile()) return null;
    if (st.size > MAX_FILE_BYTES) {
      return `<file path="${rel}" truncated="true">\n${readFileSync(abs, "utf8").slice(0, MAX_FILE_BYTES)}\n...(truncated)\n</file>`;
    }
    const content = readFileSync(abs, "utf8");
    return `<file path="${rel}">\n${content}\n</file>`;
  } catch {
    return null;
  }
}

function simpleGlob(cwd: string, pattern: string): string[] {
  const results: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 8 || results.length >= MAX_GLOB_FILES) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (name === "node_modules" || name === ".git" || name === ".venv") continue;
      const full = join(dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        walk(full, depth + 1);
      } else if (st.isFile() && matchSimplePattern(relative(cwd, full), pattern)) {
        results.push(relative(cwd, full));
      }
    }
  };
  walk(cwd, 0);
  return results.slice(0, MAX_GLOB_FILES);
}

function matchSimplePattern(path: string, pattern: string): boolean {
  const norm = pattern.replace(/\\/g, "/");
  if (norm.includes("**")) {
    const suffix = norm.split("**").pop()?.replace(/^\//, "") ?? "";
    return suffix ? path.endsWith(suffix) || path.includes(suffix) : true;
  }
  if (norm.includes("*")) {
    const re = new RegExp(
      `^${norm.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`,
    );
    return re.test(path);
  }
  return path === norm || path.endsWith(`/${norm}`) || basename(path) === norm;
}
