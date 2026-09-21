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
  | "siteIdentity"
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
 * Reduce a stored domain or reported site URL to a comparable hostname.
 * Accepts bare hosts as well as scheme-bearing values (`https://Example.com/`)
 * that older project-creation paths stored unchanged, and treats the `www.`
 * prefix as the same site. Non-default ports are kept because projects may
 * legitimately live on `example.com:8443`. Returns null when nothing
 * host-like remains.
 */
export function canonicalHost(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  try {
    const url = new URL(withScheme);
    // Absolute DNS names ("example.com.") are the same host without the dot.
    const hostname = url.hostname
      .toLowerCase()
      .replace(/\.+$/, "")
      .replace(/^www\./, "");
    if (!hostname) return null;
    return url.port ? `${hostname}:${url.port}` : hostname;
  } catch {
    return null;
  }
}

/**
 * Site identity of a WordPress installation as reported by the plugin:
 * lowercase host (trailing DNS dot removed, `www.` kept for display) plus the
 * install path without trailing slash, e.g. `example.com/blog`. Subdirectory
 * installations sharing a host are distinct sites and must stay distinct here.
 */
export function canonicalSiteIdentity(
  siteUrl: string | null | undefined,
): string | null {
  const trimmed = siteUrl?.trim();
  if (!trimmed) return null;

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  try {
    const url = new URL(withScheme);
    const hostname = url.hostname.toLowerCase().replace(/\.+$/, "");
    if (!hostname) return null;
    const host = url.port ? `${hostname}:${url.port}` : hostname;
    // URL paths are case-sensitive and the plugin routes them that way.
    const path = url.pathname.replace(/\/+$/, "");
    return path && path !== "/" ? `${host}${path}` : host;
  } catch {
    return null;
  }
}

/** Host component of a value produced by canonicalSiteIdentity. */
export function siteIdentityHost(identity: string | null | undefined) {
  if (!identity) return null;
  const slash = identity.indexOf("/");
  return slash === -1 ? identity : identity.slice(0, slash);
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

  if (
    siteHost !== null &&
    canonicalHost(siteHost) !== canonicalHost(authoritative.domain)
  ) {
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

export type RuntimeSyncMirrorRecord = {
  runtimeSyncSiteHost?: string;
  runtimeSyncConflicts: PluginMirrorConflict[];
};

/**
 * Persist what the last plugin sync reported so the dashboard can show a
 * project whose API key is being reused by another WordPress installation.
 * The record is informational only; the authoritative values stay untouched.
 */
export function buildRuntimeSyncMirrorRecord(
  payload: PluginSettingsSyncPayload,
  conflicts: readonly PluginMirrorConflict[],
): RuntimeSyncMirrorRecord {
  return {
    ...buildRuntimeSyncOrigin(payload.siteUrl),
    runtimeSyncConflicts: [...conflicts],
  };
}

/**
 * Fields describing where a sync came from. When the client did not report a
 * siteUrl the previously recorded site is left untouched rather than cleared:
 * an omitted value proves nothing about the foreign installation.
 */
export function buildRuntimeSyncOrigin(
  siteUrl: string | null | undefined,
): { runtimeSyncSiteHost?: string } {
  const identity = canonicalSiteIdentity(siteUrl);
  return identity ? { runtimeSyncSiteHost: identity } : {};
}

/**
 * A sync from the same host but a different install path than the one on
 * record is a different WordPress installation reusing the key. The project
 * domain carries no path, so this is the only place it can be detected.
 */
export function isSiteIdentityChange(
  previous: string | null | undefined,
  next: string | null | undefined,
) {
  if (!previous || !next || previous === next) return false;
  const sameHost =
    canonicalHost(siteIdentityHost(previous)) === canonicalHost(siteIdentityHost(next));
  const pathOf = (identity: string) => identity.slice(siteIdentityHost(identity)?.length ?? 0);
  return sameHost && pathOf(previous) !== pathOf(next);
}

/**
 * Decide at render time whether the host reported by the last plugin sync
 * belongs to a different site than the project's *current* domain. Comparing
 * live (instead of trusting the persisted conflict list) keeps the warning
 * correct after a manager edits the domain in the general settings.
 */
export function hasRuntimeSyncDomainConflict(
  domain: string | null | undefined,
  siteIdentity: string | null | undefined,
  conflicts: readonly string[] | null | undefined = [],
): siteIdentity is string {
  const reported = canonicalHost(siteIdentityHost(siteIdentity));
  if (!reported) return false;
  if (reported !== canonicalHost(domain)) return true;
  return (conflicts ?? []).includes("siteIdentity");
}

/** Field values that remove a recorded plugin sync origin from a project. */
export const CLEARED_RUNTIME_SYNC_ORIGIN = {
  runtimeSyncSiteHost: null,
  runtimeSyncApiKeyId: null,
  runtimeSyncConflicts: [] as PluginMirrorConflict[],
} as const;

export type StoredRuntimeSyncOrigin = {
  runtimeSyncSiteHost: string | null;
  runtimeSyncConflicts: readonly string[];
};

/**
 * Fields to write for an incoming sync given what is currently stored.
 * A same-host path change raises the "siteIdentity" marker; an existing
 * marker is preserved until a manager dismisses it or the key is revoked.
 * Without a reported siteUrl the stored site *and* its recorded key stay as
 * they are: a compatible client that omits siteUrl reports no site identity
 * at all, so attributing the untouched host to whichever key happened to
 * send this request would let an unrelated key's revocation clear (or its
 * continued presence hide) another key's conflict.
 */
export function resolveRuntimeSyncOrigin(
  stored: StoredRuntimeSyncOrigin | null | undefined,
  siteUrl: string | null | undefined,
  apiKeyId: string,
): {
  origin: { runtimeSyncSiteHost?: string; runtimeSyncApiKeyId?: string };
  siteIdentityConflict: boolean;
} {
  const origin = buildRuntimeSyncOrigin(siteUrl);
  const siteIdentityConflict =
    isSiteIdentityChange(stored?.runtimeSyncSiteHost, origin.runtimeSyncSiteHost) ||
    (stored?.runtimeSyncConflicts ?? []).includes("siteIdentity");
  return {
    origin:
      origin.runtimeSyncSiteHost !== undefined
        ? { ...origin, runtimeSyncApiKeyId: apiKeyId }
        : origin,
    siteIdentityConflict,
  };
}
