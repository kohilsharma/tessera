// TypeORM wraps the driver error but also copies its properties onto
// QueryFailedError; read both so this does not depend on which.
function pgErrorCode(err: unknown): string | undefined {
  const e = err as { code?: string; driverError?: { code?: string } } | null;
  return e?.code ?? e?.driverError?.code;
}

export const PG_UNIQUE_VIOLATION = "23505";
export const PG_CHECK_VIOLATION = "23514";

export function isPgError(err: unknown, code: string): boolean {
  return pgErrorCode(err) === code;
}
