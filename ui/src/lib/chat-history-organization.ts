/** Personal presentation preferences; never confer access to a conversation. */
export interface ChatHistoryOrganization {
  view: "ungrouped" | "agents" | "folders";
  folders: Array<{ id: string; name: string }>;
  assignments: Record<string, string>;
  collapsed: string[];
}
export const EMPTY_CHAT_ORGANIZATION: ChatHistoryOrganization = {
  view: "ungrouped", folders: [], assignments: {}, collapsed: [],
};

export function parseChatHistoryOrganization(input: unknown): ChatHistoryOrganization {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid chat organization");
  const v = input as ChatHistoryOrganization;
  if (!["ungrouped", "agents", "folders"].includes(v.view) || !Array.isArray(v.folders) || v.folders.length > 100 ||
      !Array.isArray(v.collapsed) || v.collapsed.length > 1000 || !v.assignments ||
      typeof v.assignments !== "object" || Array.isArray(v.assignments) || Object.keys(v.assignments).length > 10000) {
    throw new Error("Chat organization exceeds supported limits");
  }
  const ids = new Set<string>();
  const names = new Set<string>();
  const folders = v.folders.map(f => {
    if (!f || typeof f.id !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(f.id) || ids.has(f.id) ||
        typeof f.name !== "string" || !f.name.trim() || f.name.trim().length > 80 || names.has(f.name.trim().toLowerCase())) {
      throw new Error("Use unique folder names of 1–80 characters");
    }
    ids.add(f.id); names.add(f.name.trim().toLowerCase());
    return { id: f.id, name: f.name.trim() };
  });
  const assignments = Object.fromEntries(Object.entries(v.assignments).map(([id, folder]) => {
    if (!/^[a-zA-Z0-9_-]{1,200}$/.test(id) || ["__proto__", "constructor", "prototype"].includes(id) || !ids.has(folder)) {
      throw new Error("Invalid chat folder assignment");
    }
    return [id, folder];
  }));
  if (v.collapsed.some(k => typeof k !== "string" || !/^[a-zA-Z0-9:_-]{1,240}$/.test(k))) throw new Error("Invalid collapsed group");
  return { view: v.view, folders, assignments, collapsed: [...new Set(v.collapsed)] };
}
