"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  RAG_INGESTOR_LIMIT_BOUNDS as BOUNDS,
  type RagIngestorLimits,
} from "@/lib/rag-ingestor-limits";

interface RagIngestorLimitsEditorProps {
  value: RagIngestorLimits;
  onChange: (value: RagIngestorLimits) => void;
  disabled?: boolean;
}

type SectionName = keyof RagIngestorLimits;

interface NumericSetting {
  section: SectionName;
  field: string;
  label: string;
  help: string;
  minimum: number;
  maximum: number;
  step?: number;
}

interface ToggleSetting {
  section: SectionName;
  field: string;
  label: string;
  help: string;
}

const NUMERIC_GROUPS: Array<{
  title: string;
  description: string;
  settings: NumericSetting[];
}> = [
  {
    title: "Shared",
    description: "Applies to every self-service connector.",
    settings: [
      { section: "shared", field: "max_chunk_size", label: "Maximum chunk size", help: "Characters per chunk.", ...BOUNDS.shared.max_chunk_size! },
      { section: "shared", field: "max_chunk_overlap", label: "Maximum chunk overlap", help: "Must remain smaller than maximum chunk size.", ...BOUNDS.shared.max_chunk_overlap! },
      { section: "shared", field: "min_reload_interval_seconds", label: "Minimum reload interval", help: "Seconds between scheduled refreshes.", ...BOUNDS.shared.min_reload_interval_seconds! },
      { section: "shared", field: "max_reload_interval_seconds", label: "Maximum reload interval", help: "Seconds between scheduled refreshes.", ...BOUNDS.shared.max_reload_interval_seconds! },
      { section: "shared", field: "max_search_teams", label: "Maximum Search Access teams", help: "Use 0 to prevent adding team search grants to new or edited sources. Existing grants are not revoked.", ...BOUNDS.shared.max_search_teams! },
    ],
  },
  {
    title: "File",
    description: "The deployment hard ceilings are 1,000 files, 10 MiB per file, and 25 MiB total.",
    settings: [
      { section: "file", field: "max_files_per_upload", label: "Files per upload", help: "Maximum files in one ingestion.", ...BOUNDS.file.max_files_per_upload! },
      { section: "file", field: "max_file_size_mb", label: "Per-file size (MiB)", help: "Maximum size of one uploaded file.", ...BOUNDS.file.max_file_size_mb! },
      { section: "file", field: "max_total_upload_size_mb", label: "Total upload size (MiB)", help: "Maximum combined size of an upload.", ...BOUNDS.file.max_total_upload_size_mb! },
    ],
  },
  {
    title: "Slack",
    description: "Bounds the first synchronization of a channel.",
    settings: [
      { section: "slack", field: "max_lookback_days", label: "Maximum lookback days", help: "The normal source default remains 30 days.", ...BOUNDS.slack.max_lookback_days! },
    ],
  },
  {
    title: "Confluence",
    description: "Controls page-tree expansion and title filters.",
    settings: [
      { section: "confluence", field: "max_title_patterns", label: "Patterns per title filter", help: "Maximum entries in each allow or deny list.", ...BOUNDS.confluence.max_title_patterns! },
    ],
  },
  {
    title: "Jira",
    description: "Bounds query and issue-expansion configuration.",
    settings: [
      { section: "jira", field: "max_jql_length", label: "Maximum JQL length", help: "Characters in a source JQL query.", ...BOUNDS.jira.max_jql_length! },
      { section: "jira", field: "max_custom_fields", label: "Maximum custom fields", help: "Friendly-name to field-id mappings.", ...BOUNDS.jira.max_custom_fields! },
    ],
  },
  {
    title: "Web crawler",
    description: "Caps crawl breadth, load, filtering, and network behavior.",
    settings: [
      { section: "web", field: "max_depth", label: "Maximum crawl depth", help: "Recursive link depth.", ...BOUNDS.web.max_depth! },
      { section: "web", field: "max_pages", label: "Maximum pages", help: "Pages discovered and fetched per crawl.", ...BOUNDS.web.max_pages! },
      { section: "web", field: "max_page_load_timeout_seconds", label: "Maximum page timeout", help: "Seconds allowed for one page load.", ...BOUNDS.web.max_page_load_timeout_seconds! },
      { section: "web", field: "min_download_delay_seconds", label: "Minimum download delay", help: "Minimum seconds between requests.", ...BOUNDS.web.min_download_delay_seconds!, step: 0.01 },
      { section: "web", field: "max_download_delay_seconds", label: "Maximum download delay", help: "Maximum seconds between requests.", ...BOUNDS.web.max_download_delay_seconds!, step: 0.01 },
      { section: "web", field: "max_concurrent_requests", label: "Maximum concurrency", help: "Concurrent crawler requests.", ...BOUNDS.web.max_concurrent_requests! },
      { section: "web", field: "max_url_patterns", label: "Patterns per URL filter", help: "Maximum entries in each allow or deny list.", ...BOUNDS.web.max_url_patterns! },
    ],
  },
];

