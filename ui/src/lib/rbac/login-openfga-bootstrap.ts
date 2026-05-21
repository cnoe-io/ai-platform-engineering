import { writeOpenFgaTuples, type OpenFgaTupleKey } from "@/lib/rbac/openfga";
import { organizationObjectId } from "@/lib/rbac/organization";

export type LoginOpenFgaBootstrapStatus = "skipped" | "completed" | "failed";

export interface LoginOpenFgaBootstrapResult {
  status: LoginOpenFgaBootstrapStatus;
  tuple_write_count: number;
  warning?: string;
}

export interface LoginOpenFgaBootstrapInput {
  subject?: string;
  email?: string;
  isAuthorized: boolean;
  isAdmin: boolean;
}

function baselineTuples(subject: string): OpenFgaTupleKey[] {
  return [
    { user: `user:${subject}`, relation: "member", object: organizationObjectId() },
    { user: `user:${subject}`, relation: "reader", object: "system_config:platform_settings" },
  ];
}

function adminTuples(subject: string): OpenFgaTupleKey[] {
  return [
    { user: `user:${subject}`, relation: "admin", object: organizationObjectId() },
    { user: `user:${subject}`, relation: "manager", object: "system_config:platform_settings" },
  ];
}

export async function reconcileLoginOpenFgaAccess(
  input: LoginOpenFgaBootstrapInput
): Promise<LoginOpenFgaBootstrapResult> {
  const subject = input.subject?.trim();
  if (!input.isAuthorized || !subject) {
    return { status: "skipped", tuple_write_count: 0 };
  }

  const writes = input.isAdmin
    ? [...baselineTuples(subject), ...adminTuples(subject)]
    : baselineTuples(subject);

  try {
    const result = await writeOpenFgaTuples({ writes, deletes: [] });
    return { status: "completed", tuple_write_count: result.writes };
  } catch (error) {
    const warning = error instanceof Error ? error.message : String(error);
    console.warn(
      `[LoginOpenFGA] Failed to bootstrap OpenFGA access for ${input.email ?? subject}: ${warning}`
    );
    return { status: "failed", tuple_write_count: 0, warning };
  }
}
