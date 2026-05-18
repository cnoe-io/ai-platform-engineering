"""Curated reporting tools for LiteLLM usage analytics."""
# ruff: noqa: E501

import csv
import logging
import os
import re
from base64 import b64encode
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
CHAT_TABLE_LIMIT = 10
HTML_REPORT_TEMPLATE_VERSION = "litellm-finops-html-v2"
REPORT_FORMATS = {"markdown", "html", "csv", "html_csv", "both", "all"}
HTML_REPORT_STYLE = (
  "*{box-sizing:border-box}body{margin:0;padding:22px;background:#f6f8fb;color:#172033;"
  "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}.report{max-width:1320px;"
  "margin:auto;background:#fff;border:1px solid #dbe4f0;border-radius:16px;overflow:hidden;"
  "box-shadow:0 18px 55px rgba(15,23,42,.16)}header{padding:34px 42px;color:#fff;"
  "background:linear-gradient(135deg,#0f766e,#2563eb)}.eyebrow{font-size:12px;font-weight:800;"
  "letter-spacing:.08em;text-transform:uppercase;opacity:.9}h1{margin:8px 0 8px;font-size:32px;"
  "line-height:1.15}.subtitle{margin:0;color:rgba(255,255,255,.88)}.pills{display:flex;"
  "flex-wrap:wrap;gap:8px;margin-top:18px}.pills span{padding:7px 11px;border:1px solid "
  "rgba(255,255,255,.28);border-radius:999px;background:rgba(255,255,255,.14);font-size:12px;"
  "font-weight:700}.content{padding:32px}.summary-grid{display:grid;grid-template-columns:"
  "repeat(auto-fit,minmax(190px,1fr));gap:16px;margin-bottom:32px}.metric-card{padding:20px;"
  "border:1px solid #e5e7eb;border-left:5px solid #2563eb;border-radius:12px;background:#f8fafc}"
  ".metric-card:nth-child(1){border-left-color:#0f766e}.metric-card:nth-child(3){border-left-color:"
  "#d97706}.metric-card:nth-child(4){border-left-color:#7c3aed}.metric-card:nth-child(5){border-left-color:"
  "#dc2626}.metric-label{color:#64748b;font-size:11px;font-weight:800;letter-spacing:.06em;"
  "text-transform:uppercase}.metric-value{margin-top:8px;color:#0f172a;font-size:25px;font-weight:850;"
  "word-break:break-word}.metric-hint{margin-top:8px;color:#64748b;font-size:12px}.section{margin-bottom:"
  "34px}.section-title{margin:0 0 16px;padding-bottom:10px;border-bottom:3px solid #0f766e;"
  "font-size:21px}.chart-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(390px,1fr));"
  "gap:18px}.chart-container,.table-container{padding:18px;border:1px solid #e2e8f0;border-radius:12px;"
  "background:#f8fafc;overflow-x:auto}svg{display:block;width:100%;height:auto}.chart-title{font-size:"
  "18px;font-weight:800;fill:#0f172a}.label{font-size:12px;fill:#334155}.value{font-size:12px;"
  "fill:#0f172a;font-weight:700}.bar-bg{fill:#e2e8f0}.bar{fill:#2563eb}table{width:100%;"
  "border-collapse:collapse;background:#fff;border-radius:10px;overflow:hidden;font-size:13px}th{padding:"
  "12px 14px;background:#0f766e;color:#fff;text-align:left}td{padding:11px 14px;border-bottom:1px solid "
  "#e5e7eb}.insights{padding:18px 20px;border:1px solid #bfdbfe;border-left:5px solid #2563eb;"
  "border-radius:12px;background:#eff6ff}.insights h2{margin:0 0 10px;color:#1e40af}.insights ul{margin:0;"
  "padding-left:18px;color:#1e3a8a;line-height:1.55}.footer{padding:16px 32px;border-top:1px solid #e2e8f0;"
  "background:#f8fafc;color:#64748b;text-align:center;font-size:12px}@media(max-width:720px){body{padding:10px}"
  "header,.content{padding:24px 18px}h1{font-size:26px}.chart-row{grid-template-columns:1fr}}"
)
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
FISCAL_CALENDAR_MONTHS = (
  ("Aug", 8),
  ("Sep", 9),
  ("Oct", 10),
  ("Nov", 11),
  ("Dec", 12),
  ("Jan", 1),
  ("Feb", 2),
  ("Mar", 3),
  ("Apr", 4),
  ("May", 5),
  ("Jun", 6),
  ("Jul", 7),
)

REPORT_FORM_REPORT_TYPES = {
  "token_usage": {
    "label": "Token usage by model and user",
    "tool": "get_llm_token_usage_report",
  },
  "spend_by_model": {
    "label": "Spend per LLM/model",
    "tool": "get_llm_spend_by_model_report",
  },
  "usage_and_spend_by_user": {
    "label": "Usage and spend per user",
    "tool": "get_llm_usage_and_spend_by_user_report",
  },
  "top_models": {
    "label": "Top models",
    "tool": "get_llm_top_models_report",
  },
}

