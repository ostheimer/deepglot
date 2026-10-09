import { createHash } from "node:crypto";

export type UrlSegment = {
  isManual: boolean;
  workflowStatus: string;
  paths: string[];
  glossaryProtected?: boolean;
};

/** Only unreviewed machine data exclusively associated with this path is disposable. */
export function classifyUrlTranslation(segment: UrlSegment, urlPath: string) {
  if (segment.isManual || segment.workflowStatus !== "MACHINE" || segment.glossaryProtected) return "protected" as const;
  if (segment.paths.length !== 1 || segment.paths[0] !== urlPath) return "shared" as const;
  return "delete" as const;
}

/** A confirmation binds content, configuration and quota limit, not mutable usage. */
export function createUrlOperationFingerprint(snapshot: unknown) {
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}

/** HTTP status alone never proves that an accepted provider request was free. */
export function managerProviderOutcome(input: { providerDispatched: boolean; receiptPersisted: boolean; responseStatus: number }) {
  if (input.receiptPersisted) return "completed" as const;
  if (!input.providerDispatched) return "rejected_before_provider" as const;
  return "unknown" as const;
}

/** Matches the WordPress TranslationCache transient suffix; never persist text here. */
export function wordpressCacheKey(sourceLang: string, targetLang: string, text: string) {
  return createHash("sha1").update(`${sourceLang}|${targetLang}|${text}`).digest("hex");
}
