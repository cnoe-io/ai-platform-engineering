export interface AdminSimulationQueryTarget {
  type: "user" | "team";
  id: string;
  relation?: "member" | "admin";
}

/** Add a View As subject to a relative BFF URL without dropping existing query parameters. */
export function withAdminSimulationParams(
  path: string,
  target?: AdminSimulationQueryTarget | null,
): string {
  if (!target?.id) return path;

  const [base, rawQuery = ""] = path.split("?", 2);
  const params = new URLSearchParams(rawQuery);
  params.set("simulate_type", target.type);
  params.set("simulate_id", target.id);
  if (target.type === "team" && target.relation) {
    params.set("simulate_relation", target.relation);
  } else {
    params.delete("simulate_relation");
  }
  return `${base}?${params.toString()}`;
}

/** Set one query value on a relative URL, preserving any View As parameters. */
export function withQueryParam(path: string, key: string, value: string): string {
  const [base, rawQuery = ""] = path.split("?", 2);
  const params = new URLSearchParams(rawQuery);
  params.set(key, value);
  return `${base}?${params.toString()}`;
}
