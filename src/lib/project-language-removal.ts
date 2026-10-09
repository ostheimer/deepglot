import type { Prisma, PrismaClient } from "@prisma/client";

import { languageRemovalFingerprint } from "@/lib/project-language-lifecycle";
import { lockProjectRuntimeConfiguration } from "@/lib/project-runtime-configuration-lock";
import { canManageProjectForWrite } from "@/lib/project-access";

type Reader = PrismaClient | Prisma.TransactionClient;

/** Billing and historical event rows remain intact; only target-owned runtime data is deleted. */
export async function previewTargetLanguageRemoval(db: Reader, projectId: string, langCode: string) {
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { originalLang: true, updatedAt: true, languages: { where: { langCode }, select: { id: true, isActive: true, isVisible: true, automaticTranslation: true } } },
  });
  if (!project || project.originalLang.toLowerCase() === langCode || project.languages.length !== 1) return null;

  const target = { projectId, langTo: langCode };
  const [translations, urls, slugs, media, domainMappings, glossary, members, invitations, pageViews, batches, usage] = await Promise.all([
    db.translation.findMany({ where: target, select: { id: true, updatedAt: true, wordCount: true }, orderBy: { id: "asc" } }),
    db.translatedUrl.findMany({ where: target, select: { id: true, urlPath: true, wordCount: true, requestCount: true }, orderBy: { id: "asc" } }),
    db.urlSlug.findMany({ where: target, select: { id: true, updatedAt: true, originalSlug: true, translatedSlug: true }, orderBy: { id: "asc" } }),
    db.projectMediaReplacement.findMany({ where: target, select: { id: true, updatedAt: true }, orderBy: { id: "asc" } }),
    db.projectDomainMapping.findMany({ where: { projectId, langCode }, select: { id: true, updatedAt: true, host: true }, orderBy: { id: "asc" } }),
    db.glossaryRule.findMany({ where: target, select: { id: true, updatedAt: true }, orderBy: { id: "asc" } }),
    db.projectMember.count({ where: { projectId, langCode } }),
    db.projectInvitation.count({ where: { projectId, langCode, acceptedAt: null } }),
    db.pageView.count({ where: target }),
    db.translationBatchLog.aggregate({ where: target, _count: { id: true }, _sum: { translatedWords: true } }),
    db.usageRecord.aggregate({ where: { projectId }, _sum: { words: true } }),
  ]);
  const dataVersion = languageRemovalFingerprint({
    langCode,
    projectVersion: project.updatedAt.toISOString(),
    translations: translations.length,
    urls: urls.length,
    urlPaths: urls.slice(0, 10).map((item) => item.urlPath),
    slugs: slugs.length,
    slugMappings: slugs.slice(0, 10).map((item) => `${item.originalSlug} → ${item.translatedSlug ?? "—"}`),
    usageWords: usage._sum.words ?? 0,
    retainedMemberAssignments: members,
    retainedPendingInvitations: invitations,
    retainedPageViews: pageViews,
    retainedBatches: batches._count.id,
    retainedBilledWords: batches._sum.translatedWords ?? 0,
    data: JSON.stringify({ language: project.languages[0], translations, urls, slugs, media, domainMappings, glossary }),
  });
  const summary = {
    langCode,
    projectVersion: project.updatedAt.toISOString(),
    translations: translations.length,
    translationWords: translations.reduce((sum, item) => sum + item.wordCount, 0),
    urls: urls.length,
    urlPaths: urls.slice(0, 10).map((item) => item.urlPath),
    slugs: slugs.length,
    slugMappings: slugs.slice(0, 10).map((item) => `${item.originalSlug} → ${item.translatedSlug ?? "—"}`),
    mediaReplacements: media.length,
    glossaryRules: glossary.length,
    domainMappings: domainMappings.map((item) => item.host),
    retainedMemberAssignments: members,
    retainedPendingInvitations: invitations,
    retainedPageViews: pageViews,
    retainedBatches: batches._count.id,
    retainedBilledWords: batches._sum.translatedWords ?? 0,
    retainedProjectUsageWords: usage._sum.words ?? 0,
    usageWords: usage._sum.words ?? 0,
    dataVersion,
  };
  return { ...summary, confirmationToken: languageRemovalFingerprint(summary) };
}

