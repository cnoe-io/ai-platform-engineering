const SENSITIVE_DETAIL_KEY_PATTERN = /(secret|token|password|credential|plaintext|privateKey)/i;

export function maskCredentialValue(value: string): string {
  if (value.length <= 8) {
    return "*".repeat(value.length);
  }

  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

export function redactCredentialDetails<T extends Record<string, unknown>>(details: T): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(details).map(([key, value]) => [
      key,
      SENSITIVE_DETAIL_KEY_PATTERN.test(key) ? "[redacted]" : value,
    ]),
  );
}