FINOPS_WORKFLOW_SVG = """<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="340" viewBox="0 0 1200 340" role="img" aria-labelledby="title desc">
  <title id="title">FinOps agent workflow</title>
  <desc id="desc">Grid chat sends a FinOps question to the FinOps agent, which queries LiteLLM MCP, reads LiteLLM usage data, and returns visual HTML and CSV reports.</desc>
  <style>
    :root {
      color-scheme: light dark;
      --bg:#f8fafc; --panel:#ffffff; --text:#0f172a; --muted:#64748b; --arrow:#94a3b8;
      --teal:#14b8a6; --teal-bg:#ccfbf1; --blue:#3b82f6; --blue-bg:#dbeafe;
      --amber:#eab308; --amber-bg:#fef3c7; --green:#16a34a; --green-bg:#dcfce7;
      --border:#dbeafe; --shadow:rgba(15,23,42,.12); --spark:#facc15; --glow:rgba(59,130,246,.28);
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg:#020617; --panel:#0f172a; --text:#f8fafc; --muted:#cbd5e1; --arrow:#64748b;
        --teal:#2dd4bf; --teal-bg:#134e4a; --blue:#60a5fa; --blue-bg:#172554;
        --amber:#fbbf24; --amber-bg:#451a03; --green:#86efac; --green-bg:#14532d;
        --border:#1e3a8a; --shadow:rgba(0,0,0,.45); --spark:#fde047; --glow:rgba(96,165,250,.36);
      }
    }
    @keyframes flow { to { stroke-dashoffset: -44; } }
    @keyframes pulse { 0%,100% { opacity:.45; transform:scale(1); } 50% { opacity:1; transform:scale(1.08); } }
    @keyframes spark { 0%,100% { opacity:.45; transform:translateY(0); } 50% { opacity:1; transform:translateY(-3px); } }
    @keyframes breathe { 0%,100% { opacity:.18; } 50% { opacity:.42; } }
    text { font-family: Inter, Segoe UI, Arial, sans-serif; }
    .title { font-size:24px; font-weight:800; fill:var(--text); }
    .subtitle { font-size:15px; fill:var(--muted); }
    .card { fill:var(--panel); stroke:var(--border); stroke-width:1.5; filter:drop-shadow(0 10px 18px var(--shadow)); }
    .label { font-size:19px; font-weight:800; fill:var(--text); }
    .small { font-size:13px; fill:var(--muted); }
    .arrow { stroke:var(--arrow); stroke-width:6; stroke-linecap:round; }
    .flow { stroke-dasharray:12 10; animation:flow 1.45s linear infinite; }
    .soft-glow { fill:var(--glow); transform-origin:center; animation:breathe 2.4s ease-in-out infinite; }
    .pulse { transform-box:fill-box; transform-origin:center; animation:pulse 1.9s ease-in-out infinite; }
    .spark { transform-box:fill-box; transform-origin:center; animation:spark 1.25s ease-in-out infinite; }
    @media (prefers-reduced-motion: reduce) {
      .flow, .pulse, .spark, .soft-glow { animation:none; }
    }
  </style>
  <defs>
    <marker id="arrowHead" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="8" markerHeight="8" orient="auto">
      <path d="M0 0 10 5 0 10Z" fill="var(--arrow)"/>
    </marker>
  </defs>
  <rect width="1200" height="340" fill="var(--bg)"/>
  <ellipse class="soft-glow" cx="486" cy="185" rx="154" ry="74"/>
  <ellipse class="soft-glow" cx="830" cy="185" rx="148" ry="70"/>
  <text x="48" y="54" class="title">FinOps Agent for LiteLLM reporting</text>
  <text x="48" y="84" class="subtitle">Ask in Grid chat, choose report details in a form, and get visual HTML plus CSV reports from LiteLLM data.</text>

  <g transform="translate(48 126)">
    <rect class="card" width="220" height="118" rx="12"/>
    <rect width="10" height="118" rx="5" fill="var(--teal)"/>
    <circle cx="56" cy="46" r="24" fill="var(--teal-bg)"/>
    <path d="M44 39h24M44 48h24M44 57h14" stroke="var(--teal)" stroke-width="5" stroke-linecap="round"/>
    <text x="92" y="42" class="label">Grid chat</text>
    <text x="92" y="70" class="small">Ask a FinOps</text>
    <text x="92" y="89" class="small">question</text>
  </g>
  <line x1="292" y1="185" x2="340" y2="185" class="arrow flow" marker-end="url(#arrowHead)"/>

  <g transform="translate(360 126)">
    <rect class="card" width="252" height="118" rx="12"/>
    <rect width="10" height="118" rx="5" fill="var(--blue)"/>
    <circle class="pulse" cx="56" cy="46" r="27" fill="var(--blue-bg)" opacity=".62"/>
    <circle cx="56" cy="46" r="24" fill="var(--blue-bg)"/>
    <path d="M47 50v-9c0-6 4-10 10-10s10 4 10 10v9M43 50h29v18H43zM52 59h2M63 59h2" stroke="var(--blue)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    <path class="spark" d="M82 23 72 48h13l-8 26 23-35H87l10-16Z" fill="var(--spark)" opacity=".92"/>
    <text x="92" y="42" class="label">FinOps agent</text>
    <text x="92" y="70" class="small">Selects report tool</text>
    <text x="92" y="89" class="small">or opens a form</text>
  </g>
  <line x1="636" y1="185" x2="684" y2="185" class="arrow flow" marker-end="url(#arrowHead)"/>

  <g transform="translate(704 126)">
    <rect class="card" width="252" height="118" rx="12" stroke="var(--amber)"/>
    <rect width="10" height="118" rx="5" fill="var(--amber)"/>
    <circle cx="56" cy="46" r="24" fill="var(--amber-bg)"/>
    <path d="M56 28v22M45 37v13c0 9 22 9 22 0V37M56 59v15" stroke="var(--amber)" stroke-width="5" stroke-linecap="round" fill="none"/>
    <text x="92" y="42" class="label">LiteLLM MCP</text>
    <text x="92" y="70" class="small">Read-only access</text>
    <text x="92" y="89" class="small">to usage data</text>
  </g>
  <line x1="980" y1="185" x2="1028" y2="185" class="arrow flow" marker-end="url(#arrowHead)"/>

  <g transform="translate(1048 126)">
    <rect class="card" width="106" height="118" rx="12" stroke="var(--green)"/>
    <circle cx="53" cy="40" r="23" fill="var(--green-bg)"/>
    <path d="M43 31h20M43 40h20M43 49h20M43 31v27h20V31" stroke="var(--green)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    <text x="20" y="83" class="label">Report</text>
    <text x="17" y="104" class="small">HTML + CSV</text>
  </g>

  <text x="48" y="294" class="small">Example requests: "Show token usage for FY26Q3" | "Spend per LLM last quarter" | "Usage and spend per user for April"</text>
</svg>"""


FINOPS_WORKFLOW_COMPACT_SVG = """<svg xmlns="http://www.w3.org/2000/svg" width="1120" height="250" viewBox="0 0 1120 250" role="img" aria-labelledby="title desc">
<title id="title">FinOps agent workflow</title>
<desc id="desc">Grid chat sends a FinOps request to the FinOps agent, which calls LiteLLM MCP and returns HTML and CSV reports.</desc>
<style>
:root{color-scheme:light dark;--bg:#f8fafc;--card:#fff;--text:#0f172a;--muted:#64748b;--line:#94a3b8;--teal:#14b8a6;--blue:#3b82f6;--amber:#eab308;--green:#16a34a;--border:#dbeafe}
@media(prefers-color-scheme:dark){:root{--bg:#020617;--card:#0f172a;--text:#f8fafc;--muted:#cbd5e1;--line:#64748b;--teal:#2dd4bf;--blue:#60a5fa;--amber:#fbbf24;--green:#86efac;--border:#1e3a8a}}
@keyframes border{to{stroke-dashoffset:-360}}
text{font-family:Inter,Segoe UI,Arial,sans-serif}.title{font-size:22px;font-weight:850;fill:var(--text)}.small{font-size:13px;fill:var(--muted)}.label{font-size:18px;font-weight:850;fill:var(--text)}.card{fill:var(--card);stroke:var(--border);stroke-width:1.5}.bar{rx:5}.edge{fill:none;stroke-width:3;stroke-linecap:round;stroke-dasharray:42 260;animation:border 2.8s linear infinite;filter:url(#g)}.edge.e2{animation-delay:-.7s}.edge.e3{animation-delay:-1.4s}.edge.e4{animation-delay:-2.1s}.edge.teal{stroke:var(--teal)}.edge.blue{stroke:var(--blue)}.edge.amber{stroke:var(--amber)}.edge.green{stroke:var(--green)}.arrow{stroke:var(--line);stroke-width:6;stroke-linecap:round}@media(prefers-reduced-motion:reduce){.edge{animation:none}}
</style>
<defs><marker id="a" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0 0 10 5 0 10Z" fill="var(--line)"/></marker><filter id="g" x="-15%" y="-20%" width="130%" height="140%"><feGaussianBlur stdDeviation="2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
<rect width="1120" height="250" fill="var(--bg)"/>
<text x="36" y="42" class="title">LiteLLM FinOps report workflow</text>
<text x="36" y="68" class="small">Ask in Grid, choose report details, and receive visual HTML plus CSV reports from LiteLLM usage data.</text>
<g transform="translate(36 100)"><rect class="card" width="190" height="92" rx="12"/><rect class="edge teal e1" x="1.5" y="1.5" width="187" height="89" rx="11"/><rect width="9" height="92" rx="5" fill="var(--teal)"/><circle cx="45" cy="36" r="20" fill="var(--teal)" opacity=".18"/><path d="M34 31h22M34 39h22M34 47h13" stroke="var(--teal)" stroke-width="5" stroke-linecap="round"/><text x="78" y="36" class="label">Grid chat</text><text x="78" y="61" class="small">Ask a question</text></g>
<line x1="244" y1="146" x2="294" y2="146" class="arrow" marker-end="url(#a)"/>
<g transform="translate(314 100)"><rect class="card" width="210" height="92" rx="12"/><rect class="edge blue e2" x="1.5" y="1.5" width="207" height="89" rx="11"/><rect width="9" height="92" rx="5" fill="var(--blue)"/><circle cx="45" cy="36" r="23" fill="var(--blue)" opacity=".2"/><path d="M36 41v-9c0-6 4-10 10-10s10 4 10 10v9M31 41h30v18H31zM40 50h2M51 50h2" stroke="var(--blue)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M71 19 62 42h12l-8 24 24-34H78l9-13Z" fill="#facc15"/><text x="82" y="36" class="label">FinOps agent</text><text x="82" y="61" class="small">Chooses tool</text></g>
<line x1="544" y1="146" x2="594" y2="146" class="arrow" marker-end="url(#a)"/>
<g transform="translate(614 100)"><rect class="card" width="210" height="92" rx="12"/><rect class="edge amber e3" x="1.5" y="1.5" width="207" height="89" rx="11"/><rect width="9" height="92" rx="5" fill="var(--amber)"/><circle cx="45" cy="36" r="20" fill="var(--amber)" opacity=".18"/><path d="M45 19v22M34 29v12c0 9 22 9 22 0V29M45 50v16" stroke="var(--amber)" stroke-width="5" stroke-linecap="round" fill="none"/><text x="82" y="36" class="label">LiteLLM MCP</text><text x="82" y="61" class="small">Read-only data</text></g>
<line x1="844" y1="146" x2="894" y2="146" class="arrow" marker-end="url(#a)"/>
<g transform="translate(914 100)"><rect class="card" width="160" height="92" rx="12"/><rect class="edge green e4" x="1.5" y="1.5" width="157" height="89" rx="11"/><rect width="9" height="92" rx="5" fill="var(--green)"/><circle cx="45" cy="36" r="20" fill="var(--green)" opacity=".18"/><path d="M35 27h21M35 36h21M35 45h21M35 27v27h21V27" stroke="var(--green)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none"/><text x="78" y="36" class="label">Report</text><text x="78" y="61" class="small">HTML + CSV</text></g>
</svg>"""

