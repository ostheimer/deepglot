import { db } from "./db";
import { lockProjectRuntimeConfiguration } from "./project-runtime-configuration-lock";
import { recordTranslationContexts, translationContextPath } from "./translation-context";
import { decideSnapshotWrite, snapshotDigest, SOURCE_SNAPSHOT_CAPTURE_SKEW_MS,
  SOURCE_SNAPSHOT_MAX_HASHES, SOURCE_SNAPSHOT_PROVENANCE } from "./source-page-snapshot";

export class SourceSnapshotError extends Error {
  constructor(public code: "FORBIDDEN" | "INVALID", message: string) { super(message); }
}

export async function recordSourcePageSnapshot(input: {
  apiKeyId: string;
  projectId: string;
  requestUrl: string;
  langFrom: string;
  langTo: string;
  originalHashes: string[];
  complete: boolean;
  dynamicPossible: boolean;
  capturedMicros: bigint;
}) {
  if (input.originalHashes.length > SOURCE_SNAPSHOT_MAX_HASHES)
    throw new SourceSnapshotError("INVALID", "Source snapshot exceeds the bounded segment limit.");
  return db.$transaction(async (tx) => {
    if (!(await lockProjectRuntimeConfiguration(tx, input.projectId)))
      throw new SourceSnapshotError("FORBIDDEN", "Project is unavailable.");
    const keyRows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "ApiKey" WHERE "id" = ${input.apiKeyId} AND "projectId" = ${input.projectId}
        AND "isActive" = true AND ("expiresAt" IS NULL OR "expiresAt" > NOW()) FOR SHARE
    `;
    if (keyRows.length !== 1) throw new SourceSnapshotError("FORBIDDEN", "API key changed.");
    const project = await tx.project.findUnique({ where: { id: input.projectId },
      select: { domain: true, originalLang: true, languages: {
        where: { isActive: true }, select: { langCode: true },
      } } });
    if (!project || project.originalLang.toLowerCase() !== input.langFrom.toLowerCase() ||
      !project.languages.some((language) => language.langCode.toLowerCase() === input.langTo.toLowerCase()))
      throw new SourceSnapshotError("FORBIDDEN", "Language pair changed.");
    const urlPath = translationContextPath(input.requestUrl, project.domain);
    if (!urlPath) throw new SourceSnapshotError("INVALID", "Source page must be a same-origin project URL.");
    const now = new Date();
    const serverMicros = BigInt(now.getTime()) * BigInt(1_000);
    const skewMicros = BigInt(SOURCE_SNAPSHOT_CAPTURE_SKEW_MS) * BigInt(1_000);
    if (input.capturedMicros < serverMicros - skewMicros || input.capturedMicros > serverMicros + skewMicros)
      throw new SourceSnapshotError("INVALID", "Source capture is too old or the site clock is out of sync.");
    const hashes = [...new Set(input.originalHashes)].sort();
    const complete = input.complete && !input.dynamicPossible;
    const safeHashes = complete ? hashes : [];
    const digest = snapshotDigest({ originalHashes: safeHashes, complete,
      dynamicPossible: input.dynamicPossible, provenance: SOURCE_SNAPSHOT_PROVENANCE });
    const previous = await tx.sourcePageSnapshot.findUnique({ where: {
      projectId_urlPath_langTo: { projectId: input.projectId, urlPath, langTo: input.langTo },
    } });
    const decision = decideSnapshotWrite({ now, capturedMicros: input.capturedMicros, digest,
      complete, previous });
    if (decision.kind === "stale") return { accepted: false, reason: "stale" as const };
    const data = { langFrom: input.langFrom, originalHashes: decision.complete ? safeHashes : [],
      complete: decision.complete, dynamicPossible: input.dynamicPossible,
      provenance: SOURCE_SNAPSHOT_PROVENANCE, contentDigest: digest,
      clientCapturedMicros: input.capturedMicros, uncertainUntil: decision.uncertainUntil,
      capturedAt: now };
    await tx.sourcePageSnapshot.upsert({ where: {
      projectId_urlPath_langTo: { projectId: input.projectId, urlPath, langTo: input.langTo },
    }, create: { projectId: input.projectId, urlPath, langTo: input.langTo, ...data }, update: data });
    if (decision.complete && safeHashes.length) await recordTranslationContexts(tx, {
      projectId: input.projectId, domain: project.domain, requestUrl: input.requestUrl,
      langFrom: input.langFrom, langTo: input.langTo, hashes: safeHashes,
    });
    return { accepted: true, complete: decision.complete, urlPath };
  }, { timeout: 10_000 });
}
