"use client";

import React from "react";

interface AuditEvent {
  action: string;
  result: string;
  resource?: { id?: string };
}

async function parseApiResponse<T>(response: Response): Promise<T> {
  const json = (await response.json()) as { data: T };
  return json.data;
}

export function CredentialAuditPanel({
  endpoint = "/api/credentials/audit",
}: {
  endpoint?: string;
}) {
  const [events, setEvents] = React.useState<AuditEvent[]>([]);

  React.useEffect(() => {
    async function load() {
      const response = await fetch(endpoint);
      if (response.ok) {
        setEvents(await parseApiResponse<AuditEvent[]>(response));
      }
    }
    void load();
  }, [endpoint]);

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Credential Audit</h2>
        <p className="text-sm text-muted-foreground">
          Recent credential actions. Sensitive values are redacted before storage.
        </p>
      </div>
      <div className="rounded-lg border border-border bg-card">
        {events.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">No credential audit events yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {events.map((event, index) => (
              <li key={`${event.action}-${index}`} className="flex items-center justify-between p-4">
                <span className="font-medium">{event.action}</span>
                <span className="text-xs text-muted-foreground">{event.resource?.id}</span>
                <span className="rounded bg-muted px-2 py-1 text-xs">{event.result}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