FINOPS_WORKFLOW_STEPS_SVG = """<svg xmlns="http://www.w3.org/2000/svg" width="620" height="424" viewBox="0 0 760 520" role="img" aria-labelledby="title desc">
<title id="title">FinOps agent workflow steps</title>
<desc id="desc">Five-step workflow: ask a FinOps question, choose report details, route to the FinOps agent, read LiteLLM data through MCP, and receive chat plus downloadable reports.</desc>
<style>
:root{color-scheme:light dark;--bg:#f8fafc;--card:#fff;--text:#0f172a;--muted:#64748b;--border:#d8e3ef;--line:#2dd4bf;--teal:#14b8a6;--rose:#f43f5e;--green:#22c55e;--blue:#3b82f6;--amber:#f59e0b;--shadow:rgba(15,23,42,.12)}
@media(prefers-color-scheme:dark){:root{--bg:#020617;--card:#0f172a;--text:#f8fafc;--muted:#cbd5e1;--border:#1f3355;--line:#2dd4bf;--teal:#2dd4bf;--rose:#fb7185;--green:#86efac;--blue:#60a5fa;--amber:#fbbf24;--shadow:rgba(0,0,0,.35)}}
text{font-family:Inter,Segoe UI,Arial,sans-serif}.card{fill:var(--card);stroke:var(--border);stroke-width:1.3;filter:url(#s)}.card.active{stroke:var(--line);stroke-width:3}.dash{stroke:var(--line);stroke-width:3;stroke-linecap:round;stroke-dasharray:7 10}.dot{fill:var(--line)}.plus{fill:var(--bg);stroke:var(--line);stroke-width:1.5;stroke-dasharray:4 5}.label{font-size:17px;font-weight:850;fill:var(--text)}.eyebrow{font-size:13px;font-weight:850;letter-spacing:.04em;fill:var(--muted)}.desc{font-size:14px;fill:var(--muted)}.num{font-size:17px;fill:var(--muted)}.icon-bg{opacity:.16}
</style>
<defs><filter id="s" x="-5%" y="-20%" width="110%" height="150%"><feDropShadow dx="0" dy="8" stdDeviation="8" flood-color="var(--shadow)"/></filter></defs>
<rect width="760" height="520" fill="var(--bg)"/>
<line x1="380" y1="96" x2="380" y2="124" class="dash"/><line x1="380" y1="192" x2="380" y2="220" class="dash"/><line x1="380" y1="288" x2="380" y2="316" class="dash"/><line x1="380" y1="384" x2="380" y2="412" class="dash"/>
<circle cx="380" cy="96" r="5" class="dot"/><circle cx="380" cy="124" r="5" class="dot"/><circle cx="380" cy="192" r="5" class="dot"/><circle cx="380" cy="220" r="5" class="dot"/><circle cx="380" cy="288" r="5" class="dot"/><circle cx="380" cy="316" r="5" class="dot"/><circle cx="380" cy="384" r="5" class="dot"/><circle cx="380" cy="412" r="5" class="dot"/>
<g transform="translate(44 28)"><rect class="card active" width="672" height="68" rx="20"/><circle cx="42" cy="34" r="22" fill="var(--teal)" class="icon-bg"/><path d="M31 28h22M31 36h22M31 44h13" stroke="var(--teal)" stroke-width="5" stroke-linecap="round"/><text x="88" y="28" class="eyebrow">GRID CHAT</text><text x="88" y="52" class="label">Ask a LiteLLM FinOps question</text><text x="620" y="34" class="num">#1</text></g>
<g transform="translate(44 124)"><rect class="card" width="672" height="68" rx="16"/><circle cx="42" cy="34" r="22" fill="var(--rose)" class="icon-bg"/><path d="M31 28h22v20H31zM36 28v-6h12v6M36 37h12" stroke="var(--rose)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none"/><text x="88" y="28" class="eyebrow">REPORT FORM</text><text x="88" y="52" class="label">Choose period and optional model, user, or token filter</text><text x="620" y="34" class="num">#2</text></g>
<g transform="translate(44 220)"><rect class="card" width="672" height="68" rx="16"/><circle cx="42" cy="34" r="22" fill="var(--blue)" class="icon-bg"/><path d="M31 41v-9c0-6 4-10 10-10s10 4 10 10v9M27 41h30v17H27zM36 50h2M47 50h2" stroke="var(--blue)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none"/><text x="88" y="28" class="eyebrow">FINOPS AGENT</text><text x="88" y="52" class="label">Selects the right curated report tool</text><text x="620" y="34" class="num">#3</text></g>
<g transform="translate(44 316)"><rect class="card" width="672" height="68" rx="16"/><circle cx="42" cy="34" r="22" fill="var(--amber)" class="icon-bg"/><path d="M42 18v22M31 28v12c0 9 22 9 22 0V28M42 49v16" stroke="var(--amber)" stroke-width="5" stroke-linecap="round" fill="none"/><text x="88" y="28" class="eyebrow">LITELLM MCP</text><text x="88" y="52" class="label">Reads aggregate usage, spend, and token data</text><text x="620" y="34" class="num">#4</text></g>
<g transform="translate(44 412)"><rect class="card" width="672" height="68" rx="16"/><circle cx="42" cy="34" r="22" fill="var(--green)" class="icon-bg"/><path d="M31 24h21M31 34h21M31 44h21M31 24v30h21V24" stroke="var(--green)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none"/><text x="88" y="28" class="eyebrow">GRID FILES + CHAT</text><text x="88" y="52" class="label">Receive Markdown tables plus HTML and CSV reports</text><text x="620" y="34" class="num">#5</text></g>
<circle cx="380" cy="110" r="15" class="plus"/><path d="M380 103v14M373 110h14" stroke="var(--line)" stroke-width="1.5" stroke-linecap="round"/>
<circle cx="380" cy="206" r="15" class="plus"/><path d="M380 199v14M373 206h14" stroke="var(--line)" stroke-width="1.5" stroke-linecap="round"/>
<circle cx="380" cy="302" r="15" class="plus"/><path d="M380 295v14M373 302h14" stroke="var(--line)" stroke-width="1.5" stroke-linecap="round"/>
<circle cx="380" cy="398" r="15" class="plus"/><path d="M380 391v14M373 398h14" stroke="var(--line)" stroke-width="1.5" stroke-linecap="round"/>
</svg>"""


