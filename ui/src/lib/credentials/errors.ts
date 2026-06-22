// assisted-by Codex Codex-sonnet-4-6

export const CREDENTIAL_REASON_CODES = {
  credentialPreviewNotFound: "credential_preview_not_found",
  browserRequestDenied: "browser_request_denied",
  credentialStoreUnavailable: "credential_store_unavailable",
  deniedByPolicy: "denied_by_policy",
  missingJwt: "missing_jwt",
  missingResourceContext: "missing_resource_context",
  wrongAudience: "wrong_audience",
  invalidCaller: "invalid_caller",
  decryptFailed: "decrypt_failed",
  keyWrapFailed: "key_wrap_failed",
  credentialNotFound: "credential_not_found",
  kmsAccessDenied: "kms_access_denied",
  kmsUnavailable: "kms_unavailable",
  invalidRetrievalRequest: "invalid_retrieval_request",
} as const;

export type CredentialReasonCode =
  (typeof CREDENTIAL_REASON_CODES)[keyof typeof CREDENTIAL_REASON_CODES];

const CREDENTIAL_REASON_CODE_SET = new Set<string>(Object.values(CREDENTIAL_REASON_CODES));

export interface CredentialErrorInput {
  reasonCode: CredentialReasonCode;
  message: string;
  status: number;
  correlationId?: string;
}

export class CredentialError extends Error {
  readonly reasonCode: CredentialReasonCode;
  readonly status: number;
  readonly correlationId?: string;

  constructor(input: CredentialErrorInput) {
    super(input.message);
    this.name = "CredentialError";
    this.reasonCode = input.reasonCode;
    this.status = input.status;
    this.correlationId = input.correlationId;
  }
}

export function isCredentialReasonCode(value: string): value is CredentialReasonCode {
  return CREDENTIAL_REASON_CODE_SET.has(value);
}

export function createCredentialError(input: CredentialErrorInput): CredentialError {
  return new CredentialError(input);
}
