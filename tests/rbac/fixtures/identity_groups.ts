export interface IdentityGroupFixtureMember {
  readonly subject: string;
  readonly email: string;
  readonly displayName: string;
  readonly active: boolean;
}

export interface IdentityGroupFixture {
  readonly providerId: string;
  readonly externalGroupId: string;
  readonly displayName: string;
  readonly immutableId: string;
  readonly members: readonly IdentityGroupFixtureMember[];
}

export const IDENTITY_GROUP_FIXTURES: readonly IdentityGroupFixture[] = [
  {
    providerId: "oidc-claims",
    externalGroupId: "eng-platform-admins",
    immutableId: "gid-eng-platform-admins",
    displayName: "Engineering Platform Admins",
    members: [
      {
        subject: "alice-admin-sub",
        email: "alice_admin@example.test",
        displayName: "Alice Admin",
        active: true,
      },
    ],
  },
  {
    providerId: "oidc-claims",
    externalGroupId: "eng-platform-users",
    immutableId: "gid-eng-platform-users",
    displayName: "Engineering Platform Users",
    members: [
      {
        subject: "bob-chat-user-sub",
        email: "bob_chat_user@example.test",
        displayName: "Bob Chat User",
        active: true,
      },
      {
        subject: "dave-no-role-sub",
        email: "dave_no_role@example.test",
        displayName: "Dave No Role",
        active: true,
      },
    ],
  },
  {
    providerId: "okta-primary",
    externalGroupId: "kb-ingestors",
    immutableId: "00g-kb-ingestors",
    displayName: "Knowledge Base Ingestors",
    members: [
      {
        subject: "carol-kb-ingestor-sub",
        email: "carol_kb_ingestor@example.test",
        displayName: "Carol KB Ingestor",
        active: true,
      },
    ],
  },
];

export const IDENTITY_GROUP_SYNC_RULE_FIXTURE = {
  id: "rule-platform-groups",
  providerId: "oidc-claims",
  name: "Platform groups",
  priority: 10,
  includePatterns: ["^Engineering Platform (?<role>Admins|Users)$"],
  excludePatterns: ["^Engineering Platform Contractors$"],
  teamNameTemplate: "Platform",
  teamSlugTemplate: "platform",
  roleMap: {
    Admins: "admin",
    Users: "member",
  },
  autoCreateTeam: true,
} as const;