def _fiscal_year_for(value: date) -> int:
  """Return the CAIPE fiscal year name for a date."""
  return value.year + 1 if value.month >= FISCAL_YEAR_START_MONTH else value.year


def _fiscal_quarter_for(value: date) -> int:
  """Return the CAIPE fiscal quarter for a date."""
  if value.month in {8, 9, 10}:
    return 1
  if value.month in {11, 12, 1}:
    return 2
  if value.month in {2, 3, 4}:
    return 3
  return 4


def _calendar_reference_date(reference_date: str | date | None = None) -> date:
  """Return a safe reference date for generated calendar visuals."""
  if isinstance(reference_date, date):
    return reference_date
  if reference_date:
    try:
      return date.fromisoformat(reference_date)
    except ValueError:
      pass
  return date.today()


def _fiscal_calendar_svg(reference_date: str | date | None = None) -> str:
  """Return an embedded SVG calendar for the current CAIPE fiscal year."""
  reference = _calendar_reference_date(reference_date)
  fiscal_year = _fiscal_year_for(reference)
  fiscal_year_short = str(fiscal_year)[-2:]
  current_quarter = _fiscal_quarter_for(reference)
  current_month = reference.month
  quarter_cards = []

  for quarter in range(1, 5):
    months = FISCAL_CALENDAR_MONTHS[(quarter - 1) * 3:quarter * 3]
    x = 48 + (quarter - 1) * 290
    start_month = months[0][1]
    end_month = months[-1][1]
    start_year = fiscal_year - 1 if start_month >= FISCAL_YEAR_START_MONTH else fiscal_year
    end_year = fiscal_year - 1 if end_month >= FISCAL_YEAR_START_MONTH else fiscal_year
    range_label = (
      f"{months[0][0]} {start_year} - {months[-1][0]} {end_year}"
    )
    quarter_class = "quarter active-quarter" if quarter == current_quarter else "quarter"
    month_tiles = []

    for index, (month_name, month_number) in enumerate(months):
      month_year = fiscal_year - 1 if month_number >= FISCAL_YEAR_START_MONTH else fiscal_year
      tile_x = 16 + index * 76
      month_class = "month active-month" if month_number == current_month else "month"
      month_tiles.append(
        f"""
        <g transform="translate({tile_x} 92)">
          <rect class="{month_class}" width="68" height="58" rx="10"/>
          <text x="34" y="25" text-anchor="middle" class="month-name">{month_name}</text>
          <text x="34" y="45" text-anchor="middle" class="month-year">'{str(month_year)[-2:]}</text>
        </g>"""
      )

    quarter_cards.append(
      f"""
      <g transform="translate({x} 130)">
        <rect class="{quarter_class}" width="252" height="182" rx="14"/>
        <rect width="252" height="8" rx="4" fill="var(--q{quarter})"/>
        <text x="18" y="42" class="quarter-label" fill="var(--q{quarter})">FY{fiscal_year_short}Q{quarter}</text>
        <text x="18" y="66" class="date-range">{range_label}</text>
        {''.join(month_tiles)}
      </g>"""
    )

  return f"""<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="430" viewBox="0 0 1200 430" role="img" aria-labelledby="fy-title fy-desc">
  <title id="fy-title">CAIPE fiscal calendar</title>
  <desc id="fy-desc">CAIPE fiscal year calendar showing Q1 from August to October, Q2 from November to January, Q3 from February to April, and Q4 from May to July.</desc>
  <style>
    :root {{
      color-scheme: light dark;
      --bg:#f8fafc; --panel:#ffffff; --text:#0f172a; --muted:#64748b; --border:#dbeafe;
      --shadow:rgba(15,23,42,.14); --month:#eff6ff; --current:#dcfce7;
      --q1:#14b8a6; --q2:#3b82f6; --q3:#eab308; --q4:#22c55e;
      --glow:rgba(34,197,94,.22);
    }}
    @media (prefers-color-scheme: dark) {{
      :root {{
        --bg:#020617; --panel:#0f172a; --text:#f8fafc; --muted:#cbd5e1; --border:#1e3a8a;
        --shadow:rgba(0,0,0,.45); --month:#172554; --current:#14532d;
        --q1:#2dd4bf; --q2:#60a5fa; --q3:#fbbf24; --q4:#86efac;
        --glow:rgba(134,239,172,.2);
      }}
    }}
    @keyframes focus {{ 0%,100% {{ opacity:.42; transform:scale(1); }} 50% {{ opacity:.95; transform:scale(1.03); }} }}
    text {{ font-family: Inter, Segoe UI, Arial, sans-serif; }}
    .title {{ font-size:27px; font-weight:850; fill:var(--text); }}
    .subtitle {{ font-size:15px; fill:var(--muted); }}
    .quarter {{ fill:var(--panel); stroke:var(--border); stroke-width:1.5; filter:drop-shadow(0 12px 20px var(--shadow)); }}
    .active-quarter {{ stroke:var(--q4); stroke-width:2.5; }}
    .month {{ fill:var(--month); stroke:var(--border); stroke-width:1; }}
    .active-month {{ fill:var(--current); stroke:var(--q4); stroke-width:2; }}
    .quarter-label {{ font-size:27px; font-weight:850; }}
    .date-range {{ font-size:14px; fill:var(--muted); }}
    .month-name {{ font-size:18px; font-weight:800; fill:var(--text); }}
    .month-year {{ font-size:13px; fill:var(--muted); }}
    .callout {{ fill:var(--panel); stroke:var(--border); stroke-width:1.5; }}
    .glow {{ fill:var(--glow); transform-box:fill-box; transform-origin:center; animation:focus 2.2s ease-in-out infinite; }}
    .small {{ font-size:14px; fill:var(--muted); }}
    .strong {{ font-size:16px; font-weight:800; fill:var(--text); }}
    @media (prefers-reduced-motion: reduce) {{
      .glow {{ animation:none; }}
    }}
  </style>
  <rect width="1200" height="430" fill="var(--bg)"/>
  <circle class="glow" cx="1040" cy="69" r="58"/>
  <text x="48" y="55" class="title">CAIPE Fiscal Calendar</text>
  <text x="48" y="86" class="subtitle">Fiscal year starts on August 1 and ends on July 31. Use FY quarter names directly in FinOps report requests.</text>
  <g transform="translate(928 38)">
    <rect class="callout" width="224" height="64" rx="14"/>
    <text x="18" y="27" class="small">Current report period</text>
    <text x="18" y="50" class="strong">FY{fiscal_year_short}Q{current_quarter} - {reference.strftime('%b %d, %Y')}</text>
  </g>
  {''.join(quarter_cards)}
  <g transform="translate(48 348)">
    <rect class="callout" width="1104" height="48" rx="12"/>
    <text x="18" y="30" class="strong">Ask by month, fiscal quarter, last quarter, current quarter, or a custom one/two-month range. The agent turns that period into exact LiteLLM API dates.</text>
  </g>
</svg>"""