const TOGGLE_GROUPS: Array<{
  title: string;
  settings: ToggleSetting[];
}> = [
  {
    title: "Slack",
    settings: [
      { section: "slack", field: "allow_full_history", label: "Allow full channel history", help: "Permits lookback_days=0. Disable this to prevent unbounded first imports." },
      { section: "slack", field: "allow_bot_messages", label: "Allow bot messages", help: "Users may include Slack bot messages in a source." },
    ],
  },
  {
    title: "Confluence",
    settings: [
      { section: "confluence", field: "allow_child_pages", label: "Allow child pages", help: "Users may recursively add children of the starting page." },
    ],
  },
  {
    title: "Jira",
    settings: [
      { section: "jira", field: "allow_comments", label: "Allow comments", help: "Users may include issue comments." },
      { section: "jira", field: "allow_issue_links", label: "Allow issue links", help: "Users may include linked-issue details." },
    ],
  },
  {
    title: "Web crawler",
    settings: [
      { section: "web", field: "allow_javascript", label: "Allow JavaScript rendering", help: "Permits Playwright-backed crawling for client-rendered pages." },
      { section: "web", field: "allow_external_links", label: "Allow external links", help: "Users may follow links outside the starting origin." },
      { section: "web", field: "allow_ignore_robots_txt", label: "Allow ignoring robots.txt", help: "Sources respect robots.txt by default. Disable this policy to make that mandatory." },
      { section: "web", field: "allow_custom_user_agent", label: "Allow custom user agents", help: "Users may override the crawler user-agent string." },
      { section: "web", field: "allow_non_public_urls", label: "Allow internal/private URLs", help: "Sources keep this off by default. Disable this policy to prohibit private-network targets entirely." },
    ],
  },
  {
    title: "Webex",
    settings: [
      { section: "webex", field: "allow_bot_messages", label: "Allow bot messages", help: "Users may include Webex bot messages in a source." },
    ],
  },
];

function sectionRecord(
  value: RagIngestorLimits,
  section: SectionName,
): Record<string, number | boolean> {
  return value[section] as unknown as Record<string, number | boolean>;
}

export function RagIngestorLimitsEditor({
  value,
  onChange,
  disabled = false,
}: RagIngestorLimitsEditorProps) {
  const update = (section: SectionName, field: string, next: number | boolean) => {
    onChange({
      ...value,
      [section]: {
        ...value[section],
        [field]: next,
      },
    } as RagIngestorLimits);
  };

  return (
    <div className="space-y-4">
      {NUMERIC_GROUPS.map((group, index) => (
        <details
          key={group.title}
          className="rounded-lg border border-border/60 p-4"
          open={index === 0}
        >
          <summary className="cursor-pointer text-sm font-semibold">
            {group.title}
          </summary>
          <p className="mt-2 text-xs text-muted-foreground">{group.description}</p>
          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {group.settings.map((setting) => {
              const id = `rag-limit-${setting.section}-${setting.field}`;
              return (
                <div key={id} className="space-y-1.5">
                  <Label htmlFor={id}>{setting.label}</Label>
                  <Input
                    id={id}
                    type="number"
                    min={setting.minimum}
                    max={setting.maximum}
                    step={setting.step ?? 1}
                    value={Number(sectionRecord(value, setting.section)[setting.field])}
                    disabled={disabled}
                    onChange={(event) =>
                      update(setting.section, setting.field, Number(event.target.value))
                    }
                  />
                  <p className="text-xs text-muted-foreground">{setting.help}</p>
                </div>
              );
            })}
          </div>
        </details>
      ))}

      <details className="rounded-lg border border-border/60 p-4">
        <summary className="cursor-pointer text-sm font-semibold">
          Allowed connector features
        </summary>
        <p className="mt-2 text-xs text-muted-foreground">
          Disabled features are rejected by create, edit, preview, and reload APIs.
        </p>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {TOGGLE_GROUPS.map((group) => (
            <div key={group.title} className="space-y-3 rounded-md bg-muted/20 p-3">
              <p className="text-sm font-medium">{group.title}</p>
              {group.settings.map((setting) => {
                const id = `rag-limit-${setting.section}-${setting.field}`;
                return (
                  <label key={id} htmlFor={id} className="flex items-start gap-3">
                    <input
                      id={id}
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 rounded border-border accent-primary"
                      checked={Boolean(sectionRecord(value, setting.section)[setting.field])}
                      disabled={disabled}
                      onChange={(event) =>
                        update(setting.section, setting.field, event.target.checked)
                      }
                    />
                    <span>
                      <span className="block text-sm font-medium">{setting.label}</span>
                      <span className="block text-xs text-muted-foreground">
                        {setting.help}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

export default RagIngestorLimitsEditor;
