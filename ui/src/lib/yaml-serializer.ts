/**
 * Simple YAML serializer for agent config export.
 * Uses JSON.stringify for safe string escaping to prevent injection.
 * assisted-by claude code claude-sonnet-4-6
 */

export function toYaml(obj: Record<string, unknown>, indent = 0): string {
  const spaces = "  ".repeat(indent);
  let yaml = "";

  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null) continue;

    if (typeof value === "string") {
      if (value.includes("\n")) {
        yaml += `${spaces}${key}: |\n`;
        value.split("\n").forEach((line) => {
          yaml += `${spaces}  ${line}\n`;
        });
      } else {
        const needsQuotes = /[:#\[\]{}|>!&*?'"]/.test(value) || value === "";
        yaml += `${spaces}${key}: ${needsQuotes ? JSON.stringify(value) : value}\n`;
      }
    } else if (typeof value === "number" || typeof value === "boolean") {
      yaml += `${spaces}${key}: ${value}\n`;
    } else if (Array.isArray(value)) {
      if (value.length === 0) continue;
      yaml += `${spaces}${key}:\n`;
      value.forEach((item) => {
        if (typeof item === "object" && item !== null) {
          yaml += `${spaces}  -\n`;
          yaml += toYaml(item as Record<string, unknown>, indent + 2);
        } else {
          yaml += `${spaces}  - ${item}\n`;
        }
      });
    } else if (typeof value === "object") {
      yaml += `${spaces}${key}:\n`;
      yaml += toYaml(value as Record<string, unknown>, indent + 1);
    }
  }

  return yaml;
}