export async function removeTargetLanguage(
  db: PrismaClient,
  projectId: string,
  langCode: string,
  confirmationToken: string,
  actorUserId?: string,
) {
  return db.$transaction(async (tx) => {
    if (!(await lockProjectRuntimeConfiguration(tx, projectId))) return { kind: "not_found" } as const;
    if (actorUserId && !(await canManageProjectForWrite(tx, actorUserId, projectId))) return { kind: "not_found" } as const;
    const current = await previewTargetLanguageRemoval(tx, projectId, langCode);
    if (!current) return { kind: "not_found" } as const;
    if (current.confirmationToken !== confirmationToken) return { kind: "stale_preview", preview: current } as const;
    await deleteTargetData(tx, projectId, langCode);
    await tx.project.update({ where: { id: projectId }, data: { updatedAt: new Date(Math.max(Date.now(), new Date(current.projectVersion).getTime() + 1)) } });
    return { kind: "removed", preview: current } as const;
  }, { isolationLevel: "ReadCommitted" });
}

async function deleteTargetData(tx: Prisma.TransactionClient, projectId: string, langCode: string) {
  const target = { projectId, langTo: langCode };
  await tx.translation.deleteMany({ where: target });
  await tx.translatedUrl.deleteMany({ where: target });
  await tx.urlSlug.deleteMany({ where: target });
  await tx.projectMediaReplacement.deleteMany({ where: target });
  await tx.glossaryRule.deleteMany({ where: target });
  await tx.projectDomainMapping.deleteMany({ where: { projectId, langCode } });
  await tx.projectLanguage.deleteMany({ where: { projectId, langCode } });
}

/** Validate all selected previews against one locked snapshot before updating the version. */
export async function removeTargetLanguages(
  db: PrismaClient,
  projectId: string,
  selections: { langCode: string; confirmationToken?: string }[],
  actorUserId?: string,
) {
  return db.$transaction(async (tx) => {
    if (!(await lockProjectRuntimeConfiguration(tx, projectId))) return selections.map(({ langCode }) => ({ langCode, status: "not_found" }));
    if (actorUserId && !(await canManageProjectForWrite(tx, actorUserId, projectId))) return selections.map(({ langCode }) => ({ langCode, status: "not_found" }));
    const project = await tx.project.findUniqueOrThrow({ where: { id: projectId }, select: { updatedAt: true } });
    const seen = new Set<string>();
    const approved: string[] = [];
    const results: { langCode: string; status: string }[] = [];
    for (const selection of selections) {
      const { langCode, confirmationToken } = selection;
      if (seen.has(langCode)) { results.push({ langCode, status: "duplicate" }); continue; }
      seen.add(langCode);
      if (!confirmationToken) { results.push({ langCode, status: "preview_required" }); continue; }
      const preview = await previewTargetLanguageRemoval(tx, projectId, langCode);
      if (!preview) { results.push({ langCode, status: "not_found" }); continue; }
      if (preview.confirmationToken !== confirmationToken) { results.push({ langCode, status: "stale_preview" }); continue; }
      approved.push(langCode);
      results.push({ langCode, status: "removed" });
    }
    for (const langCode of approved) await deleteTargetData(tx, projectId, langCode);
    if (approved.length > 0) {
      await tx.project.update({ where: { id: projectId }, data: { updatedAt: new Date(Math.max(Date.now(), project.updatedAt.getTime() + 1)) } });
    }
    return results;
  }, { isolationLevel: "ReadCommitted" });
}
