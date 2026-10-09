import { Prisma } from "@prisma/client";
import { encodeWordpressCacheInvalidationKey } from "@/lib/url-operations";

/** Commit digest-only transient invalidations with the authoritative edit. */
export async function recordTranslationCacheInvalidations(tx: Prisma.TransactionClient,
  projectId: string, rows: ReadonlyArray<{ id: string; originalText: string; langFrom: string; langTo: string }>) {
  if (!rows.length) return;
  const contexts = await tx.$queryRaw<Array<{ translationId: string; urlPath: string }>>`
    SELECT DISTINCT ON ("translationId") "translationId", "urlPath"
    FROM "TranslationContext"
    WHERE "translationId" IN (${Prisma.join(rows.map((row) => row.id))})
    ORDER BY "translationId", "urlPath"
  `;
  const firstPath = new Map(contexts.map((context) => [context.translationId, context.urlPath]));
  await tx.urlCacheInvalidation.createMany({ data: rows.map((row) => ({
    projectId, urlPath: firstPath.get(row.id) ?? "",
    cacheKey: encodeWordpressCacheInvalidationKey(row.langFrom, row.langTo, row.originalText),
  })) });
}
