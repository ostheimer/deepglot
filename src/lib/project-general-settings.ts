import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";

import {
  INDUSTRY_TYPES,
  WEBSITE_TYPES,
} from "@/lib/project-general-settings-options";
import {
  isProjectRuntimeSerializationConflict,
  lockProjectRuntimeConfiguration,
} from "@/lib/project-runtime-configuration-lock";
import { isSupportedTranslationLanguage } from "@/lib/supported-languages";

export {
  INDUSTRY_TYPES,
  SOURCE_LANGUAGE_MIGRATION_COPY,
  WEBSITE_TYPES,
} from "@/lib/project-general-settings-options";

export function normalizeProjectDomain(input: string): string {
  const raw = input.trim();
  if (!raw) {
    throw new Error("A domain is required.");
  }

  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(raw)
    ? raw
    : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error("Enter a valid website domain.");
  }

  if (!(["http:", "https:"] as string[]).includes(url.protocol)) {
    throw new Error("Only HTTP and HTTPS website domains are supported.");
  }
  if (url.username || url.password) {
    throw new Error("Website credentials are not allowed in the domain.");
  }
  if ((url.pathname && url.pathname !== "/") || url.search || url.hash) {
    throw new Error("Enter only the website domain, without a path or query.");
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!hostname || hostname.includes(" ")) {
    throw new Error("Enter a valid website domain.");
  }
  const domain = `${hostname}${url.port ? `:${url.port}` : ""}`;
  if (domain.length > 255) {
    throw new Error("The website domain must not exceed 255 characters.");
  }

  return domain;
}

const domainSchema = z
  .string()
  .trim()
  .transform((value, context) => {
    try {
      return normalizeProjectDomain(value);
    } catch (error) {
      context.addIssue({
        code: "custom",
        message:
          error instanceof Error
            ? error.message
            : "Enter a valid website domain.",
      });
      return z.NEVER;
    }
  });

const languageSchema = z
  .string()
  .trim()
  .toLowerCase()
  .refine(isSupportedTranslationLanguage, "Unsupported original language.");

export const projectGeneralSettingsPatchSchema = z
  .object({
    expectedVersion: z
      .string()
      .datetime({ offset: true })
      .transform((value) => new Date(value).toISOString()),
    name: z.string().trim().min(1).max(120).optional(),
    domain: domainSchema.optional(),
    sourceLanguage: languageSchema.optional(),
    autoRedirect: z.boolean().optional(),
    displayAiNotice: z.boolean().optional(),
    automaticTranslation: z.boolean().optional(),
    websiteType: z.enum(WEBSITE_TYPES).nullable().optional(),
    industryType: z.enum(INDUSTRY_TYPES).nullable().optional(),
  })
  .strict()
  .refine(
    (value) => Object.keys(value).some((key) => key !== "expectedVersion"),
    { message: "At least one project setting must be provided." },
  )
  .transform(({ sourceLanguage, autoRedirect, ...value }) => ({
    ...value,
    ...(sourceLanguage !== undefined ? { originalLang: sourceLanguage } : {}),
    ...(autoRedirect !== undefined ? { autoSwitch: autoRedirect } : {}),
  }));

export type ProjectGeneralSettingsPatch = Omit<
  z.infer<typeof projectGeneralSettingsPatchSchema>,
  "expectedVersion"
>;

type ProjectRuntimeSettingsSource = {
  name: string;
  domain: string;
  originalLang: string;
  updatedAt: Date;
  languages: Array<{ langCode: string; isActive: boolean }>;
  settings: {
    autoSwitch: boolean;
    displayAiNotice: boolean;
    automaticTranslation: boolean;
    websiteType: string | null;
    industryType: string | null;
  } | null;
};

export type ProjectRuntimeSettings = {
  version: string;
  name: string;
  domain: string;
  sourceLanguage: string;
  targetLanguages: string[];
  autoRedirect: boolean;
  displayAiNotice: boolean;
  automaticTranslation: boolean;
  websiteType: string | null;
  industryType: string | null;
};

export function buildProjectRuntimeSettings(
  project: ProjectRuntimeSettingsSource,
): ProjectRuntimeSettings {
  return {
    version: project.updatedAt.toISOString(),
    name: project.name,
    domain: project.domain,
    sourceLanguage: project.originalLang.toLowerCase(),
    targetLanguages: project.languages
      .filter((language) => language.isActive)
      .map((language) => language.langCode.toLowerCase())
      .sort(),
    autoRedirect: project.settings?.autoSwitch ?? false,
    displayAiNotice: project.settings?.displayAiNotice ?? false,
    automaticTranslation: project.settings?.automaticTranslation ?? true,
    websiteType: project.settings?.websiteType ?? null,
    industryType: project.settings?.industryType ?? null,
  };
}

