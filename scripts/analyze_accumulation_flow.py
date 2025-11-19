#!/usr/bin/env python3
"""
Analyze content accumulation flow for AI Platform Engineer agent queries.

This script:
1. Sends a curl request to the agent with a given query
2. Parses all streaming events (artifacts, status updates)
3. Tracks content accumulation in sub-agent and supervisor
4. Generates a comprehensive markdown report showing the flow

Usage:
    python scripts/analyze_accumulation_flow.py "What is CAIPE?"
    python scripts/analyze_accumulation_flow.py "What is CAIPE?" --host localhost --port 8099
    python scripts/analyze_accumulation_flow.py "What is CAIPE?" --output /tmp/analysis.md
"""

import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Dict, List, Any, Optional
from datetime import datetime


def run_curl_query(query: str, host: str = "localhost", port: int = 8099, timeout: int = 60) -> str:
    """Run curl command to send query to agent and return raw response."""
    url = f"http://{host}:{port}"
    payload = {
        "id": f"test-{datetime.now().timestamp()}",
        "method": "message/stream",
        "params": {
            "message": {
                "role": "user",
                "parts": [{"kind": "text", "text": query}],
                "messageId": f"msg-test-{datetime.now().timestamp()}"
            }
        }
    }

    cmd = [
        "curl",
        "-X", "POST",
        url,
        "-H", "Content-Type: application/json",
        "-H", "Accept: text/event-stream",
        "-d", json.dumps(payload),
        "--max-time", str(timeout),
        "--silent",
        "--show-error"
    ]

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout + 10)
        if result.returncode != 0:
            print(f"Error running curl: {result.stderr}", file=sys.stderr)
            sys.exit(1)
        return result.stdout
    except subprocess.TimeoutExpired:
        print(f"Error: Request timed out after {timeout} seconds", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Error running curl: {e}", file=sys.stderr)
        sys.exit(1)


def parse_events(content: str) -> List[Dict[str, Any]]:
    """Parse SSE events from curl response."""
    events = []
    for line in content.split('\n'):
        if line.startswith('data:'):
            try:
                event_data = json.loads(line[5:].strip())
                events.append(event_data)
            except json.JSONDecodeError:
                continue
    return events


def analyze_accumulation(events: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Analyze content accumulation from events."""
    accumulation_log = []
    sub_agent_accumulated = []
    supervisor_accumulated = []
    final_content = None
    partial_result_content = None
    status_updates = []
    artifact_updates = []

    for i, event in enumerate(events):
        result = event.get('result', {})
        kind = result.get('kind', '')

        if kind == 'artifact-update':
            artifact = result.get('artifact', {})
            artifact_name = artifact.get('name', '')
            artifact_id = artifact.get('artifactId', '')
            parts = artifact.get('parts', [])
            append = result.get('append', False)
            last_chunk = result.get('lastChunk', False)

            artifact_text = ''
            for part in parts:
                if isinstance(part, dict):
                    text = part.get('text', '')
                    if text:
                        artifact_text += text
                        if artifact_name == 'streaming_result':
                            sub_agent_accumulated.append(text)
                        elif artifact_name == 'partial_result':
                            partial_result_content = text if not partial_result_content else partial_result_content + text
                        elif artifact_name == 'final_result':
                            final_content = text if not final_content else final_content + text

            if artifact_text:
                accumulation_log.append({
                    'step': len(accumulation_log) + 1,
                    'event_type': f'artifact-update ({artifact_name})',
                    'artifact_id': artifact_id[:8] + '...' if len(artifact_id) > 8 else artifact_id,
                    'append': append,
                    'last_chunk': last_chunk,
                    'content_chunk': artifact_text,  # No truncation
                    'sub_agent_accumulated': ''.join(sub_agent_accumulated),  # No truncation
                    'supervisor_accumulated': ''.join(supervisor_accumulated),  # No truncation
                    'total_sub_agent': len(''.join(sub_agent_accumulated)),
                    'total_supervisor': len(''.join(supervisor_accumulated))
                })

                artifact_updates.append({
                    'name': artifact_name,
                    'id': artifact_id,
                    'append': append,
                    'last_chunk': last_chunk,
                    'text_length': len(artifact_text)
                })

        elif kind == 'status-update':
            status = result.get('status', {})
            message = status.get('message', {}) if isinstance(status, dict) else {}
            parts = message.get('parts', []) if isinstance(message, dict) else []
            status_text = ''
            for part in parts:
                if isinstance(part, dict) and part.get('text'):
                    status_text += part.get('text', '')

            if status_text or result.get('final', False):
                status_updates.append({
                    'state': status.get('state', '') if isinstance(status, dict) else '',
                    'final': result.get('final', False),
                    'text': status_text[:500] if status_text else '',
                    'text_length': len(status_text)
                })

    return {
        'accumulation_log': accumulation_log,
        'sub_agent_accumulated': sub_agent_accumulated,
        'supervisor_accumulated': supervisor_accumulated,
        'final_content': final_content,
        'partial_result_content': partial_result_content,
        'status_updates': status_updates,
        'artifact_updates': artifact_updates
    }


def generate_markdown_report(query: str, analysis: Dict[str, Any], output_file: Optional[str] = None) -> str:
    """Generate markdown report from analysis."""
    accumulation_log = analysis['accumulation_log']
    sub_agent_accumulated = analysis['sub_agent_accumulated']
    supervisor_accumulated = analysis['supervisor_accumulated']
    final_content = analysis['final_content']
    partial_result_content = analysis['partial_result_content']
    status_updates = analysis['status_updates']
    artifact_updates = analysis['artifact_updates']

    sub_agent_full = ''.join(sub_agent_accumulated)
    supervisor_full = ''.join(supervisor_accumulated)

    # Count artifacts by type
    artifact_counts = {}
    for artifact in artifact_updates:
        name = artifact['name']
        artifact_counts[name] = artifact_counts.get(name, 0) + 1

    markdown = f"""# Content Accumulation Flow Analysis

**Query**: "{query}"
**Generated**: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}

## Summary

- **Total Sub-Agent Accumulated**: {len(sub_agent_full)} chars
- **Total Supervisor Accumulated**: {len(supervisor_full)} chars
- **Partial Result Length**: {len(partial_result_content) if partial_result_content else 0} chars
- **Final Result Length**: {len(final_content) if final_content else 0} chars
- **Total Streaming Events**: {len(accumulation_log)}
- **Status Updates**: {len(status_updates)}

### Artifact Breakdown

"""

    for artifact_name, count in artifact_counts.items():
        markdown += f"- **{artifact_name}**: {count} events\n"

    markdown += "\n## Accumulation Flow\n\n"
    markdown += "| Step | Event Type | Artifact ID | Append | Last Chunk | Content Chunk | Sub-Agent Accumulated | Supervisor Accumulated | Sub-Agent Total | Supervisor Total |\n"
    markdown += "|------|------------|-------------|--------|------------|---------------|------------------------|------------------------|-----------------|------------------|\n"

    # Show first 50 and last 10
    show_first = 50
    show_last = 10

    for i, log in enumerate(accumulation_log[:show_first]):
        markdown += "| {} | {} | {} | {} | {} | {} | {} | {} | {} | {} |\n".format(
            log['step'],
            log['event_type'],
            log.get('artifact_id', ''),
            log.get('append', False),
            log.get('last_chunk', False),
            log['content_chunk'].replace('|', '\\|').replace('\n', ' '),
            log['sub_agent_accumulated'].replace('|', '\\|').replace('\n', ' '),
            log['supervisor_accumulated'].replace('|', '\\|').replace('\n', ' '),
            log['total_sub_agent'],
            log['total_supervisor']
        )

    if len(accumulation_log) > show_first:
        markdown += "| ... | ... | ... | ... | ... | ... | ... | ... | ... | ... |\n"
        for log in accumulation_log[-show_last:]:
            markdown += "| {} | {} | {} | {} | {} | {} | {} | {} | {} | {} |\n".format(
                log['step'],
                log['event_type'],
                log.get('artifact_id', ''),
                log.get('append', False),
                log.get('last_chunk', False),
                log['content_chunk'].replace('|', '\\|').replace('\n', ' '),
                log['sub_agent_accumulated'].replace('|', '\\|').replace('\n', ' '),
                log['supervisor_accumulated'].replace('|', '\\|').replace('\n', ' '),
                log['total_sub_agent'],
                log['total_supervisor']
            )

    # Status updates section
    if status_updates:
        markdown += "\n## Status Updates\n\n"
        for i, status in enumerate(status_updates):
            markdown += f"### Status Update {i+1}\n"
            markdown += f"- **State**: {status['state']}\n"
            markdown += f"- **Final**: {status['final']}\n"
            if status['text']:
                markdown += f"- **Text Length**: {status['text_length']} chars\n"
                markdown += f"- **Text**: {status['text']}\n"
            markdown += "\n"

    # Content comparison section
    markdown += "\n## Content Comparison\n\n"

    if sub_agent_full:
        markdown += f"### Sub-Agent Full Content ({len(sub_agent_full)} chars)\n"
        markdown += f"```\n{sub_agent_full}\n```\n\n"

    if supervisor_full:
        markdown += f"### Supervisor Full Content ({len(supervisor_full)} chars)\n"
        markdown += f"```\n{supervisor_full}\n```\n\n"

    if partial_result_content:
        markdown += f"### Partial Result Content ({len(partial_result_content)} chars)\n"
        markdown += f"```\n{partial_result_content}\n```\n\n"

        # Check for duplicates
        if sub_agent_full:
            if sub_agent_full in partial_result_content:
                markdown += "⚠️ **DUPLICATE DETECTED**: Sub-agent content is contained in partial_result\n\n"
            elif partial_result_content in sub_agent_full:
                markdown += "⚠️ **DUPLICATE DETECTED**: Partial_result content is contained in sub-agent content\n\n"
            else:
                markdown += "✅ No exact duplicate detected between sub-agent and partial_result\n\n"

    if final_content:
        markdown += f"### Final Result Content ({len(final_content)} chars)\n"
        markdown += f"```\n{final_content}\n```\n\n"

        # Check for duplicates
        if sub_agent_full:
            if sub_agent_full in final_content:
                markdown += "⚠️ **DUPLICATE DETECTED**: Sub-agent content is contained in final_result\n\n"
            elif final_content in sub_agent_full:
                markdown += "⚠️ **DUPLICATE DETECTED**: Final_result content is contained in sub-agent content\n\n"

    # Check status updates for duplicates
    for i, status in enumerate(status_updates):
        if status['text'] and sub_agent_full:
            if sub_agent_full in status['text']:
                markdown += f"⚠️ **DUPLICATE IN STATUS UPDATE {i+1}**: Sub-agent content found in status update text\n\n"
            elif status['text'] in sub_agent_full:
                markdown += f"⚠️ **DUPLICATE IN STATUS UPDATE {i+1}**: Status update text found in sub-agent content\n\n"

    # Artifact details
    if artifact_updates:
        markdown += "\n## Artifact Details\n\n"
        markdown += "| Artifact Name | Count | Total Text Length |\n"
        markdown += "|---------------|-------|-------------------|\n"

        artifact_stats = {}
        for artifact in artifact_updates:
            name = artifact['name']
            if name not in artifact_stats:
                artifact_stats[name] = {'count': 0, 'total_length': 0}
            artifact_stats[name]['count'] += 1
            artifact_stats[name]['total_length'] += artifact['text_length']

        for name, stats in artifact_stats.items():
            markdown += f"| {name} | {stats['count']} | {stats['total_length']} chars |\n"

    return markdown


def main():
    parser = argparse.ArgumentParser(
        description='Analyze content accumulation flow for AI Platform Engineer agent queries',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__
    )
    parser.add_argument('query', nargs='?', default='What is CAIPE?', help='Query to send to the agent')
    parser.add_argument('--host', default='localhost', help='Agent host (default: localhost)')
    parser.add_argument('--port', type=int, default=8099, help='Agent port (default: 8099)')
    parser.add_argument('--timeout', type=int, default=60, help='Request timeout in seconds (default: 60)')
    parser.add_argument('--output', '-o', help='Output markdown file (default: /tmp/accumulation_flow_<timestamp>.md)')
    parser.add_argument('--save-raw', help='Save raw curl response to file')

    args = parser.parse_args()

    print(f"🔍 Analyzing query: \"{args.query}\"")
    print(f"📡 Connecting to {args.host}:{args.port}...")

    # Run curl query
    raw_response = run_curl_query(args.query, args.host, args.port, args.timeout)

    if args.save_raw:
        with open(args.save_raw, 'w') as f:
            f.write(raw_response)
        print(f"💾 Raw response saved to {args.save_raw}")

    # Parse events
    print("📊 Parsing events...")
    events = parse_events(raw_response)
    print(f"✅ Parsed {len(events)} events")

    # Analyze accumulation
    print("🔬 Analyzing accumulation flow...")
    analysis = analyze_accumulation(events)
    print(f"✅ Found {len(analysis['accumulation_log'])} accumulation steps")

    # Generate markdown report
    print("📝 Generating markdown report...")
    markdown = generate_markdown_report(args.query, analysis)

    # Save to file
    if args.output:
        output_file = args.output
    else:
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        output_file = f"/tmp/accumulation_flow_{timestamp}.md"

    with open(output_file, 'w') as f:
        f.write(markdown)

    print(f"✅ Report saved to {output_file}")
    print(f"\n📊 Summary:")
    print(f"   - Sub-agent content: {len(''.join(analysis['sub_agent_accumulated']))} chars")
    print(f"   - Supervisor content: {len(''.join(analysis['supervisor_accumulated']))} chars")
    print(f"   - Accumulation steps: {len(analysis['accumulation_log'])}")
    print(f"   - Status updates: {len(analysis['status_updates'])}")


if __name__ == '__main__':
    main()

