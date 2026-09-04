import { Prisma } from "@prisma/client";

/**
 * Serialize mutations whose validity depends on the project's current source
 * and target languages. Callers must keep the returned row lock until their
 * dependent writes are complete.
 */
export async function lockProjectRuntimeConfiguration(
  tx: Prisma.TransactionClient,
  projectId: string,
): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "Project"
    WHERE "id" = ${projectId}
    FOR UPDATE
  `;

  return rows.length === 1;
}

/**
 * Lock the project row and validate language-dependent writes against a fresh
 * snapshot from the same transaction. The row lock is shared with source- and
 * target-language mutations, so either the dependent write commits first and
 * blocks a migration via its content count, or it waits for the migration and
 * rejects its now-stale language pair.
 */
export async function lockAndValidateProjectLanguageWrite(
  tx: Prisma.TransactionClient,
  {
    projectId,
    sourceLanguages = [],
    targetLanguages = [],
  }: {
    projectId: string;
    sourceLanguages?: Iterable<string>;
    targetLanguages?: Iterable<string>;
  },
): Promise<boolean> {
  if (!(await lockProjectRuntimeConfiguration(tx, projectId))) {
    return false;
  }

  const project = await tx.project.findUnique({
    where: { id: projectId },
    select: {
      originalLang: true,
      languages: {
        where: { isActive: true },
        select: { langCode: true },
      },
    },
  });
  if (!project) {
    return false;
  }

  const sourceLanguage = project.originalLang.toLowerCase();
  const activeTargetLanguages = new Set(
    project.languages.map((language) => language.langCode.toLowerCase()),
  );

  return (
    Array.from(sourceLanguages).every(
      (language) => language.toLowerCase() === sourceLanguage,
    ) &&
    Array.from(targetLanguages).every((language) =>
      activeTargetLanguages.has(language.toLowerCase()),
    )
  );
}

/** Prisma wraps a raw PostgreSQL serialization failure as P2010/40001. */
export function isProjectRuntimeSerializationConflict(error: unknown) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
    return false;
  }
  if (error.code === "P2034") {
    return true;
  }

  if (error.code !== "P2010") {
    return false;
  }

  const driverAdapterError = error.meta?.driverAdapterError;
  if (!driverAdapterError || typeof driverAdapterError !== "object") {
    return false;
  }
  const cause = (driverAdapterError as { cause?: unknown }).cause;
  if (!cause || typeof cause !== "object") {
    return false;
  }
  const transactionConflict = cause as {
    kind?: unknown;
    originalCode?: unknown;
  };

  return (
    transactionConflict.kind === "TransactionWriteConflict" ||
    transactionConflict.originalCode === "40001"
  );
}
