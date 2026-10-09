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

/** Provider identity is part of the manager's confirmed spend scope. */
export function urlProviderConfiguration(settings: {
  translationProvider: string | null;
  translationModel: string | null;
  translationBaseUrl: string | null;
  translationApiKeyUpdatedAt: Date | null;
} | null | undefined): readonly [string | null, string | null, string | null, string | null] {
  return [
    settings?.translationProvider ?? null,
    settings?.translationModel ?? null,
    settings?.translationBaseUrl ?? null,
    settings?.translationApiKeyUpdatedAt?.toISOString() ?? null,
  ];
}

/** Compare rule revisions under the same project lock as URL mutations. */
export function glossaryRuleVersion(rules: ReadonlyArray<{ id: string; updatedAt: Date }>) {
  return createUrlOperationFingerprint(rules.map((rule) => [rule.id, rule.updatedAt.toISOString()]).sort((a, b) => a[0].localeCompare(b[0])));
}

/** Bind the exact ordered terms and matching mode used to protect dispatch text. */
export function glossaryDispatchFingerprint(rules: ReadonlyArray<{
  id: string; originalTerm: string; translatedTerm: string; caseSensitive: boolean; updatedAt: Date;
}>) {
  return createUrlOperationFingerprint(rules.map((rule) => [rule.id, rule.originalTerm,
    rule.translatedTerm, rule.caseSensitive, rule.updatedAt.toISOString()]));
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
