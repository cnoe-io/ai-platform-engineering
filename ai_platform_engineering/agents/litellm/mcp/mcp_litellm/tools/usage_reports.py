"""Curated reporting tools for LiteLLM usage analytics."""

import csv
import logging
import re
from calendar import monthrange
from datetime import date, datetime, timedelta
from html import escape
from io import StringIO
from typing import Any

from mcp_litellm.api.client import make_api_request

logger = logging.getLogger("mcp_tools")

MAX_CUSTOM_RANGE_MONTHS = 2
BUSINESS_QUARTER_MONTHS = 3
FISCAL_YEAR_START_MONTH = 8
DEFAULT_LIMIT = 20
MAX_LIMIT = 200
CHART_LIMIT = 10
TABLE_LIMIT = 25
TEXT_BAR_WIDTH = 28
TEXT_BAR_CHAR = "█"
REPORT_FORMATS = {"markdown", "html", "csv", "both", "all"}
METRIC_KEYS = (
  "requests",
  "successful_requests",
  "failed_requests",
  "prompt_tokens",
  "completion_tokens",
  "cache_read_input_tokens",
  "cache_creation_input_tokens",
  "total_tokens",
  "spend",
)

BUSINESS_QUARTERS = {
  "feb_apr": (2, "Feb-Apr"),
  "february_april": (2, "Feb-Apr"),
  "may_jul": (5, "May-Jul"),
  "may_july": (5, "May-Jul"),
  "aug_oct": (8, "Aug-Oct"),
  "august_october": (8, "Aug-Oct"),
  "nov_jan": (11, "Nov-Jan"),
  "november_january": (11, "Nov-Jan"),
}

FISCAL_QUARTERS = {
  1: (8, -1, "Aug-Oct"),
  2: (11, -1, "Nov-Jan"),
  3: (2, 0, "Feb-Apr"),
  4: (5, 0, "May-Jul"),
}


def _format_metric(value: Any, metric: str) -> str:
  """Format metric values for report output."""
  if metric == "spend":
    return f"${_to_float(value):,.2f}"
  return f"{_to_int(value):,}"


def _truncate_text(value: Any, max_length: int = 42) -> str:
  """Return a compact single-line label."""
  text = str(value or "unknown").replace("\n", " ").strip()
  if len(text) <= max_length:
    return text
  return f"{text[: max_length - 3]}..."


def _to_float(value: Any) -> float:
  """Parse numeric API values defensively."""
  if value is None:
    return 0.0
  try:
    return float(value)
  except (TypeError, ValueError):
    return 0.0


def _to_int(value: Any) -> int:
  """Parse integer-like API values defensively."""
  return int(_to_float(value))


def _first_present(row: dict[str, Any], keys: tuple[str, ...]) -> Any:
  """Return the first non-empty value for any key."""
  for key in keys:
    value = row.get(key)
    if value not in (None, ""):
      return value
  return None


def _empty_metrics() -> dict[str, Any]:
  """Return a fresh usage metric accumulator."""
  return {
    "requests": 0,
    "successful_requests": 0,
    "failed_requests": 0,
    "prompt_tokens": 0,
    "completion_tokens": 0,
    "cache_read_input_tokens": 0,
    "cache_creation_input_tokens": 0,
    "total_tokens": 0,
    "spend": 0.0,
  }


def _metrics_from(source: dict[str, Any] | None) -> dict[str, Any]:
  """Normalize LiteLLM metric shapes into one compact output shape."""
  source = source or {}
  return {
    "requests": _to_int(_first_present(source, ("api_requests", "requests", "total_requests"))),
    "successful_requests": _to_int(
      _first_present(source, ("successful_requests", "total_successful_requests"))
    ),
    "failed_requests": _to_int(_first_present(source, ("failed_requests", "total_failed_requests"))),
    "prompt_tokens": _to_int(_first_present(source, ("prompt_tokens", "total_prompt_tokens"))),
    "completion_tokens": _to_int(
      _first_present(source, ("completion_tokens", "total_completion_tokens"))
    ),
    "cache_read_input_tokens": _to_int(
      _first_present(source, ("cache_read_input_tokens", "total_cache_read_input_tokens"))
    ),
    "cache_creation_input_tokens": _to_int(
      _first_present(source, ("cache_creation_input_tokens", "total_cache_creation_input_tokens"))
    ),
    "total_tokens": _to_int(_first_present(source, ("total_tokens", "tokens"))),
    "spend": _to_float(_first_present(source, ("spend", "total_spend", "cost"))),
  }


def _add_metrics(target: dict[str, Any], metrics: dict[str, Any]) -> None:
  """Add metric values into an accumulator."""
  for key in METRIC_KEYS:
    target[key] += metrics.get(key, 0)


def _safe_limit(limit: int | None, default: int = DEFAULT_LIMIT) -> int:
  """Clamp result limits so tool responses stay chat-friendly."""
  try:
    parsed_limit = int(limit or default)
  except (TypeError, ValueError):
    parsed_limit = default
  return max(1, min(parsed_limit, MAX_LIMIT))


def _report_slug(report: dict[str, Any]) -> str:
  """Build a stable report filename stem."""
  report_type = str(report.get("report_type") or "usage-report").replace("_", "-")
  start = str(report.get("start_date") or "start")
  end = str(report.get("end_date") or "end")
  return f"litellm-{report_type}-{start}_to_{end}"


def _safe_report_format(report_format: str | None) -> str:
  """Normalize downloadable report format selection."""
  value = str(report_format or "all").strip().lower()
  aliases = {
    "all": "all",
    "default": "all",
    "md": "markdown",
    "markdown": "markdown",
    "html": "html",
    "csv": "csv",
    "both": "all",
  }
  normalized = aliases.get(value, value)
  return normalized if normalized in REPORT_FORMATS else "all"


def _preferred_report_file(downloadable_reports: list[dict[str, str]]) -> dict[str, str] | None:
  """Prefer the HTML graph report for Grid Files downloads."""
  for report in downloadable_reports:
    if report.get("mime_type") == "text/html":
      return report
  return downloadable_reports[0] if downloadable_reports else None


def _chart_data(
  title: str,
  rows: list[dict[str, Any]],
  label_key: str,
  metric: str,
  limit: int = CHART_LIMIT,
) -> dict[str, Any]:
  """Build chart-ready bar data from report rows."""
  data = []
  sorted_rows = sorted(rows, key=lambda row: _to_float(row.get(metric)), reverse=True)
  for row in sorted_rows[:limit]:
    label = row.get(label_key) or row.get("display_name") or row.get("user_id") or row.get("model")
    value = _to_float(row.get(metric))
    data.append(
      {
        "label": _truncate_text(label),
        "value": value,
        "formatted_value": _format_metric(value, metric),
      }
    )

  return {
    "type": "bar",
    "title": title,
    "metric": metric,
    "data": data,
  }


