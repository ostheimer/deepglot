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