export function planOriginalLanguageChange({
  currentLanguage,
  nextLanguage,
  hasLanguageDependentContent,
}: {
  currentLanguage: string;
  nextLanguage: string;
  hasLanguageDependentContent: boolean;
}):
  | { kind: "unchanged" }
  | { kind: "locked" }
  | {
      kind: "migrate";
      activateTargetLanguage: string;
      deactivateTargetLanguage: string;
      removeDomainMappingLanguage: string;
    } {
  const current = currentLanguage.toLowerCase();
  const next = nextLanguage.toLowerCase();
  if (current === next) {
    return { kind: "unchanged" };
  }
  if (hasLanguageDependentContent) {
    return { kind: "locked" };
  }

  return {
    kind: "migrate",
    activateTargetLanguage: current,
    deactivateTargetLanguage: next,
    removeDomainMappingLanguage: next,
  };
}

const generalSettingsInclude = {
  languages: {
    select: { langCode: true, isActive: true },
  },
  settings: {
    select: {
      autoSwitch: true,
      displayAiNotice: true,
      automaticTranslation: true,
      websiteType: true,
      industryType: true,
    },
  },
} satisfies Prisma.ProjectInclude;

type ProjectReader = Prisma.TransactionClient | PrismaClient;

export type LanguageDependentContentCounts = {
  translations: number;
  glossaryRules: number;
  urlSlugs: number;
  translatedUrls: number;
  mediaReplacements: number;
  languageScopedMembers: number;
  pendingLanguageInvitations: number;
};

async function getLanguageDependentContentCounts(
  database: ProjectReader,
  projectId: string,
): Promise<LanguageDependentContentCounts> {
  const [
    translations,
    glossaryRules,
    urlSlugs,
    translatedUrls,
    mediaReplacements,
    languageScopedMembers,
    pendingLanguageInvitations,
  ] = await Promise.all([
    database.translation.count({ where: { projectId } }),
    database.glossaryRule.count({ where: { projectId } }),
    database.urlSlug.count({ where: { projectId } }),
    database.translatedUrl.count({ where: { projectId } }),
    database.projectMediaReplacement.count({ where: { projectId } }),
    database.projectMember.count({
      where: { projectId, langCode: { not: null } },
    }),
    database.projectInvitation.count({
      where: {
        projectId,
        langCode: { not: null },
        acceptedAt: null,
        expiresAt: { gt: new Date() },
      },
    }),
  ]);

  return {
    translations,
    glossaryRules,
    urlSlugs,
    translatedUrls,
    mediaReplacements,
    languageScopedMembers,
    pendingLanguageInvitations,
  };
}

function hasLanguageDependentContent(counts: LanguageDependentContentCounts) {
  return Object.values(counts).some((count) => count > 0);
}

export type ProjectGeneralSettingsView = ProjectRuntimeSettings & {
  sourceLanguageLocked: boolean;
  languageDependentContent: LanguageDependentContentCounts;
};

export async function getProjectGeneralSettings(
  database: ProjectReader,
  projectId: string,
): Promise<ProjectGeneralSettingsView | null> {
  const [project, counts] = await Promise.all([
    database.project.findUnique({
      where: { id: projectId },
      include: generalSettingsInclude,
    }),
    getLanguageDependentContentCounts(database, projectId),
  ]);
  if (!project) {
    return null;
  }

  return {
    ...buildProjectRuntimeSettings(project),
    sourceLanguageLocked: hasLanguageDependentContent(counts),
    languageDependentContent: counts,
  };
}

export type UpdateProjectGeneralSettingsResult =
  | { kind: "updated"; project: ProjectGeneralSettingsView }
  | { kind: "conflict"; project: ProjectGeneralSettingsView | null }
  | {
      kind: "source_language_locked";
      project: ProjectGeneralSettingsView;
    }
  | {
      kind: "source_language_not_active_target";
      project: ProjectGeneralSettingsView;
    }
  | { kind: "not_found" };

function isSerializationConflict(error: unknown) {
  return isProjectRuntimeSerializationConflict(error);
}

