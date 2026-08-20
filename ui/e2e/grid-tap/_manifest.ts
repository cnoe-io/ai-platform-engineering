import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type GridTapManifestEntry =
  | { kind: "tome_project"; id: string; slug: string; object: string }
  | { kind: "tome_page"; id: string; slug: string; path: string }
  | { kind: "tome_gist"; id: string; slug: string };

type GridTapManifest = {
  runId: string;
  resources: GridTapManifestEntry[];
};

function segment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 96);
}

function manifestPath(): string {
  const runId = segment(process.env.GRID_TAP_RUN_ID || "local");
  return path.join(process.cwd(), "test-results", "grid-tap", runId, "manifest.json");
}

export async function readManifest(): Promise<GridTapManifest> {
  const runId = segment(process.env.GRID_TAP_RUN_ID || "local");
  try {
    return JSON.parse(await readFile(manifestPath(), "utf8")) as GridTapManifest;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return { runId, resources: [] };
  }
}

export async function recordResource(entry: GridTapManifestEntry): Promise<void> {
  const manifest = await readManifest();
  if (!manifest.resources.some((candidate) => (
    candidate.kind === entry.kind && candidate.id === entry.id
  ))) {
    manifest.resources.push(entry);
  }
  await mkdir(path.dirname(manifestPath()), { recursive: true });
  await writeFile(manifestPath(), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

export async function clearManifest(): Promise<void> {
  const manifest = await readManifest();
  await mkdir(path.dirname(manifestPath()), { recursive: true });
  await writeFile(
    manifestPath(),
    `${JSON.stringify({ ...manifest, resources: [] }, null, 2)}\n`,
    "utf8",
  );
}
