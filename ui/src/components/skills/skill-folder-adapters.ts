import type { FolderAdapter, FolderEntry, FolderFileContent } from "./SkillFolderViewer";

interface SuccessEnvelope<T> {
  data?: T;
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  const data = (await res.json().catch(() => ({}))) as SuccessEnvelope<T> & {
    error?: string;
    message?: string;
  } & T;
  if (!res.ok) {
    const msg =
      typeof data?.error === "string"
        ? data.error
        : data?.message || `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return (data?.data ?? data) as T;
}

interface ListResp {
  entries: FolderEntry[];
  path: string;
}

/** Read-only adapter for hub-crawled skills (lazy GitHub/GitLab Contents API). */
export function makeHubFolderAdapter(opts: {
  hubId: string;
  skillId: string;
  label: string;
  externalUrl?: string;
}): FolderAdapter {
  const base = `/api/skills/hub/${encodeURIComponent(opts.hubId)}/${encodeURIComponent(opts.skillId)}/files`;
  return {
    label: opts.label,
    externalUrl: opts.externalUrl,
    editable: false,
    async list(path: string): Promise<FolderEntry[]> {
      const url = path ? `${base}?path=${encodeURIComponent(path)}` : base;
      const data = await jsonOrThrow<ListResp>(
        await fetch(url, { credentials: "include" }),
      );
      // Make returned `path` relative to the skill folder root for the tree
      // since the API returns repo-rooted paths like "skills/foo/bar.md".
      // We strip the skill dir prefix so the client tree matches what the
      // user expects to see.
      return data.entries;
    },
    async read(path: string): Promise<FolderFileContent> {
      const url = `${base}/content?path=${encodeURIComponent(path)}`;
      return await jsonOrThrow<FolderFileContent>(
        await fetch(url, { credentials: "include" }),
      );
    },
  };
}

/**
 * Read-only adapter for filesystem-packaged default templates that aren't
 * persisted in Mongo. Surfaces the SKILL.md body the gallery already loaded
 * via `/api/skills` (the `content` field) so the viewer never has to call the
 * configs API for a row it can't find.
 */
export function makeStaticFolderAdapter(opts: {
  label: string;
  skillContent: string;
}): FolderAdapter {
  return {
    label: opts.label,
    editable: false,
    async list(path: string): Promise<FolderEntry[]> {
      if (path) return [];
      return [
        {
          name: "SKILL.md",
          path: "SKILL.md",
          type: "file",
          size: new Blob([opts.skillContent]).size,
        },
      ];
    },
    async read(path: string): Promise<FolderFileContent> {
      if (path !== "SKILL.md") {
        throw new Error("File not found");
      }
      return {
        path: "SKILL.md",
        content: opts.skillContent,
        size: new Blob([opts.skillContent]).size,
        truncated: false,
        type: "text",
      };
    },
  };
}

/** Editable adapter for Mongo-backed skills (custom + built-in). */
export function makeConfigFolderAdapter(opts: {
  configId: string;
  label: string;
  editable: boolean;
}): FolderAdapter {
  const base = `/api/skills/configs/${encodeURIComponent(opts.configId)}/files`;
  return {
    label: opts.label,
    editable: opts.editable,
    async list(path: string): Promise<FolderEntry[]> {
      const url = path ? `${base}?path=${encodeURIComponent(path)}` : base;
      const data = await jsonOrThrow<ListResp>(
        await fetch(url, { credentials: "include" }),
      );
      return data.entries;
    },
    async read(path: string): Promise<FolderFileContent> {
      const url = `${base}?file=${encodeURIComponent(path)}`;
      return await jsonOrThrow<FolderFileContent>(
        await fetch(url, { credentials: "include" }),
      );
    },
    async write(path: string, content: string): Promise<void> {
      await jsonOrThrow<unknown>(
        await fetch(base, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ path, content }),
        }),
      );
    },
    async remove(path: string): Promise<void> {
      await jsonOrThrow<unknown>(
        await fetch(`${base}?path=${encodeURIComponent(path)}`, {
          method: "DELETE",
          credentials: "include",
        }),
      );
    },
  };
}
