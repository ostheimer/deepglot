import { z } from "zod";

export const ROUTING_MODE_VALUES = ["PATH_PREFIX", "SUBDOMAIN"] as const;

export const pluginSettingsSyncSchema = z
  .object({
    routingMode: z.enum(ROUTING_MODE_VALUES),
    siteUrl: z.string().url().optional(),
    sourceLanguage: z.string().trim().min(2).max(16),
    targetLanguages: z
      .array(z.string().trim().min(2).max(16))
      .min(1)
      .transform((languages) =>
        Array.from(new Set(languages.map((language) => language.toLowerCase())))
      ),
    autoRedirect: z.boolean(),
    translateEmails: z.boolean(),
    translateSearch: z.boolean(),
    translateAmp: z.boolean(),
    domainMappings: z
      .array(
        z.object({
          langCode: z.string().trim().min(2).max(16),
          host: z.string().trim().min(1),
        })
      )
      .default([]),
  })
  .transform((payload) => ({
    ...payload,
    sourceLanguage: payload.sourceLanguage.toLowerCase(),
    domainMappings: payload.domainMappings.map((mapping) => ({
      langCode: mapping.langCode.toLowerCase(),
      host: mapping.host.toLowerCase(),
    })),
  }));

export type PluginSettingsSyncPayload = z.infer<
  typeof pluginSettingsSyncSchema
>;

export type PluginDomainMappingsValidationError = {
  detail: string;
  errors: { domainMappings: string[] };
};

export type PluginOwnedSettingsUpdate = {
  translateEmails: boolean;
  translateSearch: boolean;
  translateAmp: boolean;
  routingMode: (typeof ROUTING_MODE_VALUES)[number];
  runtimeSyncedAt: Date;
};

export type PluginMirrorState = {
  domain: string;
  sourceLanguage: string;
  targetLanguages: string[];
  autoRedirect: boolean;
};

export type PluginMirrorConflict =
  | "domain"
  | "sourceLanguage"
  | "targetLanguages"
  | "autoRedirect";

/**
 * Keep the WordPress-owned runtime options separate from the general project
 * settings managed in the SaaS dashboard. In particular, mirrored values such
 * as the source language and automatic redirect must never be written back by
 * this payload.
 */
export function buildPluginOwnedSettingsUpdate(
  payload: PluginSettingsSyncPayload,
  syncedAt = new Date(),
): PluginOwnedSettingsUpdate {
  return {
    translateEmails: payload.translateEmails,
    translateSearch: payload.translateSearch,
    translateAmp: payload.translateAmp,
    routingMode: payload.routingMode,
    runtimeSyncedAt: syncedAt,
  };
}

function normalizeLanguageSet(languages: readonly string[]): string[] {
  return Array.from(
    new Set(languages.map((language) => language.trim().toLowerCase())),
  ).sort();
}

function pluginSiteHost(siteUrl: string | undefined): string | null {
  if (!siteUrl) return null;

  try {
    return new URL(siteUrl).host.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Report WordPress values that differ from the authoritative SaaS mirror. The
 * caller can surface this drift without accepting the stale values as writes.
 */
export function findPluginMirrorConflicts(
  payload: PluginSettingsSyncPayload,
  authoritative: PluginMirrorState,
): PluginMirrorConflict[] {
  const conflicts: PluginMirrorConflict[] = [];
  const siteHost = pluginSiteHost(payload.siteUrl);

  if (siteHost !== null && siteHost !== authoritative.domain.toLowerCase()) {
    conflicts.push("domain");
  }
  if (
    payload.sourceLanguage.toLowerCase() !==
    authoritative.sourceLanguage.toLowerCase()
  ) {
    conflicts.push("sourceLanguage");
  }
  if (
    JSON.stringify(normalizeLanguageSet(payload.targetLanguages)) !==
    JSON.stringify(normalizeLanguageSet(authoritative.targetLanguages))
  ) {
    conflicts.push("targetLanguages");
  }
  if (payload.autoRedirect !== authoritative.autoRedirect) {
    conflicts.push("autoRedirect");
  }

  return conflicts;
}

export function validatePluginDomainMappings(
  payload: PluginSettingsSyncPayload,
  activeTargetLanguages: readonly string[] = payload.targetLanguages,
): PluginDomainMappingsValidationError | null {
  const duplicateHosts = new Set<string>();
  const seenHosts = new Set<string>();

  for (const mapping of payload.domainMappings) {
    if (seenHosts.has(mapping.host)) {
      duplicateHosts.add(mapping.host);
      continue;
    }

    seenHosts.add(mapping.host);
  }

  if (duplicateHosts.size > 0) {
    return {
      detail: "Domain mappings must use unique hosts.",
      errors: { domainMappings: ["Hosts must be unique."] },
    };
  }

  const activeLanguages = new Set(normalizeLanguageSet(activeTargetLanguages));
  const invalidMapping = payload.domainMappings.find(
    (mapping) => !activeLanguages.has(mapping.langCode),
  );

  if (invalidMapping) {
    return {
      detail: `Domain mapping language '${invalidMapping.langCode}' is not active for the project.`,
      errors: {
        domainMappings: [
          "Every mapping language must be an active target language.",
        ],
      },
    };
  }

  return null;
}
