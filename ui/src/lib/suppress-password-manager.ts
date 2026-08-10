// assisted-by Codex Codex-sonnet-4-6

/** Apply to non-login forms so browsers/password managers skip save/autofill prompts. */
export const SUPPRESS_PASSWORD_MANAGER_FORM_PROPS = {
  autoComplete: "off" as const,
};

/** Standard text/select fields in admin/config forms (not login). */
export const SUPPRESS_PASSWORD_MANAGER_INPUT_PROPS = {
  autoComplete: "off" as const,
  "data-1p-ignore": "true",
  "data-lpignore": "true",
  "data-form-type": "other" as const,
};

/**
 * Key/value or token-like fields browsers may treat as password pairs.
 * `new-password` tells Chrome not to offer save/autofill on adjacent fields.
 */
export const SUPPRESS_SECRET_LIKE_INPUT_PROPS = {
  autoComplete: "new-password" as const,
  "data-1p-ignore": "true",
  "data-lpignore": "true",
  "data-form-type": "other" as const,
};