def _default_report_type(value: str | None) -> str:
  """Return a supported report type for the FinOps form."""
  if value in REPORT_FORM_REPORT_TYPES:
    return value
  return "usage_and_spend_by_user"


def _report_form_period_options(reference: date | None = None) -> list[str]:
  """Return relative and fiscal period choices for the report form."""
  reference = reference or date.today()
  fiscal_year = _fiscal_year_for(reference)
  years = [fiscal_year - 1, fiscal_year, fiscal_year + 1]
  fiscal_periods = [f"FY{str(year)[-2:]}Q{quarter}" for year in years for quarter in range(1, 5)]
  return [
    "last_quarter",
    "current_quarter",
    *fiscal_periods,
    "custom_date_range",
  ]


def _litellm_report_form_payload(
  default_report_type: str | None = None,
  reference_date: str | None = None,
) -> dict[str, Any]:
  """Build metadata for the existing Dynamic Agents request_user_input form."""
  try:
    reference = _parse_report_date(reference_date) if reference_date else date.today()
  except ValueError:
    reference = date.today()
  report_type = _default_report_type(default_report_type)
  fields = [
    {
      "field_name": "report_type",
      "field_label": "Report type",
      "field_description": "Choose the report the FinOps agent should generate.",
      "field_type": "select",
      "field_values": [
        f"{key} - {config['label']}" for key, config in REPORT_FORM_REPORT_TYPES.items()
      ],
      "required": True,
      "default_value": f"{report_type} - {REPORT_FORM_REPORT_TYPES[report_type]['label']}",
    },
    {
      "field_name": "period",
      "field_label": "Time period",
      "field_description": (
        "Choose a fiscal quarter, relative quarter, or custom_date_range. "
        "Fiscal year runs from August 1 through July 31."
      ),
      "field_type": "select",
      "field_values": _report_form_period_options(reference),
      "required": True,
      "default_value": "last_quarter",
    },
    {
      "field_name": "custom_range",
      "field_label": "Custom date range",
      "field_description": (
        "Only for custom_date_range. Use YYYY-MM-DD to YYYY-MM-DD; max two calendar months."
      ),
      "field_type": "text",
      "required": False,
      "placeholder": "2026-03-01 to 2026-04-30",
    },
    {
      "field_name": "filter_type",
      "field_label": "Filter by",
      "field_description": "Optional. Leave as All for the full report.",
      "field_type": "select",
      "field_values": ["all", "model", "user_id", "api_key"],
      "required": False,
      "default_value": "all",
    },
    {
      "field_name": "filter_value",
      "field_label": "Filter value",
      "field_description": (
        "Only when Filter by is model, user_id, or api_key. Leave blank for all."
      ),
      "field_type": "text",
      "required": False,
      "placeholder": "model name, user email, or token/API key",
    },
  ]
  return {
    "prompt": (
      "Please choose the LiteLLM FinOps report details. "
      "The agent will generate visual HTML and CSV reports by default. "
      "Use custom dates only for one-month or two-month reports."
    ),
    "fields": fields,
  }


def _mcp_public_url() -> str:
  """Return the public MCP URL used for lightweight workflow images."""
  return (
    os.getenv("LITELLM_MCP_PUBLIC_URL")
    or os.getenv("MCP_PUBLIC_URL")
    or "http://localhost:18080"
  ).rstrip("/")


def _finops_workflow_image_markdown() -> str:
  """Return the workflow image URL without sending SVG bytes through the LLM."""
  public_url = _mcp_public_url()
  return f"![FinOps Agent workflow]({public_url}/assets/finops-agent-workflow.svg)"


def _finops_workflow_steps_image_markdown() -> str:
  """Return the vertical workflow description image URL."""
  public_url = _mcp_public_url()
  return (
    f"![FinOps Agent workflow description]"
    f"({public_url}/assets/finops-agent-workflow-steps.svg?v=small)"
  )


def _finops_fiscal_calendar_image_markdown(reference_date: str | date | None = None) -> str:
  """Return an embedded fiscal calendar image that does not depend on UI static assets."""
  encoded = b64encode(_fiscal_calendar_svg(reference_date).encode("utf-8")).decode("ascii")
  return f"![CAIPE Fiscal Calendar](data:image/svg+xml;base64,{encoded})"


def _finops_fiscal_calendar_markdown(reference_date: str | date | None = None) -> str:
  """Return a lightweight fiscal calendar for chat answers."""
  reference = _calendar_reference_date(reference_date)
  fiscal_year = _fiscal_year_for(reference)
  fiscal_year_short = str(fiscal_year)[-2:]
  current_quarter = _fiscal_quarter_for(reference)
  rows = [
    "| Quarter | Month 1 | Month 2 | Month 3 | Exact period |",
    "| --- | --- | --- | --- | --- |",
  ]

  for quarter in range(1, 5):
    months = FISCAL_CALENDAR_MONTHS[(quarter - 1) * 3:quarter * 3]
    month_cells = []
    for month_name, month_number in months:
      month_year = fiscal_year - 1 if month_number >= FISCAL_YEAR_START_MONTH else fiscal_year
      label = f"{month_name} '{str(month_year)[-2:]}"
      if month_number == reference.month:
        label = f"**{label}**"
      month_cells.append(label)

    start_month = months[0][1]
    end_month = months[-1][1]
    start_year = fiscal_year - 1 if start_month >= FISCAL_YEAR_START_MONTH else fiscal_year
    end_year = fiscal_year - 1 if end_month >= FISCAL_YEAR_START_MONTH else fiscal_year
    start = date(start_year, start_month, 1)
    end = date(end_year, end_month, monthrange(end_year, end_month)[1])
    quarter_label = f"FY{fiscal_year_short}Q{quarter}"
    if quarter == current_quarter:
      quarter_label = f"**{quarter_label}**"
    rows.append(
      f"| {quarter_label} | {month_cells[0]} | {month_cells[1]} | {month_cells[2]} | "
      f"`{start.isoformat()}` to `{end.isoformat()}` |"
    )

  return "\n".join(rows)


