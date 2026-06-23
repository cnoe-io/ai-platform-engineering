# Agentic App UI Kit

Small React components for external apps that want CAIPE-compatible visual language without importing private host components.

## Components

- `AppButton`
- `AppBadge`
- `PageHeader`
- `MetricCard`
- `EmptyState`
- `AppTabs`
- `Toolbar`
- `AssistantTrigger`

## Example

```tsx
import { AssistantTrigger, MetricCard, PageHeader } from "@caipe/agentic-app-ui";

export function Dashboard() {
  return (
    <main>
      <PageHeader title="Weather" description="Forecast insights" />
      <MetricCard label="Temperature" value="72F" />
      <AssistantTrigger hasContext />
    </main>
  );
}
```

The UI kit has no dependency on CAIPE host stores, sessions, routes, or source aliases. Apps own their state and call the SDK for host bridge features.