export async function updateProjectGeneralSettings(
  database: PrismaClient,
  {
    projectId,
    expectedVersion,
    patch,
  }: {
    projectId: string;
    expectedVersion: string;
    patch: ProjectGeneralSettingsPatch;
  },
): Promise<UpdateProjectGeneralSettingsResult> {
  try {
    return await database.$transaction(
      async (tx) => {
        if (!(await lockProjectRuntimeConfiguration(tx, projectId))) {
          return { kind: "not_found" } as const;
        }

        const current = await tx.project.findUnique({
          where: { id: projectId },
          include: generalSettingsInclude,
        });
        if (!current) {
          return { kind: "not_found" } as const;
        }

        if (current.updatedAt.toISOString() !== expectedVersion) {
          return {
            kind: "conflict",
            project: await getProjectGeneralSettings(tx, projectId),
          } as const;
        }

        let languagePlan = { kind: "unchanged" } as ReturnType<
          typeof planOriginalLanguageChange
        >;
        if (patch.originalLang !== undefined) {
          const changesOriginalLanguage =
            patch.originalLang.toLowerCase() !==
            current.originalLang.toLowerCase();
          const nextOriginalIsActiveTarget = current.languages.some(
            (language) =>
              language.isActive &&
              language.langCode.toLowerCase() ===
                patch.originalLang?.toLowerCase(),
          );
          if (changesOriginalLanguage && !nextOriginalIsActiveTarget) {
            const project = await getProjectGeneralSettings(tx, projectId);
            if (!project) {
              return { kind: "not_found" } as const;
            }
            return {
              kind: "source_language_not_active_target",
              project,
            } as const;
          }

          const counts = await getLanguageDependentContentCounts(tx, projectId);
          languagePlan = planOriginalLanguageChange({
            currentLanguage: current.originalLang,
            nextLanguage: patch.originalLang,
            hasLanguageDependentContent: hasLanguageDependentContent(counts),
          });
          if (languagePlan.kind === "locked") {
            const project = await getProjectGeneralSettings(tx, projectId);
            if (!project) {
              return { kind: "not_found" } as const;
            }
            return { kind: "source_language_locked", project } as const;
          }
        }

        const nextTimestamp = new Date(
          Math.max(Date.now(), current.updatedAt.getTime() + 1),
        );
        const guardedUpdate = await tx.project.updateMany({
          where: { id: projectId, updatedAt: current.updatedAt },
          data: {
            ...(patch.name !== undefined ? { name: patch.name } : {}),
            ...(patch.domain !== undefined ? { domain: patch.domain } : {}),
            ...(patch.originalLang !== undefined
              ? { originalLang: patch.originalLang }
              : {}),
            updatedAt: nextTimestamp,
          },
        });
        if (guardedUpdate.count !== 1) {
          return {
            kind: "conflict",
            project: await getProjectGeneralSettings(tx, projectId),
          } as const;
        }

        const settingsData = {
          ...(patch.autoSwitch !== undefined
            ? { autoSwitch: patch.autoSwitch }
            : {}),
          ...(patch.displayAiNotice !== undefined
            ? { displayAiNotice: patch.displayAiNotice }
            : {}),
          ...(patch.automaticTranslation !== undefined
            ? { automaticTranslation: patch.automaticTranslation }
            : {}),
          ...(patch.websiteType !== undefined
            ? { websiteType: patch.websiteType }
            : {}),
          ...(patch.industryType !== undefined
            ? { industryType: patch.industryType }
            : {}),
        };
        if (Object.keys(settingsData).length > 0) {
          await tx.projectSettings.upsert({
            where: { projectId },
            create: { projectId, ...settingsData },
            update: settingsData,
          });
        }

        if (languagePlan.kind === "migrate") {
          await tx.projectLanguage.updateMany({
            where: {
              projectId,
              langCode: languagePlan.deactivateTargetLanguage,
            },
            data: { isActive: false },
          });
          await tx.projectLanguage.upsert({
            where: {
              projectId_langCode: {
                projectId,
                langCode: languagePlan.activateTargetLanguage,
              },
            },
            create: {
              projectId,
              langCode: languagePlan.activateTargetLanguage,
              isActive: true,
            },
            update: { isActive: true },
          });
          await tx.projectDomainMapping.deleteMany({
            where: {
              projectId,
              langCode: languagePlan.removeDomainMappingLanguage,
            },
          });
        }

        const project = await getProjectGeneralSettings(tx, projectId);
        if (!project) {
          return { kind: "not_found" } as const;
        }
        return { kind: "updated", project } as const;
      },
      // READ COMMITTED is required with the shared Project row lock. A
      // SERIALIZABLE snapshot is established before a blocked FOR UPDATE
      // resumes and can therefore miss a child row committed by the lock
      // holder that just finished. At READ COMMITTED, the post-lock content
      // counts see that committed write and correctly block source migration.
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  } catch (error) {
    if (isSerializationConflict(error)) {
      return {
        kind: "conflict",
        project: await getProjectGeneralSettings(database, projectId),
      };
    }
    throw error;
  }
}
