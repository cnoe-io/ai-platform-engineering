"use client";

import { useState, type ReactNode } from "react";
import { FolderPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SearchablePicker } from "@/components/ui/searchable-picker";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import type { useChatHistoryOrganization } from "@/hooks/use-chat-history-organization";

type Organization = ReturnType<typeof useChatHistoryOrganization>;
export type OrganizationDialog = { kind: "create" } | { kind: "rename"; id: string; name: string }
  | { kind: "move"; id: string; title: string };

export function ChatHistoryOrganizationControls({ state, dialog, onDialog, children, allowFolders = true }: {
  state: Organization; dialog: OrganizationDialog | null; onDialog: (value: OrganizationDialog | null) => void;
  children: ReactNode; allowFolders?: boolean;
}) {
  return <>
    <div className="flex items-center gap-1">
      <div className="min-w-0 flex-1">{children}</div>
      {allowFolders && <Button size="icon" variant="ghost" aria-label="New chat folder" title="New chat folder" className="h-8 w-8 shrink-0"
        disabled={!state.ready || state.saving || state.value.folders.length >= 100} onClick={() => onDialog({ kind: "create" })}>
        <FolderPlus className="h-4 w-4" />
      </Button>}
    </div>
    {state.error && <p role="alert" className="pt-1 text-xs text-destructive">{state.error} {!state.ready && <button type="button" className="underline" onClick={state.retry}>Retry</button>}</p>}
    <Dialog open={!!dialog} onOpenChange={open => { if (!open && !state.saving) onDialog(null); }}>
      {dialog && <OrganizationForm key={JSON.stringify(dialog)} state={state} dialog={dialog} close={() => onDialog(null)} />}
    </Dialog>
  </>;
}

function OrganizationForm({ state, dialog, close }: { state: Organization; dialog: OrganizationDialog; close: () => void }) {
  const [name, setName] = useState(dialog.kind === "rename" ? dialog.name : "");
  const [folder, setFolder] = useState(dialog.kind === "move" ? state.value.assignments[dialog.id] ?? "" : "");
  const options = [{ id: "", name: "Unfiled" }, ...state.value.folders];
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const saved = await state.update(v => {
      if (dialog.kind === "move") {
        const assignments = { ...v.assignments }; if (folder) assignments[dialog.id] = folder; else delete assignments[dialog.id];
        return { ...v, assignments };
      }
      return { ...v, view: "folders", folders: dialog.kind === "create" ? [...v.folders, { id: crypto.randomUUID(), name }]
        : v.folders.map(f => f.id === dialog.id ? { ...f, name } : f) };
    });
    if (saved) close();
  };
  return <DialogContent>
    <DialogHeader><DialogTitle>{dialog.kind === "move" ? "Move chat to folder" : dialog.kind === "rename" ? "Rename folder" : "New chat folder"}</DialogTitle>
      <DialogDescription>{dialog.kind === "move" ? dialog.title : "Folders organize your history and are visible only to you."}</DialogDescription></DialogHeader>
    <form onSubmit={e => void submit(e)} className="space-y-4">
      {dialog.kind === "move" ? <SearchablePicker options={options} selected={options.find(o => o.id === folder)}
        onSelect={o => setFolder(o.id)} getOptionKey={o => o.id || "unfiled"} getOptionLabel={o => o.name}
        ariaLabel="Destination folder" placeholder="Choose a folder" searchPlaceholder="Find a folder…" emptyLabel="No folders match" required disabled={state.saving} />
        : <label className="block text-sm">Folder name<input autoFocus required maxLength={80} value={name} disabled={state.saving}
          onChange={e => setName(e.target.value)} className="mt-2 h-10 w-full rounded-md border bg-background px-3" /></label>}
      {state.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
      <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={state.saving} onClick={close}>Cancel</Button>
        <Button type="submit" disabled={state.saving || (dialog.kind !== "move" && !name.trim())}>{state.saving ? "Saving…" : "Save"}</Button></div>
    </form>
  </DialogContent>;
}
