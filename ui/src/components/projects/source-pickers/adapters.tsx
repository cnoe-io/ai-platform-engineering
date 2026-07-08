"use client";

import { decodeWebexRoom, encodeWebexRoom } from "@/lib/projects/webex-room";
import type { SourceAdapter } from "./SourceItemPicker";
import type { SourceKind } from "./index";

const stripGh = (v: string) => v.replace(/^https?:\/\/github\.com\//i, "");

/**
 * One declarative adapter per source connector. The shared `SourceItemPicker`
 * renders the chrome (status, search, selected-first list, manual add, footer);
 * these supply only what differs between connectors.
 */
const github: SourceAdapter = {
  provider: "github",
  title: "GitHub repos",
  subtitle: "Scopes the project's read-only agent access",
  chipClass: "bg-foreground text-background",
  multi: true,
  nounOne: "repo",
  nounMany: "repos",
  connectedPreposition: "as",
  showMatchCount: false,
  searchPlaceholder: "Search your repos (or type org/name)…",
  emptyNone: "No repos to show. Paste one below.",
  notConnectedHowTo: (link) => (
    <>GitHub not connected — link it in {link} to browse your repos, or paste one below.</>
  ),
  notConnectedBare: "Type an org/name or paste a repo URL below.",
  selectedKeyOf: (v) => v,
  labelOf: stripGh,
  encodeOnAdd: (o) => o.value,
  manualAdd: {
    hint: "Know the repo? Paste it directly.",
    placeholder: "org/name or repo URL",
    button: "Add",
    withIcon: true,
  },
  footer: (sel) => <p className="text-xs text-muted-foreground">{sel.length} selected</p>,
};

const confluence: SourceAdapter = {
  provider: "atlassian",
  title: "Confluence space",
  subtitle: "Single space, used as project context",
  chipClass: "bg-[#2684FF]/10",
  multi: false,
  nounOne: "space",
  nounMany: "spaces",
  connectedPreposition: "to",
  showMatchCount: true,
  searchPlaceholder: "Search spaces by name or key…",
  emptyNone: "No spaces to show. Paste a URL below.",
  emptyNoMatch: "No spaces match. Paste a URL below.",
  notConnectedHowTo: (link) => (
    <>Confluence not connected — link Atlassian in {link}, or paste a space URL below.</>
  ),
  notConnectedBare: "Paste a Confluence space URL below.",
  slowLoadHint: "Confluence can take a few seconds to list your spaces — still working…",
  selectedKeyOf: (v) => v,
  labelOf: (v) => v,
  encodeOnAdd: (o) => o.value,
  manualAdd: {
    hint: "Know the space? Paste its URL directly.",
    placeholder: "https://your.atlassian.net/wiki/spaces/PROJ",
    button: "Use",
  },
  footer: (sel) =>
    sel[0] ? (
      <p className="truncate text-xs text-muted-foreground">
        Selected: <span className="font-medium text-foreground">{sel[0]}</span>
      </p>
    ) : null,
};

const webex: SourceAdapter = {
  provider: "webex",
  title: "Webex",
  subtitle: "Rooms the agent can read for context",
  chipClass: "bg-[#616BFA]/10",
  multi: true,
  nounOne: "room",
  nounMany: "rooms",
  connectedPreposition: "as",
  showMatchCount: true,
  searchPlaceholder: "Search rooms…",
  emptyNone: "No rooms to show.",
  emptyNoMatch: "No rooms match.",
  notConnectedHowTo: (link) => <>Webex not connected — link Webex in {link}.</>,
  notConnectedBare: "Webex not connected.",
  // `selected` carries encoded {room_id, name} blobs; match options by room_id
  // so checkmarks survive name drift.
  selectedKeyOf: (v) => decodeWebexRoom(v).room_id,
  labelOf: (v) => decodeWebexRoom(v).name,
  encodeOnAdd: (o) => encodeWebexRoom(o.value, o.label),
  footer: (sel) =>
    sel.length > 0 ? (
      <p className="text-xs text-muted-foreground">
        {sel.length} room{sel.length === 1 ? "" : "s"} selected
      </p>
    ) : null,
};

export const SOURCE_ADAPTERS: Record<SourceKind, SourceAdapter> = {
  github,
  confluence,
  webex,
};
