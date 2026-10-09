import { Prisma } from "@prisma/client";
import { SOURCE_SNAPSHOT_FRESH_MS, SOURCE_SNAPSHOT_PROVENANCE } from "./source-page-snapshot";

/** SQL counterpart of classifyTranslationSourcePresence; Translation alias t. */
export function sourcePresenceSql(now: Date) {
  const cutoff = new Date(now.getTime() - SOURCE_SNAPSHOT_FRESH_MS);
  const known = Prisma.sql`EXISTS (SELECT 1 FROM "TranslationContext" c WHERE c."translationId" = t.id)`;
  const valid = Prisma.sql`s.id IS NOT NULL AND s."langFrom" = t."langFrom"
    AND s.provenance = ${SOURCE_SNAPSHOT_PROVENANCE} AND s.complete = true
    AND s."dynamicPossible" = false AND s."capturedAt" BETWEEN ${cutoff} AND ${now}
    AND (s."uncertainUntil" IS NULL OR s."uncertainUntil" <= ${now})`;
  const joined = Prisma.sql`FROM "TranslationContext" c
    LEFT JOIN "SourcePageSnapshot" s ON s."projectId" = t."projectId"
      AND s."urlPath" = c."urlPath" AND s."langTo" = t."langTo"
    WHERE c."translationId" = t.id`;
  const present = Prisma.sql`EXISTS (SELECT 1 ${joined} AND ${valid}
    AND t."originalHash" = ANY(s."originalHashes"))`;
  const uncertain = Prisma.sql`EXISTS (SELECT 1 ${joined} AND NOT (${valid}))`;
  return Prisma.sql`CASE WHEN NOT (${known}) THEN 'unknown'
    WHEN ${present} THEN 'present'
    WHEN ${uncertain} THEN 'unknown'
    ELSE 'absent_captured_pages' END`;
}
