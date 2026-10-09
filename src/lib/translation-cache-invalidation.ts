import type { Prisma } from "@prisma/client";
import { wordpressCacheKey } from "@/lib/url-operations";

/** Commit digest-only transient invalidations with the authoritative edit. */
export async function recordTranslationCacheInvalidations(tx: Prisma.TransactionClient,
  projectId: string, rows: ReadonlyArray<{ id: string; originalText: string; langFrom: string; langTo: string }>) {
  if (!rows.length) return;
  const contexts = await tx.translationContext.findMany({
    where: { translationId: { in: rows.map((row) => row.id) } },
    orderBy: { urlPath: "asc" }, select: { translationId: true, urlPath: true },
  });
  const firstPath = new Map<string, string>();
  for (const context of contexts) if (!firstPath.has(context.translationId))
    firstPath.set(context.translationId, context.urlPath);
  await tx.urlCacheInvalidation.createMany({ data: rows.map((row) => ({
    projectId, urlPath: firstPath.get(row.id) ?? "",
    cacheKey: wordpressCacheKey(row.langFrom, row.langTo, row.originalText),
  })) });
}