def _finops_agent_overview_markdown(reference_date: str | None = None) -> str:
  """Return the default "what can you do" answer."""
  return "\n".join(
    [
      "## 🚀 LiteLLM FinOps Command Center",
      "",
      "I turn LiteLLM usage data into clear cost, token, model, user, and API-key reports. "
      "Ask a direct question when you know what you need, or ask for a report and I will open a guided form to collect the details.",
      "",
      "> Best first move: `Generate a LiteLLM report` opens a guided form for report type, period, and optional model, user, or token/API key filter.",
      "",
      "---",
      "",
      _finops_workflow_image_markdown(),
      "",
      "---",
      "",
      "### 🔁 Workflow Description",
      "",
      _finops_workflow_steps_image_markdown(),
      "",
      "---",
      "",
      "### 🧭 Choose Your Path",
      "",
      "| If you want to... | Ask me for... | I will return... |",
      "| --- | --- | --- |",
      "| Understand cost drivers | Spend per LLM/model or user | Ranked tables, chart-ready HTML, and CSV |",
      "| Track adoption | Token usage by model, user, or token | Total, prompt, completion, and cached token breakdowns |",
      "| Audit a consumer | Usage for one user or API key | Filtered usage, spend, requests, and top models |",
      "| Compare periods | Month or CAIPE fiscal-quarter report | Period-aware trend-ready data and downloads |",
      "| Explore the platform | Available LiteLLM models | Model inventory from the LiteLLM proxy |",
      "",
      "---",
      "",
      "### 📊 Report Catalog",
      "",
      "Each report is designed to be readable in chat and useful outside chat:",
      "",
      "| Report | Best for | Includes |",
      "| --- | --- | --- |",
      "| Token usage | Capacity and adoption questions | Top models, top users, total/prompt/completion tokens |",
      "| Spend by model | FinOps cost review | Model spend, requests, total tokens, ranked cost drivers |",
      "| Usage and spend by user | Chargeback/showback and team review | User totals, spend, requests, each user's top models |",
      "| Top models | Fast executive snapshot | Most-used or highest-cost models for the selected period |",
      "| Model inventory | Discovery and validation | Available LiteLLM model list |",
      "",
      "---",
      "",
      "### 🔎 Precision Filters",
      "",
      "You can keep a request broad, or narrow it down with any of these filters:",
      "",
      "| Filter | Supported values |",
      "| --- | --- |",
      "| Time | Month, custom one or two month range, last quarter, current quarter, fiscal quarter |",
      "| Model | One LiteLLM model or all models |",
      "| User | One LiteLLM user or all users |",
      "| Token/API key | One LiteLLM token/API key or all tokens |",
      "| Ranking | `total_tokens`, `spend`, or `requests` |",
      "| Output | Chat table, visual HTML report, CSV export, or all formats |",
      "",
      "---",
      "",
      "### 📅 CAIPE Fiscal Calendar",
      "",
      "Fiscal year starts on August 1 and ends on July 31. The current month is highlighted.",
      "",
      _finops_fiscal_calendar_markdown(reference_date),
      "",
      "---",
      "",
      "### 📦 What You Get Back",
      "",
      "- A concise chat answer with Markdown tables by default.",
      "- A visual HTML report with charts and formatted tables.",
      "- A CSV export for spreadsheet analysis.",
      "- Files written to Grid Files when a report is generated.",
      "",
      "---",
      "",
      "### 💡 High-Value Starter Prompts",
      "",
      "> \"Give me a report on LLM token usage for FY26Q3\"  \n"
      "> \"Show spend per LLM during the last quarter\"  \n"
      "> \"Which users drove the most LiteLLM spend last month?\"  \n"
      "> \"Create a usage and spend report for this user and model\"  \n"
      "> \"Show top model usage for FY26Q4 ranked by total tokens\"  \n"
      "> \"Generate a LiteLLM report\"",
      "",
      "---",
      "",
      "What would you like to understand first: spend, tokens, users, models, or one specific token/API key?",
    ]
  )


def _attach_report_form_hint(
  response: dict[str, Any],
  default_report_type: str | None = None,
) -> dict[str, Any]:
  """Add Dynamic Agents form instructions to recover from missing report inputs."""
  form_request = _litellm_report_form_payload(default_report_type)
  return {
    **response,
    "needs_user_input": True,
    "next_tool": "request_user_input",
    "form_first_required": True,
    "do_not_ask_free_text_followups": True,
    "form_request": form_request,
    "request_user_input_args": {
      "prompt": form_request["prompt"],
      "fields": form_request["fields"],
    },
    "form_instructions": (
      "Do not ask the user to provide missing report inputs in a text reply. "
      "Call the Dynamic Agents built-in request_user_input tool immediately with "
      "form_request.prompt and form_request.fields so the user can complete the "
      "form. After the user submits, normalize report_type by taking the text "
      "before ' - '. If period is custom_date_range, parse custom_range into "
      "start_date and end_date. If filter_type is model, user_id, or api_key, "
      "pass filter_value as that exact tool argument. Call the selected report "
      "tool with report_format='html_csv' unless the user explicitly asks for "
      "markdown or a single file format."
    ),
  }


def get_litellm_report_request_form(
  default_report_type: str | None = None,
  reference_date: str | None = None,
  include_overview: bool = False,
) -> dict[str, Any]:
  """
  Get the structured form definition for a LiteLLM FinOps report request.

  Use this before generating reports when the user asks for a report without
  enough details, or when the user would benefit from selecting report options
  in the chat UI. Pass the returned ``form_request.prompt`` and
  ``form_request.fields`` to the Dynamic Agents built-in ``request_user_input``
  tool, then use the submitted values to call the matching curated report tool.

  Args:
    default_report_type: Optional default report type. Supported values:
      token_usage, spend_by_model, usage_and_spend_by_user, top_models.
    reference_date: Optional YYYY-MM-DD date used to build fiscal period choices.
    include_overview: Include the default FinOps agent overview markdown with
      a lightweight report catalog and fiscal calendar. Use this for
      "what can you do?" questions.

  Returns:
    Form metadata, supported report type mapping, and instructions for routing
    the submitted form values to the curated LiteLLM report tools.
  """
  form_request = _litellm_report_form_payload(default_report_type, reference_date)
  response = {
    "success": True,
    "form_request": form_request,
    "supported_report_types": {
      key: {"label": config["label"], "tool": config["tool"]}
      for key, config in REPORT_FORM_REPORT_TYPES.items()
    },
    "routing_instructions": [
      "Call request_user_input(prompt=form_request.prompt, fields=form_request.fields) to show the form.",
      "Do not ask for missing report fields through a plain text follow-up.",
      "After submission, strip the label suffix from report_type by taking the text before ' - '.",
      "If period is custom_date_range, parse custom_range into start_date and end_date and omit period.",
      "If period is not custom_date_range, call the report tool with period and omit start_date/end_date.",
      "If filter_type is model, user_id, or api_key, pass filter_value as that exact report tool argument.",
      "Call the report tool with report_format='html_csv' unless the user explicitly asks for markdown or a single format.",
      "After the report tool returns, write every item in files_to_write to Grid Files using the returned content exactly.",
      "Do not generate a new HTML template in the chat model; the MCP report content already uses the shared template.",
    ],
  }
  if include_overview:
    response["agent_overview_markdown"] = _finops_agent_overview_markdown(reference_date)
    response["overview_format"] = "markdown"
    response["final_answer_instructions"] = [
      "Use agent_overview_markdown verbatim as the full final answer.",
      "The final answer must start directly with '## 🚀 LiteLLM FinOps Command Center'.",
      "Do not emit any visible text before agent_overview_markdown.",
      "Do not prepend conversational lead-in text such as \"I'll show you what I can do for LiteLLM FinOps reporting.\"",
      "Do not prepend conversational lead-in text such as \"I'll show you the full range of LiteLLM FinOps capabilities.\"",
      "Do not narrate the tool call; return the overview directly.",
    ]
  else:
    response.update(
      {
        "needs_user_input": True,
        "next_tool": "request_user_input",
        "form_first_required": True,
        "do_not_ask_free_text_followups": True,
        "request_user_input_args": {
          "prompt": form_request["prompt"],
          "fields": form_request["fields"],
        },
        "final_answer_instructions": [
          "Do not answer with a text list of missing fields.",
          "Do not ask the user to type period, model, user, or token in a normal chat reply.",
          "Immediately call request_user_input with request_user_input_args so the user can complete the form.",
        ],
      }
    )
  return response


def _format_metric(value: Any, metric: str) -> str:
  """Format metric values for report output."""
  if metric == "spend":
    return f"${_to_float(value):,.2f}"
  return f"{_to_int(value):,}"


