import type { Prisma } from "@prisma/client";

import {
  MAX_RUNTIME_MEDIA_REPLACEMENTS,
  buildRuntimeMediaReplacements,
  type RuntimeMediaReplacementRow,
} from "@/lib/media-replacements";

// PHP serialization adds structural overhead compared with JSON. Reserve 32 KiB
// beneath the plugin's separate 256 KiB non-autoloaded WordPress option limit.
export const MAX_RUNTIME_MEDIA_REPLACEMENTS_BYTES = 229_376;

export class MediaRuntimePayloadLimitError extends Error {
  public readonly limit = MAX_RUNTIME_MEDIA_REPLACEMENTS_BYTES;

  constructor(
    public readonly previousBytes: number,
    public readonly nextBytes: number
  ) {
    super("The project's active image replacements exceed the runtime size limit.");
    this.name = "MediaRuntimePayloadLimitError";
  }
}

export function normalizeActiveProjectLanguageCodes(
  languageCodes: Iterable<string>
): string[] {
  const normalizedCodes = new Set<string>();

  for (const languageCode of languageCodes) {
    const normalizedCode = languageCode.trim().toLowerCase();

    if (normalizedCode !== "") {
      normalizedCodes.add(normalizedCode);
    }
  }

  return [...normalizedCodes];
}

export function inspectMediaRuntimePayload(rows: RuntimeMediaReplacementRow[]) {
  const mediaReplacements = buildRuntimeMediaReplacements(rows);

  return {
    mediaReplacements,
    byteLength: new TextEncoder().encode(JSON.stringify(mediaReplacements))
      .byteLength,
  };
}

export function assertMediaRuntimeMutationWithinLimit(
  previousRows: RuntimeMediaReplacementRow[],
  nextRows: RuntimeMediaReplacementRow[]
) {
  if (previousRows.length > MAX_RUNTIME_MEDIA_REPLACEMENTS) {
    const nextPayload = inspectMediaRuntimePayload(nextRows);

    if (nextPayload.byteLength > MAX_RUNTIME_MEDIA_REPLACEMENTS_BYTES) {
      throw new MediaRuntimePayloadLimitError(
        MAX_RUNTIME_MEDIA_REPLACEMENTS_BYTES,
        nextPayload.byteLength
      );
    }

    return nextPayload;
  }

  const previousPayload = inspectMediaRuntimePayload(previousRows);
  const nextPayload = inspectMediaRuntimePayload(nextRows);

  if (
    nextPayload.byteLength > MAX_RUNTIME_MEDIA_REPLACEMENTS_BYTES &&
    nextPayload.byteLength >= previousPayload.byteLength
  ) {
    throw new MediaRuntimePayloadLimitError(
      previousPayload.byteLength,
      nextPayload.byteLength
    );
  }

  return nextPayload;
}

async function getActiveProjectRuntimeRows(
  tx: Prisma.TransactionClient,
  projectId: string
) {
  const activeLanguages = await tx.projectLanguage.findMany({
    where: { projectId, isActive: true },
    select: { langCode: true },
  });
  const activeLanguageCodes = normalizeActiveProjectLanguageCodes(
    activeLanguages.map(({ langCode }) => langCode)
  );
  const runtimeMediaQuery = {
    where: { projectId, langTo: { in: activeLanguageCodes } },
    orderBy: [{ langTo: "asc" }, { originalUrl: "asc" }],
    select: { langTo: true, originalUrl: true, localizedUrl: true },
    take: MAX_RUNTIME_MEDIA_REPLACEMENTS + 1,
  } satisfies Prisma.ProjectMediaReplacementFindManyArgs;

  return tx.projectMediaReplacement.findMany(runtimeMediaQuery);
}

export async function withBoundedMediaRuntimeMutation<Result>(
  tx: Prisma.TransactionClient,
  projectId: string,
  mutation: () => Promise<Result>
): Promise<Result> {
  const previousRows = await getActiveProjectRuntimeRows(tx, projectId);
  const result = await mutation();
  const nextRows = await getActiveProjectRuntimeRows(tx, projectId);

  assertMediaRuntimeMutationWithinLimit(previousRows, nextRows);

  return result;
}