def _text_bar_chart(chart: dict[str, Any]) -> str:
  """Render a small ASCII bar chart suitable for chat answers."""
  rows = chart.get("data") or []
  title = str(chart.get("title") or "Chart")
  if not rows:
    return f"{title}\n(no data)"

  max_value = max(_to_float(row.get("value")) for row in rows) or 1.0
  label_width = min(
    32,
    max(12, max(len(str(row.get("label") or "")) for row in rows)),
  )
  lines = [title]
  for row in rows:
    value = _to_float(row.get("value"))
    bar_size = max(1, round((value / max_value) * TEXT_BAR_WIDTH)) if value > 0 else 0
    label = _truncate_text(row.get("label"), label_width).ljust(label_width)
    bar = TEXT_BAR_CHAR * bar_size
    lines.append(f"{label} {bar:<{TEXT_BAR_WIDTH}} {row.get('formatted_value')}")
  return "\n".join(lines)


def _markdown_table(
  title: str,
  rows: list[dict[str, Any]],
  columns: list[tuple[str, str]],
  limit: int = TABLE_LIMIT,
) -> str:
  """Build a compact markdown table."""
  lines = [f"### {title}", ""]
  if not rows:
    lines.append("_No data._")
    return "\n".join(lines)

  headers = [header for _, header in columns]
  lines.append("| " + " | ".join(headers) + " |")
  lines.append("| " + " | ".join("---" for _ in headers) + " |")
  for row in rows[:limit]:
    values = []
    for key, _ in columns:
      value = row.get(key)
      if key in METRIC_KEYS:
        values.append(_format_metric(value, key))
      else:
        values.append(_truncate_text(value, 48))
    lines.append("| " + " | ".join(str(value).replace("|", "\\|") for value in values) + " |")
  return "\n".join(lines)


def _csv_value(value: Any, key: str) -> str | int:
  """Return a spreadsheet-friendly CSV value."""
  if key == "spend":
    formatted = f"{_to_float(value):.6f}".rstrip("0").rstrip(".")
    return formatted or "0"
  if key in METRIC_KEYS:
    return _to_int(value)
  return str(value or "").replace("\n", " ").strip()


def _build_csv_report(
  title: str,
  report: dict[str, Any],
  tables: list[dict[str, Any]],
) -> str:
  """Build a downloadable CSV report from the tabular report data."""
  totals = report.get("totals") or {}
  output = StringIO()
  writer = csv.writer(output, lineterminator="\n")

  writer.writerow(["LiteLLM report", title])
  writer.writerow(["period", _report_period(report)])
  writer.writerow(["source", report.get("source") or "LiteLLM"])
  writer.writerow(["complete", "yes" if report.get("is_complete") else "no"])
  writer.writerow([])

  writer.writerow(["Totals"])
  writer.writerow(["metric", "value"])
  for key, label in (
    ("spend", "Spend"),
    ("total_tokens", "Total Tokens"),
    ("prompt_tokens", "Prompt Tokens"),
    ("completion_tokens", "Completion Tokens"),
    ("requests", "Requests"),
  ):
    writer.writerow([label, _csv_value(totals.get(key), key)])

  for table in tables:
    rows = table.get("rows") or []
    columns = table.get("columns") or []
    writer.writerow([])
    writer.writerow([table.get("title") or "Table"])
    writer.writerow([header for _, header in columns])
    if not rows:
      writer.writerow(["No data"])
      continue
    for row in rows:
      writer.writerow([_csv_value(row.get(key), key) for key, _ in columns])

  warnings = report.get("warnings") or []
  if warnings:
    writer.writerow([])
    writer.writerow(["Warnings"])
    for warning in warnings:
      writer.writerow([warning])

  return output.getvalue()


def _html_table(
  title: str,
  rows: list[dict[str, Any]],
  columns: list[tuple[str, str]],
  limit: int = TABLE_LIMIT,
) -> str:
  """Build an HTML table fragment."""
  if not rows:
    return (
      '<section class="section">'
      f'<h2 class="section-title">{escape(title)}</h2>'
      '<div class="table-container empty-state"><p>No data.</p></div>'
      "</section>"
    )

  head = "".join(f"<th>{escape(header)}</th>" for _, header in columns)
  body_rows = []
  for row in rows[:limit]:
    cells = []
    for key, _ in columns:
      value = row.get(key)
      if key in METRIC_KEYS:
        value = _format_metric(value, key)
      else:
        value = _truncate_text(value, 80)
      cells.append(f"<td>{escape(str(value))}</td>")
    body_rows.append("<tr>" + "".join(cells) + "</tr>")
  return (
    '<section class="section">'
    f'<h2 class="section-title">{escape(title)}</h2>'
    '<div class="table-container">'
    f"<table><thead><tr>{head}</tr></thead><tbody>{''.join(body_rows)}</tbody></table>"
    "</div>"
    "</section>"
  )


def _html_charts(charts: list[dict[str, Any]]) -> str:
  """Build the visual chart section for downloadable HTML reports."""
  if not charts:
    return ""

  chart_cards = "".join(
    f'<div class="chart-container">{_svg_bar_chart(chart)}</div>' for chart in charts
  )
  return (
    '<section class="section">'
    '<h2 class="section-title">Visualizations</h2>'
    f'<div class="chart-row">{chart_cards}</div>'
    "</section>"
  )


def _html_report_notes(report: dict[str, Any]) -> str:
  """Build a short report notes panel."""
  notes = [
    f"Report period: {_report_period(report)}.",
    f"Data source: {report.get('source') or 'LiteLLM'}.",
    "Charts and tables are generated from LiteLLM usage, token, and spend data.",
  ]
  warnings = report.get("warnings") or []
  notes.extend(f"Warning: {warning}" for warning in warnings)
  note_items = "".join(f"<li>{escape(str(note))}</li>" for note in notes)
  return (
    '<section class="insights">'
    "<h2>Report notes</h2>"
    f"<ul>{note_items}</ul>"
    "</section>"
  )


