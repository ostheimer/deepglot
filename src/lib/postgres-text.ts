/**
 * PostgreSQL text and jsonb cannot represent U+0000. Keep this guard narrowly
 * scoped to that one character: valid Unicode and every other control
 * character remain part of Deepglot's translation contract.
 */
export type PostgresTextBoundaryContext = {
  boundary: string;
  field: string;
  index?: number;
  provider?: string;
};

export type PostgresTextRejectionEvent = {
  event: "postgres_text_nul_rejected";
  boundary: string;
  field: string;
  nulCount: number;
  index?: number;
  provider?: string;
};

export class PostgresTextBoundaryError extends Error {
  readonly event: PostgresTextRejectionEvent;

  constructor(context: PostgresTextBoundaryContext, nulCount: number) {
    super(
      `PostgreSQL-incompatible U+0000 rejected at ${context.boundary}:${context.field} (count: ${nulCount}).`,
    );
    this.name = "PostgresTextBoundaryError";
    this.event = {
      event: "postgres_text_nul_rejected",
      boundary: context.boundary,
      field: context.field,
      nulCount,
      ...(context.index === undefined ? {} : { index: context.index }),
      ...(context.provider === undefined
        ? {}
        : { provider: context.provider }),
    };
  }
}

export function countPostgresNul(value: string): number {
  let count = 0;
  for (const character of value) {
    if (character === "\u0000") count += 1;
  }
  return count;
}

/**
 * Inspect without logging. This is used by request validation so callers can
 * return a structured 4xx response before provider translation and
 * translation-domain persistence.
 */
export function inspectPostgresText(
  value: string,
  context: PostgresTextBoundaryContext,
): PostgresTextBoundaryError | null {
  const nulCount = countPostgresNul(value);
  return nulCount > 0
    ? new PostgresTextBoundaryError(context, nulCount)
    : null;
}

/**
 * Emit only field metadata. The rejected value is deliberately not retained
 * on the error or passed to the logger, so translation text, URLs, hashes and
 * credentials cannot leak through this observability path.
 */
export function reportPostgresTextRejection(
  error: PostgresTextBoundaryError,
  logger: (message: string) => void = console.warn,
) {
  logger(
    JSON.stringify({
      level: "warn",
      message: "PostgreSQL-incompatible U+0000 rejected.",
      ...error.event,
    }),
  );
}

/** Defense-in-depth for values immediately before PostgreSQL writes. */
export function assertPostgresText(
  value: string,
  context: PostgresTextBoundaryContext,
): string {
  const error = inspectPostgresText(value, context);
  if (error) {
    reportPostgresTextRejection(error);
    throw error;
  }
  return value;
}

export function assertPostgresTextFields(
  fields: Record<string, string | null | undefined>,
  context: Omit<PostgresTextBoundaryContext, "field">,
) {
  for (const [field, value] of Object.entries(fields)) {
    if (typeof value === "string") {
      assertPostgresText(value, { ...context, field });
    }
  }
}

function countJsonNul(value: unknown): number {
  if (typeof value === "string") return countPostgresNul(value);
  if (Array.isArray(value)) {
    return value.reduce((total, item) => total + countJsonNul(item), 0);
  }
  if (value && typeof value === "object") {
    return Object.entries(value).reduce(
      (total, [key, item]) =>
        total + countPostgresNul(key) + countJsonNul(item),
      0,
    );
  }
  return 0;
}

/** Defense-in-depth for Prisma json/jsonb payloads. */
export function assertPostgresJsonText(
  value: unknown,
  context: PostgresTextBoundaryContext,
) {
  const nulCount = countJsonNul(value);
  if (nulCount > 0) {
    const error = new PostgresTextBoundaryError(context, nulCount);
    reportPostgresTextRejection(error);
    throw error;
  }
}
