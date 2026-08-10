const DEFAULT_ORG_KEY = "caipe";
const DEFAULT_ORG_DISPLAY_NAME = "CAIPE";
const SAFE_ORG_KEY = /^[A-Za-z0-9._-]+$/;

export function caipeOrgKey(): string {
  const configured = process.env.CAIPE_ORG_KEY?.trim();
  if (!configured) return DEFAULT_ORG_KEY;
  return SAFE_ORG_KEY.test(configured) ? configured : DEFAULT_ORG_KEY;
}

export function caipeOrgDisplayName(): string {
  return process.env.CAIPE_ORG_DISPLAY_NAME?.trim() || DEFAULT_ORG_DISPLAY_NAME;
}

export function organizationObjectId(): string {
  return `organization:${caipeOrgKey()}`;
}