def _svg_bar_chart(chart: dict[str, Any]) -> str:
  """Build an inline SVG bar chart for downloadable HTML reports."""
  rows = chart.get("data") or []
  title = str(chart.get("title") or "Chart")
  width = 820
  left = 220
  right = 120
  top = 48
  row_height = 34
  bar_height = 18
  height = top + max(len(rows), 1) * row_height + 28
  chart_width = width - left - right
  max_value = max((_to_float(row.get("value")) for row in rows), default=0.0) or 1.0

  parts = [
    f'<svg viewBox="0 0 {width} {height}" role="img" aria-label="{escape(title)}">',
    f'<text x="0" y="24" class="chart-title">{escape(title)}</text>',
  ]
  if not rows:
    parts.append('<text x="0" y="60">No data.</text>')
  for index, row in enumerate(rows):
    y = top + index * row_height
    value = _to_float(row.get("value"))
    bar_width = (value / max_value) * chart_width if value > 0 else 0
    parts.extend(
      [
        f'<text x="0" y="{y + 14}" class="label">{escape(str(row.get("label") or ""))}</text>',
        f'<rect x="{left}" y="{y}" width="{chart_width}" height="{bar_height}" rx="4" class="bar-bg" />',
        f'<rect x="{left}" y="{y}" width="{bar_width:.1f}" height="{bar_height}" rx="4" class="bar" />',
        f'<text x="{left + chart_width + 12}" y="{y + 14}" class="value">{escape(str(row.get("formatted_value") or ""))}</text>',
      ]
    )
  parts.append("</svg>")
  return "".join(parts)


def _report_period(report: dict[str, Any]) -> str:
  """Return a human-readable report period."""
  period = report.get("period")
  range_type = report.get("range_type")
  label = f" ({period})" if period else ""
  return f"{report.get('start_date')} to {report.get('end_date')}{label} [{range_type}]"


def _build_markdown_report(
  title: str,
  report: dict[str, Any],
  charts: list[dict[str, Any]],
  tables: list[dict[str, Any]],
) -> str:
  """Build a downloadable markdown report with text charts and tables."""
  totals = report.get("totals") or {}
  lines = [
    f"# {title}",
    "",
    f"Period: {_report_period(report)}",
    f"Source: {report.get('source')}",
    f"Complete: {'yes' if report.get('is_complete') else 'no'}",
    "",
    "## Totals",
    "",
    f"- Spend: {_format_metric(totals.get('spend'), 'spend')}",
    f"- Total tokens: {_format_metric(totals.get('total_tokens'), 'total_tokens')}",
    f"- Prompt tokens: {_format_metric(totals.get('prompt_tokens'), 'prompt_tokens')}",
    f"- Completion tokens: {_format_metric(totals.get('completion_tokens'), 'completion_tokens')}",
    f"- Requests: {_format_metric(totals.get('requests'), 'requests')}",
    "",
    "## Charts",
    "",
  ]
  for chart in charts:
    lines.extend(["```text", _text_bar_chart(chart), "```", ""])
  for table in tables:
    lines.extend(
      [
        _markdown_table(
          table["title"],
          table["rows"],
          table["columns"],
        ),
        "",
      ]
    )
  warnings = report.get("warnings") or []
  if warnings:
    lines.extend(["## Warnings", ""])
    lines.extend(f"- {warning}" for warning in warnings)
    lines.append("")
  return "\n".join(lines).rstrip() + "\n"


