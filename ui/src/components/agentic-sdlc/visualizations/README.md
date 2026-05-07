# Ship Loop Visualizations

Visualization modes for an Epic-level ship loop view.

- **Pipeline** — horizontal CSS Grid stage cells (MVP, simplest)
- **Kanban** — columns by stage with sortable cards
- **Timeline** — SVG horizontal axis with event markers
- **DependencyGraph** — `@xyflow/react` graph of Epic → sub-tasks → PRs → deploys
- **ShipLoopRadar** — four-quadrant SVG (Specify / Execute / Verify / Deliver+Observe)

A separate **Heatmap** mode lives at portfolio scope (rendered inside `PortfolioDashboard`).

See `EpicView.tsx` for the picker and switching behavior.
