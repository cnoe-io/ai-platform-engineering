export const EXAMPLE_SPEAKERS_COLLECTIVE_CONFIG = {
  title: "Speakers Collective",
  eyebrow: "Community program · speaking opportunities",
  description:
    "Example CFP and speaking opportunities. Configure a reviewed event source for operational use.",
  sourceLabel: "Deterministic sample data",
  lastScan: "2026-01-12",
  teams: ["Platform", "Research", "Open Source"],
  events: [
    {
      name: "Example Platform Conference",
      organization: "Example Foundation",
      teams: ["Platform", "Open Source"],
      topic: "Platform engineering, automation, and open source",
      start: "2026-11-10",
      end: "2026-11-12",
      location: "Example City",
      deadline: "2026-10-01",
      rolling: false,
      link: "https://example.org/events/platform-conference/cfp",
      notes: "Sample opportunity for validating the dashboard experience.",
      publication: { status: "Published", since: "2026-01-12" },
      isNew: true,
      priority: true,
    },
    {
      name: "Example Research Workshop",
      organization: "Example University",
      teams: ["Research"],
      topic: "Distributed systems and applied AI research",
      start: "2027-02-08",
      end: "2027-02-08",
      location: "Online",
      deadline: "2026-11-15",
      rolling: false,
      link: "https://example.org/events/research-workshop/cfp",
      notes: "Sample workshop submission window.",
      publication: { status: "Published", since: "2026-01-12" },
      isNew: false,
      priority: false,
    },
    {
      name: "Example Open Source Summit",
      organization: "Example Community",
      teams: ["Open Source"],
      topic: "Open source governance and contributor experience",
      start: "2027-05-18",
      end: "2027-05-20",
      location: "Example Region",
      deadline: "",
      rolling: false,
      link: "https://example.org/events/open-source-summit",
      notes: "The CFP has not opened; this entry remains on the watchlist.",
      publication: { status: "Watching", since: "2026-01-12" },
      isNew: false,
      priority: false,
    },
  ],
};

const VALID_PUBLICATION_STATUSES = new Set(["Published", "Held", "Watching"]);

export function normalizeSpeakersCollectiveConfig(value, { fixture = false } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Speakers Collective data must be a JSON object");
  }

  const events = Array.isArray(value.events)
    ? value.events.map((event, index) => normalizeEvent(event, index))
    : [];
  if (events.length === 0) {
    throw new TypeError("Speakers Collective data must contain at least one event");
  }

  const configuredTeams = normalizeStringArray(value.teams, 24, 80);
  const derivedTeams = [...new Set(events.flatMap((event) => event.teams))];

  return {
    title: normalizeText(value.title, "Speakers Collective", 120),
    eyebrow: normalizeText(value.eyebrow, "Speaking opportunities", 160),
    description: normalizeText(
      value.description,
      "Discover and prioritize conference CFP and speaking opportunities.",
      800,
    ),
    sourceLabel: normalizeText(value.sourceLabel, fixture ? "Sample data" : "Reviewed event source", 160),
    lastScan: normalizeDate(value.lastScan),
    communityUrl: normalizeUrl(value.communityUrl, { allowWebex: true }),
    submissionUrl: normalizeUrl(value.submissionUrl),
    teams: configuredTeams.length > 0 ? configuredTeams : derivedTeams,
    fixture: Boolean(fixture || value.fixture),
    events,
  };
}

export function resolveEventState(event, now = new Date()) {
  const deadlineDays = daysBetween(now, event.deadline);
  const endDays = daysBetween(now, event.end);
  const closed = deadlineDays !== null ? deadlineDays < 0 : endDays !== null && endDays < 0;
  const reference = event.deadline || event.end;
  const closedDaysAgo = closed && reference ? Math.max(0, -daysBetween(now, reference)) : null;
  let urgency = "open";
  if (closed) urgency = "closed";
  else if (event.rolling && !event.deadline) urgency = "rolling";
  else if (deadlineDays !== null && deadlineDays <= 7) urgency = "critical";
  else if (deadlineDays !== null && deadlineDays <= 21) urgency = "soon";
  return { closed, closedDaysAgo, deadlineDays, urgency };
}

function normalizeEvent(value, index) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`Event ${index + 1} must be an object`);
  }
  const name = normalizeText(value.name, "", 180);
  if (!name) throw new TypeError(`Event ${index + 1} must have a name`);
  const publicationValue = value.publication ?? value.pub;
  const status = normalizeText(publicationValue?.status, "Published", 40);
  return {
    name,
    organization: normalizeText(value.organization ?? value.org, "", 180),
    teams: normalizeStringArray(value.teams, 16, 80),
    topic: normalizeText(value.topic, "", 500),
    start: normalizeDate(value.start),
    end: normalizeDate(value.end),
    location: normalizeText(value.location, "", 180),
    deadline: normalizeDate(value.deadline),
    rolling: Boolean(value.rolling),
    link: normalizeUrl(value.link),
    notes: normalizeText(value.notes, "", 1600),
    publication: {
      status: VALID_PUBLICATION_STATUSES.has(status) ? status : "Published",
      since: normalizeDate(publicationValue?.since),
    },
    isNew: Boolean(value.isNew),
    routeExecutive: Boolean(value.routeExecutive ?? value.routeExec),
    priority: Boolean(value.priority ?? value.pinned),
    teamsOverride: Boolean(value.teamsOverride),
  };
}

function normalizeText(value, fallback, maxLength) {
  const text = typeof value === "string" ? value.trim() : "";
  return (text || fallback).slice(0, maxLength);
}

function normalizeStringArray(value, maxItems, maxLength) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((item) => typeof item === "string")
    .map((item) => item.trim().slice(0, maxLength))
    .filter(Boolean))].slice(0, maxItems);
}

function normalizeDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? "" : value;
}

function normalizeUrl(value, { allowWebex = false } = {}) {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol === "https:" || (allowWebex && parsed.protocol === "webexteams:")) {
      return parsed.toString();
    }
  } catch {
    // Invalid source URLs are omitted rather than surfaced as executable links.
  }
  return "";
}

function daysBetween(now, value) {
  if (!value) return null;
  const target = new Date(`${value}T00:00:00`);
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target.getTime() - start.getTime()) / 86400000);
}