def _build_html_report(
  title: str,
  report: dict[str, Any],
  charts: list[dict[str, Any]],
  tables: list[dict[str, Any]],
) -> str:
  """Build a downloadable HTML report with inline SVG charts."""
  totals = report.get("totals") or {}
  chart_html = _html_charts(charts)
  table_html = "".join(_html_table(table["title"], table["rows"], table["columns"]) for table in tables)
  notes_html = _html_report_notes(report)
  return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{escape(title)}</title>
  <style>
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      min-height: 100vh;
      padding: 24px;
      color: #111827;
      background:
        radial-gradient(circle at top left, rgba(20, 184, 166, 0.20), transparent 30%),
        linear-gradient(135deg, #eff6ff 0%, #f8fafc 48%, #ecfdf5 100%);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }}
    .container {{
      max-width: 1400px;
      margin: 0 auto;
      overflow: hidden;
      background: #ffffff;
      border: 1px solid #dbeafe;
      border-radius: 16px;
      box-shadow: 0 24px 70px rgba(15, 23, 42, 0.18);
    }}
    .header {{
      padding: 40px 48px;
      color: #ffffff;
      background: linear-gradient(135deg, #0f766e 0%, #2563eb 100%);
    }}
    .eyebrow {{
      margin-bottom: 10px;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      opacity: 0.88;
    }}
    h1 {{
      max-width: 920px;
      margin: 0;
      font-size: 34px;
      line-height: 1.16;
    }}
    .subtitle {{
      max-width: 920px;
      margin: 12px 0 0;
      color: rgba(255, 255, 255, 0.88);
      font-size: 16px;
      line-height: 1.5;
    }}
    .meta-pills {{
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 24px;
    }}
    .meta-pills span {{
      border: 1px solid rgba(255, 255, 255, 0.28);
      border-radius: 999px;
      padding: 8px 12px;
      background: rgba(255, 255, 255, 0.14);
      color: rgba(255, 255, 255, 0.94);
      font-size: 13px;
      font-weight: 600;
    }}
    .content {{ padding: 40px; }}
    .summary-grid {{
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
      gap: 20px;
      margin-bottom: 42px;
    }}
    .metric-card {{
      position: relative;
      min-height: 132px;
      padding: 24px;
      overflow: hidden;
      background: linear-gradient(135deg, #ffffff 0%, #f8fafc 100%);
      border: 1px solid #e5e7eb;
      border-left: 6px solid #2563eb;
      border-radius: 14px;
      box-shadow: 0 10px 30px rgba(15, 23, 42, 0.08);
    }}
    .metric-card.accent1 {{ border-left-color: #0f766e; }}
    .metric-card.accent2 {{ border-left-color: #2563eb; }}
    .metric-card.accent3 {{ border-left-color: #d97706; }}
    .metric-card.accent4 {{ border-left-color: #7c3aed; }}
    .metric-card.accent5 {{ border-left-color: #dc2626; }}
    .metric-label {{
      color: #64748b;
      font-size: 12px;
      font-weight: 800;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }}
    .metric-value {{
      margin-top: 10px;
      color: #0f172a;
      font-size: 28px;
      font-weight: 800;
      line-height: 1.15;
      word-break: break-word;
    }}
    .metric-hint {{
      margin-top: 10px;
      color: #64748b;
      font-size: 12px;
      line-height: 1.4;
    }}
    .section {{ margin-bottom: 46px; }}
    .section-title {{
      margin: 0 0 22px;
      padding-bottom: 14px;
      color: #0f172a;
      border-bottom: 3px solid #0f766e;
      font-size: 22px;
      font-weight: 800;
    }}
    .chart-row {{
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(420px, 1fr));
      gap: 24px;
    }}
    .chart-container {{
      min-width: 0;
      padding: 22px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 14px;
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.8);
    }}
    svg {{
      display: block;
      width: 100%;
      height: auto;
    }}
    .chart-title {{ font-size: 18px; font-weight: 800; fill: #0f172a; }}
    .label {{ font-size: 12px; fill: #334155; }}
    .value {{ font-size: 12px; fill: #0f172a; font-weight: 700; }}
    .bar-bg {{ fill: #e2e8f0; }}
    .bar {{ fill: #2563eb; }}
    .table-container {{
      overflow-x: auto;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 14px;
      padding: 18px;
    }}
    .empty-state {{ color: #64748b; }}
    table {{
      width: 100%;
      border-collapse: collapse;
      background: #ffffff;
      border-radius: 10px;
      overflow: hidden;
      font-size: 13px;
    }}
    th {{
      padding: 14px 15px;
      background: #0f766e;
      color: #ffffff;
      text-align: left;
      font-weight: 800;
      white-space: nowrap;
    }}
    td {{
      padding: 12px 15px;
      border-bottom: 1px solid #e5e7eb;
      color: #1f2937;
    }}
    tbody tr:hover {{ background: #f1f5f9; }}
    .insights {{
      margin-top: 8px;
      padding: 22px 24px;
      background: #eff6ff;
      border: 1px solid #bfdbfe;
      border-left: 5px solid #2563eb;
      border-radius: 14px;
    }}
    .insights h2 {{
      margin: 0 0 12px;
      color: #1e40af;
      font-size: 18px;
    }}
    .insights ul {{
      margin: 0;
      padding-left: 20px;
      color: #1e3a8a;
      line-height: 1.6;
    }}
    .footer {{
      padding: 18px 40px;
      color: #64748b;
      background: #f8fafc;
      border-top: 1px solid #e2e8f0;
      font-size: 12px;
      text-align: center;
    }}
    @media (max-width: 720px) {{
      body {{ padding: 12px; }}
      .header, .content {{ padding: 28px 22px; }}
      h1 {{ font-size: 28px; }}
      .chart-row {{ grid-template-columns: 1fr; }}
      .metric-value {{ font-size: 23px; }}
    }}
  </style>
</head>
<body>
  <main class="container">
    <header class="header">
      <div class="eyebrow">LiteLLM FinOps Report</div>
      <h1>{escape(title)}</h1>
      <p class="subtitle">Usage, spend, and token analytics generated by the Grid FinOps agent.</p>
      <div class="meta-pills">
        <span>Period: {escape(_report_period(report))}</span>
        <span>Source: {escape(str(report.get("source") or "LiteLLM"))}</span>
        <span>Complete: {"yes" if report.get("is_complete") else "no"}</span>
      </div>
    </header>
    <div class="content">
      <section class="summary-grid" aria-label="Summary metrics">
        <article class="metric-card accent1">
          <div class="metric-label">Total spend</div>
          <div class="metric-value">{escape(_format_metric(totals.get("spend"), "spend"))}</div>
          <div class="metric-hint">LiteLLM reported cost for this period</div>
        </article>
        <article class="metric-card accent2">
          <div class="metric-label">Total tokens</div>
          <div class="metric-value">{escape(_format_metric(totals.get("total_tokens"), "total_tokens"))}</div>
          <div class="metric-hint">Prompt and completion tokens combined</div>
        </article>
        <article class="metric-card accent3">
          <div class="metric-label">Prompt tokens</div>
          <div class="metric-value">{escape(_format_metric(totals.get("prompt_tokens"), "prompt_tokens"))}</div>
          <div class="metric-hint">Input tokens sent to models</div>
        </article>
        <article class="metric-card accent4">
          <div class="metric-label">Completion tokens</div>
          <div class="metric-value">{escape(_format_metric(totals.get("completion_tokens"), "completion_tokens"))}</div>
          <div class="metric-hint">Output tokens generated by models</div>
        </article>
        <article class="metric-card accent5">
          <div class="metric-label">Requests</div>
          <div class="metric-value">{escape(_format_metric(totals.get("requests"), "requests"))}</div>
          <div class="metric-hint">Total LiteLLM calls included in the report</div>
        </article>
      </section>
      {chart_html}
      {table_html}
      {notes_html}
    </div>
    <footer class="footer">Generated by Grid FinOps agent using the LiteLLM MCP server.</footer>
  </main>
</body>
</html>
"""


def _attach_visualizations(
  report: dict[str, Any],
  title: str,
  charts: list[dict[str, Any]],
  tables: list[dict[str, Any]],
  report_format: str | None = None,
) -> dict[str, Any]:
  """Attach chart-ready data and downloadable report templates to a report."""
  markdown_report = _build_markdown_report(title, report, charts, tables)
  html_report = _build_html_report(title, report, charts, tables)
  csv_report = _build_csv_report(title, report, tables)
  slug = _report_slug(report)
  safe_report_format = _safe_report_format(report_format)
  downloadable_reports = []
  if safe_report_format in {"markdown", "all"}:
    downloadable_reports.append(
      {
        "path": f"/reports/{slug}.md",
        "mime_type": "text/markdown",
        "content": markdown_report,
      }
    )
  if safe_report_format in {"html", "all"}:
    downloadable_reports.append(
      {
        "path": f"/reports/{slug}.html",
        "mime_type": "text/html",
        "content": html_report,
      }
    )
  if safe_report_format in {"csv", "all"}:
    downloadable_reports.append(
      {
        "path": f"/reports/{slug}.csv",
        "mime_type": "text/csv",
        "content": csv_report,
      }
    )
  report_paths = [item["path"] for item in downloadable_reports]
  preferred_report = _preferred_report_file(downloadable_reports)
  csv_report_file = next(
    (report for report in downloadable_reports if report.get("mime_type") == "text/csv"),
    None,
  )
  recommended_report_files = []
  for report_file in (preferred_report, csv_report_file):
    if report_file and report_file not in recommended_report_files:
      recommended_report_files.append(report_file)
  files_to_write = recommended_report_files or downloadable_reports
  file_write_paths = [item["path"] for item in files_to_write]
  return {
    **report,
    "recommended_report_file": (
      {
        "path": preferred_report["path"],
        "mime_type": preferred_report["mime_type"],
        "content": preferred_report["content"],
        "reason": "Default visual report with inline SVG graphs for the Grid Files section.",
      }
      if preferred_report
      else None
    ),
    "csv_report_file": (
      {
        "path": csv_report_file["path"],
        "mime_type": csv_report_file["mime_type"],
        "content": csv_report_file["content"],
        "reason": "Default CSV export for spreadsheet analysis.",
      }
      if csv_report_file
      else None
    ),
    "recommended_report_files": recommended_report_files,
    "file_write_status": {
      "status": "not_written_to_grid_files",
      "tool": "write_file",
      "paths": file_write_paths,
      "available_paths": report_paths,
      "instruction": (
        "These report files are generated templates only. They are not visible in the Grid "
        "Files section until the agent calls write_file. For any LiteLLM FinOps report request, "
        "write every file in files_to_write by default so the user gets both the visual HTML report with "
        "graphs and the CSV export, even if they did not explicitly ask for CSV or graphs. "
        "Only say the reports are in Files after every write_file call succeeds."
      ),
    },
    "files_to_write": files_to_write,
    "visualizations": {
      "chart_data": charts,
      "text_charts": [
        {
          "title": chart["title"],
          "content": _text_bar_chart(chart),
        }
        for chart in charts
      ],
      "downloadable_reports": downloadable_reports,
    },
  }


def _parse_report_date(value: str) -> date:
  """Parse common date formats used in chat prompts."""
  value = value.strip()
  for fmt in ("%Y-%m-%d", "%m/%d/%Y"):
    try:
      return datetime.strptime(value, fmt).date()
    except ValueError:
      continue
  raise ValueError("Use dates in YYYY-MM-DD or MM/DD/YYYY format.")


def _format_date(value: date) -> str:
  """Format a date for LiteLLM query parameters."""
  return value.isoformat()


def _add_months(value: date, months: int) -> date:
  """Return date shifted by whole months, clamping to the target month end."""
  month_index = value.month - 1 + months
  year = value.year + month_index // 12
  month = month_index % 12 + 1
  day = min(value.day, monthrange(year, month)[1])
  return date(year, month, day)


def _month_end(value: date) -> date:
  """Return the final day of value's month."""
  return date(value.year, value.month, monthrange(value.year, value.month)[1])


def _month_span(start: date, end: date) -> int:
  """Return count of calendar months touched by a date range."""
  return (end.year - start.year) * 12 + end.month - start.month + 1


def _month_ranges(start: date, end: date) -> list[tuple[date, date]]:
  """Split a date range into month-bounded ranges."""
  ranges = []
  cursor = start
  while cursor <= end:
    segment_end = min(_month_end(cursor), end)
    ranges.append((cursor, segment_end))
    cursor = segment_end + timedelta(days=1)
  return ranges


def _business_quarter_start_for(value: date) -> date:
  """Return the custom business-quarter start date for the given date."""
  if value.month == 1:
    return date(value.year - 1, 11, 1)
  if value.month in (2, 3, 4):
    return date(value.year, 2, 1)
  if value.month in (5, 6, 7):
    return date(value.year, 5, 1)
  if value.month in (8, 9, 10):
    return date(value.year, 8, 1)
  return date(value.year, 11, 1)


def _business_quarter_end(start: date) -> date:
  """Return the final day of a custom business quarter."""
  return _month_end(_add_months(start, BUSINESS_QUARTER_MONTHS - 1))


def _fiscal_quarter_start_from_name(period: str) -> tuple[date, str, int, int] | None:
  """Resolve fiscal quarter names such as FY26Q1 or FY2026 Q3."""
  compact = re.sub(r"[\s_-]+", "", period.strip().lower())
  match = re.fullmatch(r"fy(\d{2}|\d{4})q([1-4])", compact)
  if not match:
    return None

  fiscal_year = int(match.group(1))
  if fiscal_year < 100:
    fiscal_year += 2000

  fiscal_quarter = int(match.group(2))
  start_month, year_offset, quarter_label = FISCAL_QUARTERS[fiscal_quarter]
  start = date(fiscal_year + year_offset, start_month, 1)
  label = f"FY{str(fiscal_year)[-2:]}Q{fiscal_quarter} ({quarter_label})"
  return start, label, fiscal_year, fiscal_quarter


def _quarter_start_from_name(period: str, reference: date) -> tuple[date, str] | None:
  """Resolve named custom quarter windows such as feb-apr or november-january."""
  period_key = period.strip().lower().replace(" ", "_").replace("-", "_")
  quarter = BUSINESS_QUARTERS.get(period_key)
  if not quarter:
    return None

  start_month, label = quarter
  start = date(reference.year, start_month, 1)
  if start > reference:
    start = date(reference.year - 1, start_month, 1)
  return start, label


def _resolve_report_window(
  start_date: str | None,
  end_date: str | None,
  period: str | None,
  reference_date: str | None = None,
) -> tuple[dict[str, Any] | None, date | None, date | None]:
  """Resolve date inputs and enforce FinOps reporting range rules."""
  reference = _parse_report_date(reference_date) if reference_date else date.today()

  if period:
    period_key = period.strip().lower().replace(" ", "_").replace("-", "_")
    fiscal_quarter: tuple[date, str, int, int] | None = None
    if period_key in {"last_quarter", "previous_quarter"}:
      current_start = _business_quarter_start_for(reference)
      start = _add_months(current_start, -BUSINESS_QUARTER_MONTHS)
      label = "last_quarter"
    elif period_key in {"current_quarter", "this_quarter"}:
      start = _business_quarter_start_for(reference)
      label = "current_quarter"
    else:
      fiscal_quarter = _fiscal_quarter_start_from_name(period)
      named_quarter = (
        (fiscal_quarter[0], fiscal_quarter[1])
        if fiscal_quarter
        else _quarter_start_from_name(period, reference)
      )
      if not named_quarter:
        return (
          {
            "success": False,
            "error": "Unsupported period. Use last_quarter, current_quarter, a fiscal quarter like FY26Q1, or one of: Aug-Oct, Nov-Jan, Feb-Apr, May-Jul.",
            "supported_periods": [
              "last_quarter",
              "current_quarter",
              "FY26Q1",
              "FY26Q2",
              "FY26Q3",
              "FY26Q4",
              "Aug-Oct",
              "Nov-Jan",
              "Feb-Apr",
              "May-Jul",
            ],
          },
          None,
          None,
        )
      start, label = named_quarter

    end = _business_quarter_end(start)
    window = {
      "success": True,
      "range_type": "fiscal_quarter" if fiscal_quarter else "business_quarter",
      "period": label,
      "start_date": _format_date(start),
      "end_date": _format_date(end),
    }
    if fiscal_quarter:
      window.update(
        {
          "fiscal_year": fiscal_quarter[2],
          "fiscal_quarter": f"Q{fiscal_quarter[3]}",
          "fiscal_year_definition": (
            "Fiscal year runs from August 1 through July 31 and is named by "
            "the calendar year in which it ends."
          ),
        }
      )
    return (window, start, end)

  if not start_date or not end_date:
    return (
      {
        "success": False,
        "error": "Provide either start_date and end_date, or period=last_quarter/current_quarter/FY26Q1.",
      },
      None,
      None,
    )

  try:
    start = _parse_report_date(start_date)
    end = _parse_report_date(end_date)
  except ValueError as exc:
    return ({"success": False, "error": str(exc)}, None, None)

  if end < start:
    return ({"success": False, "error": "end_date must be on or after start_date."}, None, None)

  months = _month_span(start, end)
  if months > MAX_CUSTOM_RANGE_MONTHS:
    return (
      {
        "success": False,
        "error": "Custom date ranges are limited to two calendar months. Ask for a month, a two-month range, or use period=last_quarter/FY26Q1.",
        "max_custom_range_months": MAX_CUSTOM_RANGE_MONTHS,
        "requested_months": months,
        "start_date": _format_date(start),
        "end_date": _format_date(end),
      },
      None,
      None,
    )

  return (
    {
      "success": True,
      "range_type": "custom_date_range",
      "period": None,
      "start_date": _format_date(start),
      "end_date": _format_date(end),
    },
    start,
    end,
  )


def _user_identity(api_key_hash: str, payload: dict[str, Any]) -> tuple[str, str]:
  """Return a stable user identifier and display label from API-key metadata."""
  metadata = payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {}
  value = _first_present(
    metadata,
    ("user_id", "user_email", "email", "end_user", "key_alias", "team_id"),
  )
  if value:
    return str(value), str(value)

  value = _first_present(
    payload,
    ("user_id", "user_email", "email", "end_user", "key_alias", "team_id"),
  )
  if value:
    return str(value), str(value)

  short_hash = str(api_key_hash)[:12]
  return f"api_key:{short_hash}", f"api_key:{short_hash}"


def _new_rollup() -> dict[str, Any]:
  """Create a fresh rollup structure."""
  return {
    "totals": _empty_metrics(),
    "models": {},
    "users": {},
    "days": 0,
    "warnings": [],
  }


def _model_entry(model_name: str) -> dict[str, Any]:
  """Create a model rollup row."""
  return {"model": model_name, **_empty_metrics()}


def _user_entry(user_id: str, display_name: str) -> dict[str, Any]:
  """Create a user rollup row."""
  return {
    "user_id": user_id,
    "display_name": display_name,
    **_empty_metrics(),
    "models": {},
    "api_key_hashes": set(),
  }


def _aggregate_activity_response(response: dict[str, Any]) -> dict[str, Any]:
  """Aggregate LiteLLM daily activity response into model and user rollups."""
  rollup = _new_rollup()
  results = response.get("results") if isinstance(response, dict) else None
  if not isinstance(results, list):
    rollup["warnings"].append("LiteLLM activity response did not include a results list.")
    return rollup

  rollup["days"] = len(results)
  for day in results:
    if not isinstance(day, dict):
      continue

    _add_metrics(rollup["totals"], _metrics_from(day.get("metrics")))

    breakdown = day.get("breakdown") if isinstance(day.get("breakdown"), dict) else {}
    models = breakdown.get("models") if isinstance(breakdown.get("models"), dict) else {}
    for model_name, model_payload in models.items():
      if not isinstance(model_payload, dict):
        continue

      model_metrics = _metrics_from(model_payload.get("metrics"))
      model_row = rollup["models"].setdefault(str(model_name), _model_entry(str(model_name)))
      _add_metrics(model_row, model_metrics)

      api_keys = model_payload.get("api_key_breakdown")
      if not isinstance(api_keys, dict):
        continue

      for api_key_hash, api_key_payload in api_keys.items():
        if not isinstance(api_key_payload, dict):
          continue

        user_id, display_name = _user_identity(str(api_key_hash), api_key_payload)
        user_metrics = _metrics_from(api_key_payload.get("metrics"))
        user_row = rollup["users"].setdefault(user_id, _user_entry(user_id, display_name))
        user_row["api_key_hashes"].add(str(api_key_hash))
        _add_metrics(user_row, user_metrics)

        user_model = user_row["models"].setdefault(str(model_name), _model_entry(str(model_name)))
        _add_metrics(user_model, user_metrics)

  return rollup


def _merge_rollup(target: dict[str, Any], source: dict[str, Any]) -> None:
  """Merge one rollup into another."""
  _add_metrics(target["totals"], source["totals"])
  target["days"] += source["days"]
  target["warnings"].extend(source["warnings"])

  for model_name, model_metrics in source["models"].items():
    target_model = target["models"].setdefault(model_name, _model_entry(model_name))
    _add_metrics(target_model, model_metrics)

  for user_id, user_metrics in source["users"].items():
    target_user = target["users"].setdefault(
      user_id,
      _user_entry(user_id, user_metrics.get("display_name", user_id)),
    )
    target_user["api_key_hashes"].update(user_metrics.get("api_key_hashes", set()))
    _add_metrics(target_user, user_metrics)

    for model_name, model_metrics in user_metrics["models"].items():
      target_model = target_user["models"].setdefault(model_name, _model_entry(model_name))
      _add_metrics(target_model, model_metrics)


async def _fetch_activity_rollup(
  start: date,
  end: date,
  model: str | None = None,
  user_id: str | None = None,
) -> dict[str, Any]:
  """Fetch LiteLLM daily activity month-by-month and aggregate it."""
  rollup = _new_rollup()
  scanned_ranges = []

  for segment_start, segment_end in _month_ranges(start, end):
    params: dict[str, Any] = {
      "start_date": _format_date(segment_start),
      "end_date": _format_date(segment_end),
    }
    if model:
      params["model"] = model
    if user_id:
      params["user_id"] = user_id

    success, response = await make_api_request(
      "/user/daily/activity/aggregated",
      method="GET",
      params=params,
    )
    if not success:
      logger.error("Failed to build LiteLLM activity rollup: %s", response.get("error"))
      return {
        "success": False,
        "error": response.get("error", "LiteLLM request failed"),
        "details": response,
        "ranges_scanned": scanned_ranges,
      }

    metadata = response.get("metadata") if isinstance(response, dict) else {}
    if isinstance(metadata, dict) and metadata.get("has_more"):
      rollup["warnings"].append(
        "LiteLLM aggregate endpoint reported additional pages; report may be partial."
      )

    segment_rollup = _aggregate_activity_response(response)
    _merge_rollup(rollup, segment_rollup)
    scanned_ranges.append(
      {
        "start_date": _format_date(segment_start),
        "end_date": _format_date(segment_end),
      }
    )

  rollup["success"] = True
  rollup["ranges_scanned"] = scanned_ranges
  return rollup


def _finalize_model_rows(
  models: dict[str, dict[str, Any]],
  limit: int,
  rank_by: str = "total_tokens",
) -> list[dict[str, Any]]:
  """Return sorted model rows."""
  safe_rank_by = rank_by if rank_by in {"total_tokens", "spend", "requests"} else "total_tokens"
  return sorted(models.values(), key=lambda item: item[safe_rank_by], reverse=True)[:limit]


def _finalize_user_rows(
  users: dict[str, dict[str, Any]],
  limit: int,
  rank_by: str = "total_tokens",
) -> list[dict[str, Any]]:
  """Return sorted user rows with compact top-model details."""
  safe_rank_by = rank_by if rank_by in {"total_tokens", "spend", "requests"} else "total_tokens"
  rows = []
  for user in users.values():
    top_models = _finalize_model_rows(user["models"], 5, safe_rank_by)
    rows.append(
      {
        key: value
        for key, value in user.items()
        if key not in {"models", "api_key_hashes"}
      }
      | {
        "api_key_count": len(user["api_key_hashes"]),
        "top_models": top_models,
      }
    )
  return sorted(rows, key=lambda item: item[safe_rank_by], reverse=True)[:limit]


async def _build_aggregate_report(
  report_type: str,
  start_date: str | None,
  end_date: str | None,
  period: str | None,
  reference_date: str | None,
  model: str | None = None,
  user_id: str | None = None,
) -> dict[str, Any]:
  """Resolve dates, fetch aggregate data, and return a common report envelope."""
  window, start, end = _resolve_report_window(start_date, end_date, period, reference_date)
  if not window or not window.get("success"):
    return window or {"success": False, "error": "Could not resolve report window."}

  rollup = await _fetch_activity_rollup(start, end, model=model, user_id=user_id)
  if not rollup.get("success"):
    return {
      "success": False,
      "report_type": report_type,
      **{key: value for key, value in window.items() if key != "success"},
      **rollup,
    }

  return {
    "success": True,
    "report_type": report_type,
    **{key: value for key, value in window.items() if key != "success"},
    "filters": {
      "model": model,
      "user_id": user_id,
    },
    "source": "/user/daily/activity/aggregated",
    "is_complete": not rollup["warnings"],
    "warnings": rollup["warnings"],
    "ranges_scanned": rollup["ranges_scanned"],
    "days_scanned": rollup["days"],
    "totals": rollup["totals"],
    "_models": rollup["models"],
    "_users": rollup["users"],
  }


async def get_llm_token_usage_report(
  start_date: str | None = None,
  end_date: str | None = None,
  period: str | None = None,
  limit: int = DEFAULT_LIMIT,
  reference_date: str | None = None,
  report_format: str = "all",
) -> dict[str, Any]:
  """
  Get a LiteLLM token usage report for a month, two-month range, or business quarter.

  Use this curated tool for requests like:
  - token usage between 03/01/2026 and 04/30/2026
  - token usage last quarter
  - token usage for FY26Q3
  - total LLM tokens by model

  Custom date ranges are limited to two calendar months. Quarter requests use
  the CAIPE fiscal quarters: Q1 Aug-Oct, Q2 Nov-Jan, Q3 Feb-Apr, Q4 May-Jul.
  Fiscal years run from August 1 through July 31 and are named by the calendar
  year in which they end, so FY26Q1 is 2025-08-01 through 2025-10-31.

  Args:
    start_date: Optional report start date in YYYY-MM-DD or MM/DD/YYYY format.
    end_date: Optional report end date in YYYY-MM-DD or MM/DD/YYYY format.
    period: Optional period. Use last_quarter, current_quarter, Aug-Oct,
      Nov-Jan, Feb-Apr, May-Jul, or a fiscal quarter like FY26Q1.
    limit: Maximum number of top models/users to return.
    reference_date: Optional YYYY-MM-DD date for resolving relative quarters.
    report_format: Downloadable report format: html, markdown, csv, or all.

  Returns:
    Token usage totals with top models, top users, chart data, text charts,
    and Markdown/HTML/CSV report templates under ``visualizations``.
  """
  safe_limit = _safe_limit(limit)
  report = await _build_aggregate_report(
    "token_usage",
    start_date,
    end_date,
    period,
    reference_date,
  )
  if not report.get("success"):
    return report

  models = report.pop("_models")
  users = report.pop("_users")
  top_models = _finalize_model_rows(models, safe_limit, "total_tokens")
  top_users = _finalize_user_rows(users, safe_limit, "total_tokens")
  result = {
    **report,
    "limit": safe_limit,
    "top_models": top_models,
    "top_users": top_users,
  }
  return _attach_visualizations(
    result,
    "LiteLLM Token Usage Report",
    [
      _chart_data("Top models by total tokens", top_models, "model", "total_tokens"),
      _chart_data("Top users by total tokens", top_users, "display_name", "total_tokens"),
    ],
    [
      {
        "title": "Top Models",
        "rows": top_models,
        "columns": [
          ("model", "Model"),
          ("total_tokens", "Total Tokens"),
          ("prompt_tokens", "Prompt Tokens"),
          ("completion_tokens", "Completion Tokens"),
          ("spend", "Spend"),
          ("requests", "Requests"),
        ],
      },
      {
        "title": "Top Users",
        "rows": top_users,
        "columns": [
          ("display_name", "User"),
          ("total_tokens", "Total Tokens"),
          ("prompt_tokens", "Prompt Tokens"),
          ("completion_tokens", "Completion Tokens"),
          ("spend", "Spend"),
          ("requests", "Requests"),
        ],
      },
    ],
    report_format=report_format,
  )


async def get_llm_spend_by_model_report(
  start_date: str | None = None,
  end_date: str | None = None,
  period: str | None = None,
  limit: int = DEFAULT_LIMIT,
  rank_by: str = "spend",
  reference_date: str | None = None,
  report_format: str = "all",
) -> dict[str, Any]:
  """
  Get LiteLLM spend per model for a month, two-month range, or business quarter.

  Use this curated tool for requests like:
  - spend per LLM during the last quarter
  - spend per model for FY26Q2
  - top models by spend
  - model usage cost for March

  Custom date ranges are limited to two calendar months. Quarter requests use
  the CAIPE fiscal quarters: Q1 Aug-Oct, Q2 Nov-Jan, Q3 Feb-Apr, Q4 May-Jul.
  Fiscal years run from August 1 through July 31 and are named by the calendar
  year in which they end, so FY26Q1 is 2025-08-01 through 2025-10-31.

  Args:
    start_date: Optional report start date in YYYY-MM-DD or MM/DD/YYYY format.
    end_date: Optional report end date in YYYY-MM-DD or MM/DD/YYYY format.
    period: Optional period. Use last_quarter, current_quarter, Aug-Oct,
      Nov-Jan, Feb-Apr, May-Jul, or a fiscal quarter like FY26Q1.
    limit: Maximum number of models to return.
    rank_by: Metric to sort models by: spend, total_tokens, or requests.
    reference_date: Optional YYYY-MM-DD date for resolving relative quarters.
    report_format: Downloadable report format: html, markdown, csv, or all.

  Returns:
    Spend and token usage by model, chart data, text charts, and Markdown/HTML/CSV
    report templates under ``visualizations``.
  """
  safe_limit = _safe_limit(limit)
  safe_rank_by = rank_by if rank_by in {"spend", "total_tokens", "requests"} else "spend"
  report = await _build_aggregate_report(
    "spend_by_model",
    start_date,
    end_date,
    period,
    reference_date,
  )
  if not report.get("success"):
    return report

  models = report.pop("_models")
  report.pop("_users")
  model_rows = _finalize_model_rows(models, safe_limit, safe_rank_by)
  result = {
    **report,
    "limit": safe_limit,
    "rank_by": safe_rank_by,
    "models": model_rows,
  }
  return _attach_visualizations(
    result,
    "LiteLLM Spend By Model Report",
    [
      _chart_data(f"Top models by {safe_rank_by}", model_rows, "model", safe_rank_by),
      _chart_data("Top models by spend", model_rows, "model", "spend"),
    ],
    [
      {
        "title": "Models",
        "rows": model_rows,
        "columns": [
          ("model", "Model"),
          ("spend", "Spend"),
          ("total_tokens", "Total Tokens"),
          ("prompt_tokens", "Prompt Tokens"),
          ("completion_tokens", "Completion Tokens"),
          ("requests", "Requests"),
        ],
      }
    ],
    report_format=report_format,
  )


async def get_llm_usage_and_spend_by_user_report(
  start_date: str | None = None,
  end_date: str | None = None,
  period: str | None = None,
  limit: int = 50,
  rank_by: str = "total_tokens",
  model: str | None = None,
  user_id: str | None = None,
  reference_date: str | None = None,
  report_format: str = "all",
) -> dict[str, Any]:
  """
  Get LiteLLM token usage and spend per user.

  Use this curated tool for requests like:
  - token usage and spend per user during the last quarter
  - token usage and spend per user for FY26Q4
  - user usage between 03/01/2026 and 04/30/2026
  - highest spend users for Feb-Apr

  Custom date ranges are limited to two calendar months. Quarter requests use
  the CAIPE fiscal quarters: Q1 Aug-Oct, Q2 Nov-Jan, Q3 Feb-Apr, Q4 May-Jul.
  Fiscal years run from August 1 through July 31 and are named by the calendar
  year in which they end, so FY26Q1 is 2025-08-01 through 2025-10-31.

  Args:
    start_date: Optional report start date in YYYY-MM-DD or MM/DD/YYYY format.
    end_date: Optional report end date in YYYY-MM-DD or MM/DD/YYYY format.
    period: Optional period. Use last_quarter, current_quarter, Aug-Oct,
      Nov-Jan, Feb-Apr, May-Jul, or a fiscal quarter like FY26Q1.
    limit: Maximum number of users to return.
    rank_by: Metric to sort users by: total_tokens, spend, or requests.
    model: Optional model filter.
    user_id: Optional LiteLLM user_id filter.
    reference_date: Optional YYYY-MM-DD date for resolving relative quarters.
    report_format: Downloadable report format: html, markdown, csv, or all.

  Returns:
    Token usage and spend by user, each user's top models, chart data, text
    charts, and Markdown/HTML/CSV report templates under ``visualizations``.
  """
  safe_limit = _safe_limit(limit, default=50)
  safe_rank_by = rank_by if rank_by in {"total_tokens", "spend", "requests"} else "total_tokens"
  report = await _build_aggregate_report(
    "usage_and_spend_by_user",
    start_date,
    end_date,
    period,
    reference_date,
    model=model,
    user_id=user_id,
  )
  if not report.get("success"):
    return report

  models = report.pop("_models")
  users = report.pop("_users")
  user_rows = _finalize_user_rows(users, safe_limit, safe_rank_by)
  top_models = _finalize_model_rows(models, 10, safe_rank_by)
  result = {
    **report,
    "limit": safe_limit,
    "rank_by": safe_rank_by,
    "users_returned": min(len(users), safe_limit),
    "users_total_seen": len(users),
    "users": user_rows,
    "top_models": top_models,
  }
  return _attach_visualizations(
    result,
    "LiteLLM Usage And Spend By User Report",
    [
      _chart_data(f"Top users by {safe_rank_by}", user_rows, "display_name", safe_rank_by),
      _chart_data(f"Top models by {safe_rank_by}", top_models, "model", safe_rank_by),
    ],
    [
      {
        "title": "Users",
        "rows": user_rows,
        "columns": [
          ("display_name", "User"),
          ("total_tokens", "Total Tokens"),
          ("spend", "Spend"),
          ("requests", "Requests"),
          ("api_key_count", "API Keys"),
        ],
      },
      {
        "title": "Top Models",
        "rows": top_models,
        "columns": [
          ("model", "Model"),
          ("total_tokens", "Total Tokens"),
          ("spend", "Spend"),
          ("requests", "Requests"),
        ],
      },
    ],
    report_format=report_format,
  )


async def get_llm_top_models_report(
  start_date: str | None = None,
  end_date: str | None = None,
  period: str | None = None,
  limit: int = DEFAULT_LIMIT,
  rank_by: str = "total_tokens",
  reference_date: str | None = None,
  report_format: str = "all",
) -> dict[str, Any]:
  """
  Get top LiteLLM models by tokens, spend, or request count.

  This compatibility tool delegates to the aggregate report path. Prefer
  get_llm_spend_by_model_report for spend questions and
  get_llm_token_usage_report for token questions.
  """
  return await get_llm_spend_by_model_report(
    start_date=start_date,
    end_date=end_date,
    period=period,
    limit=limit,
    rank_by=rank_by,
    reference_date=reference_date,
    report_format=report_format,
  )


async def get_llm_usage_by_user_report(
  start_date: str | None = None,
  end_date: str | None = None,
  period: str | None = None,
  limit: int = 50,
  rank_by: str = "total_tokens",
  user_id: str | None = None,
  model: str | None = None,
  reference_date: str | None = None,
  report_format: str = "all",
) -> dict[str, Any]:
  """
  Get LiteLLM token usage aggregated by user.

  This compatibility tool delegates to get_llm_usage_and_spend_by_user_report.
  """
  return await get_llm_usage_and_spend_by_user_report(
    start_date=start_date,
    end_date=end_date,
    period=period,
    limit=limit,
    rank_by=rank_by,
    model=model,
    user_id=user_id,
    reference_date=reference_date,
    report_format=report_format,
  )