def _format_percent(value: float) -> str:
  """Format a percentage for chat report tables."""
  return f"{value:.1f}%"


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
  value = str(report_format or "html_csv").strip().lower()
  aliases = {
    "all": "all",
    "default": "html_csv",
    "md": "markdown",
    "markdown": "markdown",
    "html": "html",
    "csv": "csv",
    "html_csv": "html_csv",
    "html+csv": "html_csv",
    "html,csv": "html_csv",
    "both": "html_csv",
  }
  normalized = aliases.get(value, value)
  return normalized if normalized in REPORT_FORMATS else "html_csv"


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


def _chart_markdown_table(chart: dict[str, Any], limit: int = CHART_LIMIT) -> str:
  """Build a Markdown table from chart data without ASCII/Unicode bars."""
  rows = chart.get("data") or []
  title = str(chart.get("title") or "Chart Data")
  lines = [
    f"### {title}",
    "",
    "| Rank | Name | Value |",
    "| --- | --- | ---: |",
  ]
  if not rows:
    lines.append("| - | No data | - |")
    return "\n".join(lines)

  for index, row in enumerate(rows[:limit], start=1):
    value = row.get("formatted_value") or _format_metric(row.get("value"), str(chart.get("metric") or "value"))
    lines.append(
      "| "
      + " | ".join(
        [
          str(index),
          _markdown_cell(_truncate_text(row.get("label"), 64)),
          _markdown_cell(value),
        ]
      )
      + " |"
    )
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


def _markdown_cell(value: Any) -> str:
  """Escape a value for use inside a Markdown table cell."""
  return str(value).replace("|", "\\|")


def _chat_kpi_snapshot(report: dict[str, Any]) -> str:
  """Build a dashboard-style KPI snapshot for chat answers."""
  totals = report.get("totals") or {}
  metrics = [
    ("Total Spend", _format_metric(totals.get("spend"), "spend")),
    ("Total Tokens", _format_metric(totals.get("total_tokens"), "total_tokens")),
    ("Prompt Tokens", _format_metric(totals.get("prompt_tokens"), "prompt_tokens")),
    ("Completion Tokens", _format_metric(totals.get("completion_tokens"), "completion_tokens")),
    ("Requests", _format_metric(totals.get("requests"), "requests")),
  ]
  lines = [
    "### KPI Snapshot",
    "",
    "| " + " | ".join(label for label, _ in metrics) + " |",
    "| " + " | ".join("---" for _ in metrics) + " |",
    "| " + " | ".join(_markdown_cell(value) for _, value in metrics) + " |",
  ]
  return "\n".join(lines)


def _chat_chart_snapshot(
  charts: list[dict[str, Any]],
  report: dict[str, Any],
  limit: int = 5,
) -> str:
  """Build chart-like ranked tables for chat answers."""
  totals = report.get("totals") or {}
  sections = []
  for chart in charts[:2]:
    rows = chart.get("data") or []
    metric = str(chart.get("metric") or "value")
    total = _to_float(totals.get(metric))
    if total <= 0:
      total = sum(_to_float(row.get("value")) for row in rows)

    lines = [
      f"#### {chart.get('title') or 'Chart'}",
      "",
      "| Rank | Name | Value | Share |",
      "| --- | --- | ---: | ---: |",
    ]
    if not rows:
      lines.append("| - | No data | - | - |")
    for index, row in enumerate(rows[:limit], start=1):
      value = _to_float(row.get("value"))
      share = _format_percent((value / total) * 100) if total else "0.0%"
      lines.append(
        "| "
        + " | ".join(
          [
            str(index),
            _markdown_cell(_truncate_text(row.get("label"), 56)),
            _markdown_cell(row.get("formatted_value") or _format_metric(value, metric)),
            share,
          ]
        )
        + " |"
      )
    sections.append("\n".join(lines))

  if not sections:
    return ""

  return "\n\n".join(["### Visual Snapshot", *sections])


def _chat_data_tables(tables: list[dict[str, Any]]) -> list[dict[str, str]]:
  """Build chat-friendly markdown tables from report tables."""
  chat_tables = []
  for table in tables:
    title = str(table.get("title") or "Report Data")
    rows = table.get("rows") or []
    columns = table.get("columns") or []
    if not columns:
      continue
    chat_tables.append(
      {
        "title": title,
        "content": _markdown_table(
          title,
          rows,
          columns,
          limit=CHAT_TABLE_LIMIT,
        ),
      }
    )
  return chat_tables


def _default_chat_markdown(
  title: str,
  report: dict[str, Any],
  chat_tables: list[dict[str, str]],
  charts: list[dict[str, Any]] | None = None,
) -> str:
  """Build a dashboard-style chat answer that mirrors the HTML report shape."""
  lines = [
    f"## {title}",
    "",
    f"**Period:** {_report_period(report)}",
    "",
    _chat_kpi_snapshot(report),
    "",
  ]
  chart_snapshot = _chat_chart_snapshot(charts or [], report)
  if chart_snapshot:
    lines.extend([chart_snapshot, ""])
  if chat_tables:
    lines.extend(["### Detailed Tables", ""])
  for table in chat_tables[:2]:
    lines.extend([table["content"], ""])
  warnings = report.get("warnings") or []
  if warnings:
    lines.extend(["### Warnings", ""])
    lines.extend(f"- {warning}" for warning in warnings)
    lines.append("")
  return "\n".join(lines).rstrip()


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
  """Build a downloadable markdown report with chart data tables."""
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
    "## Chart Data",
    "",
  ]
  for chart in charts:
    lines.extend([_chart_markdown_table(chart), ""])
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


def _metric_card(label: str, value: str, hint: str) -> str:
  """Render one stable summary metric card for the shared HTML template."""
  return (
    '<article class="metric-card">'
    f'<div class="metric-label">{escape(label)}</div>'
    f'<div class="metric-value">{escape(value)}</div>'
    f'<div class="metric-hint">{escape(hint)}</div>'
    "</article>"
  )


def _render_shared_html_report_template(
  title: str,
  report: dict[str, Any],
  charts: list[dict[str, Any]],
  tables: list[dict[str, Any]],
) -> str:
  """Render every LiteLLM report through the same compact HTML template."""
  totals = report.get("totals") or {}
  metrics = "".join(
    [
      _metric_card("Total spend", _format_metric(totals.get("spend"), "spend"), "LiteLLM reported cost"),
      _metric_card(
        "Total tokens",
        _format_metric(totals.get("total_tokens"), "total_tokens"),
        "Prompt and completion tokens",
      ),
      _metric_card(
        "Prompt tokens",
        _format_metric(totals.get("prompt_tokens"), "prompt_tokens"),
        "Input tokens sent to models",
      ),
      _metric_card(
        "Completion tokens",
        _format_metric(totals.get("completion_tokens"), "completion_tokens"),
        "Output tokens generated",
      ),
      _metric_card(
        "Requests",
        _format_metric(totals.get("requests"), "requests"),
        "LiteLLM calls included",
      ),
    ]
  )
  chart_html = _html_charts(charts)
  table_html = "".join(_html_table(table["title"], table["rows"], table["columns"]) for table in tables)
  notes_html = _html_report_notes(report)
  return (
    "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"/>"
    "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"/>"
    f"<meta name=\"x-report-template\" content=\"{HTML_REPORT_TEMPLATE_VERSION}\"/>"
    f"<title>{escape(title)}</title><style>{HTML_REPORT_STYLE}</style></head><body>"
    '<main class="report"><header>'
    '<div class="eyebrow">LiteLLM FinOps Report</div>'
    f"<h1>{escape(title)}</h1>"
    '<p class="subtitle">Usage, spend, and token analytics generated by the Grid FinOps agent.</p>'
    '<div class="pills">'
    f"<span>Period: {escape(_report_period(report))}</span>"
    f"<span>Source: {escape(str(report.get('source') or 'LiteLLM'))}</span>"
    f"<span>Complete: {'yes' if report.get('is_complete') else 'no'}</span>"
    f"<span>Template: {HTML_REPORT_TEMPLATE_VERSION}</span>"
    "</div></header>"
    f'<div class="content"><section class="summary-grid" aria-label="Summary metrics">{metrics}</section>'
    f"{chart_html}{table_html}{notes_html}</div>"
    '<footer class="footer">Generated by Grid FinOps agent using the LiteLLM MCP server.</footer>'
    "</main></body></html>"
  )


