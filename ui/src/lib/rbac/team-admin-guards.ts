import { ApiError, requireRbacPermission } from "@/lib/api-middleware";

interface TeamLike {
  members?: Array<{ user_id?: string; role?: string }>;
}

function isScopedTeamAdmin(email: string | undefined, team: TeamLike): boolean {
  if (!email) return false;
  const normalized = email.toLowerCase();
  return (team.members ?? []).some(
    (member) =>
      member.user_id?.toLowerCase() === normalized &&
      (member.role === "owner" || member.role === "admin")
  );
}

export async function requireTeamMembershipManagementPermission(
  session: { accessToken?: string; sub?: string; org?: string; user?: { email?: string } },
  actorEmail: string | undefined,
  team: TeamLike
): Promise<"platform_admin" | "team_admin"> {
  try {
    await requireRbacPermission(session, "admin_ui", "admin");
    return "platform_admin";
  } catch (error) {
    if (isScopedTeamAdmin(actorEmail, team)) {
      return "team_admin";
    }
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError("You do not have permission to manage this team", 403);
  }
}
