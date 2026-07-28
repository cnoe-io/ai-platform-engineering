type ErrorLike = {
  message?: unknown;
};

/**
 * Return a useful message without assuming caught values are Error instances.
 */
export function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === "object" && error !== null) {
    const { message } = error as ErrorLike;
    if (typeof message === "string" && message) {
      return message;
    }
  }

  return fallback;
}