def _build_html_report(
  title: str,
  report: dict[str, Any],
  charts: list[dict[str, Any]],
  tables: list[dict[str, Any]],
) -> str:
  """Build a downloadable HTML report with inline SVG charts."""
  return _render_shared_html_report_template(title, report, charts, tables)

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
  slug = _report_slug(report)
  safe_report_format = _safe_report_format(report_format)
  downloadable_reports = []
  if safe_report_format in {"markdown", "all"}:
    markdown_report = _build_markdown_report(title, report, charts, tables)
    downloadable_reports.append(
      {
        "path": f"/reports/{slug}.md",
        "mime_type": "text/markdown",
        "content": markdown_report,
      }
    )
  if safe_report_format in {"html", "html_csv", "all"}:
    html_report = _build_html_report(title, report, charts, tables)
    downloadable_reports.append(
      {
        "path": f"/reports/{slug}.html",
        "mime_type": "text/html",
        "content": html_report,
      }
    )
  if safe_report_format in {"csv", "html_csv", "all"}:
    csv_report = _build_csv_report(title, report, tables)
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
  chat_tables = _chat_data_tables(tables)
  final_answer_markdown = _default_chat_markdown(title, report, chat_tables, charts)
  return {
    **report,
    "final_answer_markdown": final_answer_markdown,
    "final_answer_policy": {
      "required": True,
      "visualizations_in_chat_by_default": True,
      "instruction": (
        "For every LiteLLM FinOps report, the final chat answer must use "
        "final_answer_markdown as the main answer, even when the user did not "
        "explicitly ask for graphs. Do not replace it with a prose-only summary. "
        "Keep the Visual Snapshot and Detailed Tables sections in the chat answer."
      ),
    },
    "chat_response": {
      "format": "markdown_tables",
      "required": True,
      "visualizations_in_chat_by_default": True,
      "instruction": (
        "Use default_markdown for the final chat answer for every report request, "
        "even when the user did not explicitly ask for graphs. It is a dashboard-style "
        "Markdown report with KPI snapshot, Visual Snapshot, and detailed tables. Prefer "
        "it over numbered lists or prose-only summaries. Never generate ASCII or Unicode "
        "bar charts in chat, and never repeat bar/dash characters to draw graphs. If the "
        "user asks for a graph or visualization, write the provided HTML report file exactly "
        "as returned in files_to_write and mention that the visual graph is available there. "
        "Do not create a new HTML template in the chat model. Mention Grid Files only after "
        "write_file succeeds."
      ),
      "default_markdown": final_answer_markdown,
      "tables": chat_tables,
      "max_rows_per_table": CHAT_TABLE_LIMIT,
    },
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
      "html_template_version": HTML_REPORT_TEMPLATE_VERSION,
      "paths": file_write_paths,
      "available_paths": report_paths,
      "instruction": (
        "These report files are generated templates only. They are not visible in the Grid "
        "Files section until the agent calls write_file. For any LiteLLM FinOps report request, "
        "write every file in files_to_write by default so the user gets both the visual HTML report with "
        "graphs and the CSV export, even if they did not explicitly ask for CSV or graphs. "
        "Use the returned file content exactly; do not design or generate a new HTML report template. "
        "Only say the reports are in Files after every write_file call succeeds."
      ),
    },
    "files_to_write": files_to_write,
    "visualizations": {
      "chart_data": charts,
      "markdown_tables": chat_tables,
      "chart_rendering_guidance": (
        "Use chart_data for structured processing and the HTML report for visual graphs. "
        "Do not paste ASCII or Unicode bar charts into chat."
      ),
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
  api_key: str | None = None,
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
    if api_key:
      params["api_key"] = api_key

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
  api_key: str | None = None,
) -> dict[str, Any]:
  """Resolve dates, fetch aggregate data, and return a common report envelope."""
  window, start, end = _resolve_report_window(start_date, end_date, period, reference_date)
  if not window or not window.get("success"):
    return _attach_report_form_hint(
      window or {"success": False, "error": "Could not resolve report window."},
      report_type,
    )

  rollup = await _fetch_activity_rollup(start, end, model=model, user_id=user_id, api_key=api_key)
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
      "api_key": "***" if api_key else None,
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
  model: str | None = None,
  user_id: str | None = None,
  api_key: str | None = None,
  reference_date: str | None = None,
  report_format: str = "html_csv",
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
    model: Optional model filter.
    user_id: Optional LiteLLM user_id filter.
    api_key: Optional LiteLLM API key/token filter.
    reference_date: Optional YYYY-MM-DD date for resolving relative quarters.
    report_format: Downloadable report format: html_csv, html, csv, markdown, or all.

  Returns:
    Token usage totals with top models, top users, chat-ready tables, HTML
    visualizations, and CSV report templates under ``visualizations``.
  """
  safe_limit = _safe_limit(limit)
  report = await _build_aggregate_report(
    "token_usage",
    start_date,
    end_date,
    period,
    reference_date,
    model=model,
    user_id=user_id,
    api_key=api_key,
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
  model: str | None = None,
  user_id: str | None = None,
  api_key: str | None = None,
  reference_date: str | None = None,
  report_format: str = "html_csv",
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
    model: Optional model filter.
    user_id: Optional LiteLLM user_id filter.
    api_key: Optional LiteLLM API key/token filter.
    reference_date: Optional YYYY-MM-DD date for resolving relative quarters.
    report_format: Downloadable report format: html_csv, html, csv, markdown, or all.

  Returns:
    Spend and token usage by model, chat-ready tables, HTML visualizations,
    and CSV report templates under ``visualizations``.
  """
  safe_limit = _safe_limit(limit)
  safe_rank_by = rank_by if rank_by in {"spend", "total_tokens", "requests"} else "spend"
  report = await _build_aggregate_report(
    "spend_by_model",
    start_date,
    end_date,
    period,
    reference_date,
    model=model,
    user_id=user_id,
    api_key=api_key,
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
  api_key: str | None = None,
  reference_date: str | None = None,
  report_format: str = "html_csv",
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
    api_key: Optional LiteLLM API key/token filter.
    reference_date: Optional YYYY-MM-DD date for resolving relative quarters.
    report_format: Downloadable report format: html_csv, html, csv, markdown, or all.

  Returns:
    Token usage and spend by user, each user's top models, chat-ready tables,
    HTML visualizations, and CSV report templates under ``visualizations``.
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
    api_key=api_key,
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
  model: str | None = None,
  user_id: str | None = None,
  api_key: str | None = None,
  reference_date: str | None = None,
  report_format: str = "html_csv",
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
    model=model,
    user_id=user_id,
    api_key=api_key,
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
  api_key: str | None = None,
  reference_date: str | None = None,
  report_format: str = "html_csv",
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
    api_key=api_key,
    reference_date=reference_date,
    report_format=report_format,
  )
