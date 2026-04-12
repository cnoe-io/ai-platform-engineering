/**
 * Headless output formatter (T042).
 *
 * text:   raw token text to stdout as it arrives
 * json:   accumulate then emit single JSON blob on completion
 * ndjson: one JSON object per StreamEvent as it arrives
 *
 * Errors always go to stderr as {"error":"..."} regardless of format.
 */

import type { StreamEvent } from "../chat/stream.js";

export type OutputFormat = "text" | "json" | "ndjson";

export interface OutputWriter {
  write(event: StreamEvent): void;
  flush(agentName: string, protocol: string): void;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createOutputWriter(format: OutputFormat): OutputWriter {
  switch (format) {
    case "text":
      return new TextWriter();
    case "json":
      return new JsonWriter();
    case "ndjson":
      return new NdjsonWriter();
  }
}

// ---------------------------------------------------------------------------
// Text writer
// ---------------------------------------------------------------------------

class TextWriter implements OutputWriter {
  write(event: StreamEvent): void {
    if (event.type === "token") {
      process.stdout.write(event.text);
    }
    if (event.type === "error") {
      process.stderr.write(JSON.stringify({ error: event.message }) + "\n");
    }
  }

  flush(_agentName: string, _protocol: string): void {
    // Ensure final newline
    process.stdout.write("\n");
  }
}

// ---------------------------------------------------------------------------
// JSON writer
// ---------------------------------------------------------------------------

class JsonWriter implements OutputWriter {
  private accumulated = "";
  private agentName = "default";
  private protocol = "a2a";

  write(event: StreamEvent): void {
    if (event.type === "token") {
      this.accumulated += event.text;
    }
    if (event.type === "error") {
      process.stderr.write(JSON.stringify({ error: event.message }) + "\n");
    }
  }

  flush(agentName: string, protocol: string): void {
    process.stdout.write(
      JSON.stringify({ response: this.accumulated, agent: agentName, protocol }) + "\n",
    );
  }
}

// ---------------------------------------------------------------------------
// NDJSON writer
// ---------------------------------------------------------------------------

class NdjsonWriter implements OutputWriter {
  write(event: StreamEvent): void {
    if (event.type === "token") {
      process.stdout.write(JSON.stringify({ type: "token", text: event.text }) + "\n");
    } else if (event.type === "done") {
      process.stdout.write(JSON.stringify({ type: "done" }) + "\n");
    } else if (event.type === "error") {
      process.stderr.write(JSON.stringify({ error: event.message }) + "\n");
    } else if (event.type === "tool") {
      process.stdout.write(JSON.stringify({ type: "tool", name: event.name }) + "\n");
    } else if (event.type === "started") {
      process.stdout.write(JSON.stringify({ type: "started" }) + "\n");
    }
  }

  flush(_agentName: string, _protocol: string): void {
    // done event already emitted by write()
  }
}
