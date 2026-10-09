import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { canManageProjectForWrite, getAuthenticatedUserId, userCanManageProject } from "@/lib/project-access";
import { getEffectiveWordsLimit } from "@/lib/billing-plans";
import { getUsageMonthKey } from "@/lib/translation-batches";
import { countWords } from "@/lib/translation";
import { getProjectUrl } from "@/lib/project-url";
import { classifyUrlTranslation, createUrlOperationFingerprint, glossaryRuleVersion, managerProviderOutcome, urlProviderConfiguration, wordpressCacheKey } from "@/lib/url-operations";
import { executeAuthenticatedTranslateRequest } from "@/app/api/translate/route";
import { executeIdempotently, PrismaApiIdempotencyStore, validateApiIdempotencyKey } from "@/lib/api-idempotency";
import { buildGlossaryProtection, hasGlossaryProtection } from "@/lib/glossary";

export const runtime = "nodejs";
export const maxDuration = 120;

const schema = z.object({
  action: z.enum(["retranslate", "delete"]),
  id: z.string().min(1),
  afterId: z.string().min(1).max(128).optional(),
  confirmation: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict();

async function snapshot(projectId: string, id: string, action: "retranslate" | "delete", afterId?: string) {
  const project = await db.project.findUnique({
    where: { id: projectId },
    include: { languages: true, settings: true, domainMappings: true, organization: { include: { subscription: true } } },
  });
  const record = await db.translatedUrl.findFirst({ where: { id, projectId } });
  if (!project || !record) return null;
  const translations = await db.translation.findMany({
    where: { projectId, langTo: record.langTo, contexts: { some: { urlPath: record.urlPath } } },
    include: { contexts: { select: { urlPath: true } } },
    orderBy: { id: "asc" },
    take: 10_001,
  });
  const glossaryRules = await db.glossaryRule.findMany({
    where: { projectId, langFrom: project.originalLang, langTo: record.langTo },
    orderBy: [{ originalTerm: "desc" }, { updatedAt: "desc" }],
  });
  const glossaryVersion = glossaryRuleVersion(glossaryRules);
  if (translations.length > 10_000) throw new Error("This URL exceeds the 10,000-segment inventory limit; use a narrower URL inventory before operating.");
  const classified = translations.map((item) => ({
    item,
    classification: classifyUrlTranslation({
      isManual: item.isManual,
      workflowStatus: item.workflowStatus,
      paths: item.contexts.map((context) => context.urlPath).sort(),
      glossaryProtected: hasGlossaryProtection(buildGlossaryProtection(item.originalText, glossaryRules)),
    }, record.urlPath),
  }));
  const allEligible = classified.filter(({ classification }) => classification === "delete").map(({ item }) => item);
  if (action === "delete" && afterId && allEligible.some((item) => item.id <= afterId)) {
    throw new Error("Delete continuation is not complete; review the first remaining URL step.");
  }
  const remainingEligible = allEligible.filter((item) => !afterId || item.id > afterId);
  const eligible = remainingEligible.slice(0, 250);
  const nextAfterId = remainingEligible.length > 250 ? eligible.at(-1)?.id ?? null : null;
  const billableWords = eligible.reduce((sum, item) => sum + countWords(item.originalText), 0);
  const month = getUsageMonthKey();
  const usage = await db.usageRecord.aggregate({ where: { organizationId: project.organizationId, month }, _sum: { words: true } });
  const wordsUsed = usage._sum.words ?? 0;
  const wordsLimit = getEffectiveWordsLimit(project.organization.subscription);
  const active = project.languages.some((language) => language.langCode.toLowerCase() === record.langTo.toLowerCase() && language.isActive);
  const outcomeUnknown = record.operationState === "provider_pending";
  const canRetranslate = !outcomeUnknown && active && project.settings?.automaticTranslation !== false && billableWords > 0 && wordsUsed + billableWords <= wordsLimit;
  const fingerprint = createUrlOperationFingerprint({
    action, afterId, projectId, record: [record.id, record.urlPath, record.langTo, record.lastSeenAt.toISOString(), record.operationState, record.lastResult, record.lastOperationAt?.toISOString()],
    originalLang: project.originalLang, active, targetHost: project.domainMappings.find((mapping) => mapping.langCode === record.langTo)?.host,
    automaticTranslation: project.settings?.automaticTranslation,
    settingsUpdatedAt: project.settings?.updatedAt.toISOString(), month, wordsLimit,
    glossaryVersion,
    providerConfiguration: urlProviderConfiguration(project.settings),
    segments: translations.map((item) => [item.id, item.originalHash, item.originalText, item.updatedAt.toISOString(), item.isManual, item.workflowStatus, item.contexts.map((context) => context.urlPath).sort()]),
  });
  return {
    project, record, translations, eligible, fingerprint, nextAfterId, glossaryVersion,
    preview: {
      id, urlPath: record.urlPath, langTo: record.langTo, action, confirmation: fingerprint,
      affectedSegments: eligible.length,
      totalEligibleSegments: allEligible.length,
      remainingSegments: Math.max(0, remainingEligible.length - eligible.length),
      nextAfterId,
      sharedSegments: classified.filter(({ classification }) => classification === "shared").length,
      protectedSegments: classified.filter(({ classification }) => classification === "protected").length,
      billableWords: action === "retranslate" ? billableWords : 0,
      wordsUsed, wordsLimit, canRetranslate, canDelete: !outcomeUnknown,
      reason: outcomeUnknown ? "provider_outcome_unknown" : !active ? "target_language_inactive" : project.settings?.automaticTranslation === false ? "automatic_translation_disabled" : billableWords === 0 ? "no_exclusive_machine_segments" : wordsUsed + billableWords > wordsLimit ? "quota_exceeded" : null,
    },
  };
}

async function authorized(projectId: string) {
  const userId = await getAuthenticatedUserId();
  if (!userId) return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  if (!(await userCanManageProject(userId, projectId))) return { error: NextResponse.json({ error: "Project not found" }, { status: 404 }) };
  const project = await db.project.findUnique({ where: { id: projectId }, select: { organizationId: true } });
  if (!project) return { error: NextResponse.json({ error: "Project not found" }, { status: 404 }) };
  return { userId, organizationId: project.organizationId };
}

async function currentManagerInWorkspace(actorId: string, projectId: string, organizationId: string) {
  return db.$transaction(async (tx) => {
    if (!(await canManageProjectForWrite(tx, actorId, projectId))) return false;
    const project = await tx.project.findUnique({ where: { id: projectId }, select: { organizationId: true } });
    return project?.organizationId === organizationId;
  });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ projektId: string }> }) {
  const { projektId } = await params;
  const auth = await authorized(projektId);
  if (auth.error) return auth.error;
  const actorId = auth.userId!;
  const originatingOrganizationId = auth.organizationId!;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid URL operation" }, { status: 400 });
  const { action, id, afterId, confirmation } = parsed.data;
  if (!confirmation) {
    try {
      const current = await snapshot(projektId, id, action, afterId);
      if (!(await currentManagerInWorkspace(actorId, projektId, originatingOrganizationId))) {
        return NextResponse.json({ error: "Project not found" }, { status: 404 });
      }
      return current ? NextResponse.json(current.preview) : NextResponse.json({ error: "URL not found" }, { status: 404 });
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Preview failed" }, { status: 422 });
    }
  }
  const key = request.headers.get("Idempotency-Key")?.trim();
  if (!key || !validateApiIdempotencyKey(key) || key !== confirmation) return NextResponse.json({ error: "Idempotency-Key must match the confirmed preview" }, { status: 400 });
  const result = await executeIdempotently({
    scope: `manager:url-operation:${originatingOrganizationId}:${projektId}:${actorId}`,
    key,
    requestBody: parsed.data,
    store: new PrismaApiIdempotencyStore(),
    execute: async () => {
      if (action === "retranslate") {
        const recovered = await db.$transaction(async (tx) => {
          if (!(await canManageProjectForWrite(tx, actorId, projektId))) return { denied: true } as const;
          const currentProject = await tx.project.findUnique({ where: { id: projektId }, select: { organizationId: true } });
          if (currentProject?.organizationId !== originatingOrganizationId) return { denied: true } as const;
          const receipt = await tx.urlOperationReceipt.findUnique({ where: { id: confirmation } });
          const receiptUrl = receipt ? await tx.translatedUrl.findFirst({ where: { id, projectId: projektId } }) : null;
          if (receipt?.projectId !== projektId || receipt.originatingOrganizationId !== originatingOrganizationId ||
            receipt.urlId !== id || receipt.actorId !== actorId || receipt.id !== confirmation ||
            receiptUrl?.operationToken !== confirmation || receiptUrl.urlPath !== receipt.urlPath || receiptUrl.langTo !== receipt.langTo) return null;
          await tx.translatedUrl.updateMany({ where: { id, projectId: projektId, operationState: "provider_pending" }, data: { operationState: "completed", lastResult: "retranslated", lastError: null, lastOperationAt: new Date() } });
          return { receipt } as const;
        });
        if (recovered?.denied) return { status: 404, headers: {}, body: { error: "Project not found" } };
        if (recovered?.receipt) {
          const { receipt } = recovered;
          return { status: 200, headers: {}, body: { id, action, affectedSegments: receipt.segmentCount, totalEligibleSegments: receipt.totalEligibleSegments, remainingSegments: receipt.remainingSegments, nextAfterId: receipt.nextAfterId, billedWords: receipt.billedWords, result: "completed", reconciledFromReceipt: true } };
        }
      }
      const fresh = await snapshot(projektId, id, action, afterId);
      if (!fresh || fresh.fingerprint !== confirmation) return { status: 409, headers: {}, body: { error: "Preview changed. Review and confirm again.", code: "stale_preview" } };
      if (fresh.record.operationState === "provider_pending") return { status: 409, headers: {}, body: { error: "Provider outcome must be reconciled before another URL action", code: "provider_outcome_unknown" } };
      if (action === "delete") {
        const ids = fresh.translations.map((item) => item.id);
        try { await db.$transaction(async (tx) => {
          if (!(await canManageProjectForWrite(tx, actorId, projektId))) throw new Error("ACCESS_REVOKED");
          const currentProject = await tx.project.findUnique({ where: { id: projektId }, select: { organizationId: true } });
          if (currentProject?.organizationId !== originatingOrganizationId) throw new Error("ACCESS_REVOKED");
          const currentRules = await tx.glossaryRule.findMany({ where: { projectId: projektId, langFrom: fresh.project.originalLang, langTo: fresh.record.langTo }, select: { id: true, updatedAt: true } });
          if (glossaryRuleVersion(currentRules) !== fresh.glossaryVersion) throw new Error("STALE_URL");
          await tx.$queryRaw`SELECT id FROM "TranslatedUrl" WHERE id = ${id} AND "projectId" = ${projektId} FOR UPDATE`;
          const row = await tx.translatedUrl.findFirst({ where: { id, projectId: projektId } });
          if (!row || row.lastSeenAt.getTime() !== fresh.record.lastSeenAt.getTime() || row.lastOperationAt?.getTime() !== fresh.record.lastOperationAt?.getTime() || row.operationState !== fresh.record.operationState || row.lastResult !== fresh.record.lastResult) throw new Error("STALE_URL");
          const currentContexts = await tx.translationContext.findMany({
            where: { urlPath: fresh.record.urlPath, translation: { projectId: projektId, langTo: fresh.record.langTo } },
            select: { translationId: true },
          });
          if (currentContexts.length !== ids.length || currentContexts.some((context) => !ids.includes(context.translationId))) throw new Error("STALE_URL");
          const latest = await tx.translation.findMany({ where: { id: { in: ids }, projectId: projektId }, include: { contexts: true } });
          if (latest.length !== ids.length || latest.some((item) => {
            const prior = fresh.translations.find((translation) => translation.id === item.id);
            return !prior || item.updatedAt.getTime() !== prior.updatedAt.getTime() || item.isManual !== prior.isManual || item.workflowStatus !== prior.workflowStatus ||
              JSON.stringify(item.contexts.map((context) => context.urlPath).sort()) !== JSON.stringify(prior.contexts.map((context) => context.urlPath).sort());
          })) throw new Error("STALE_URL");
          if (fresh.eligible.length > 0) await tx.urlCacheInvalidation.createMany({ data: fresh.eligible.map((item) => ({
            projectId: projektId, urlPath: fresh.record.urlPath,
            cacheKey: wordpressCacheKey(item.langFrom, item.langTo, item.originalText),
          })) });
          await tx.translation.deleteMany({ where: { id: { in: fresh.eligible.map((item) => item.id) }, projectId: projektId } });
          if (!fresh.nextAfterId) {
            await tx.translationContext.deleteMany({ where: { translationId: { in: ids }, urlPath: fresh.record.urlPath } });
            await tx.translatedUrl.delete({ where: { id } });
          }
        }); } catch (error) {
          if (error instanceof Error && error.message === "ACCESS_REVOKED") return { status: 404, headers: {}, body: { error: "Project not found" } };
          if (error instanceof Error && error.message === "STALE_URL") return { status: 409, headers: {}, body: { error: "URL changed during deletion", code: "stale_preview" } };
          throw error;
        }
        return { status: 200, headers: {}, body: { id, action, deletedSegments: fresh.eligible.length, unlinkedContexts: fresh.nextAfterId ? fresh.eligible.length : ids.length, historicalUsagePreserved: true, nextAfterId: fresh.nextAfterId } };
      }
      if (!fresh.preview.canRetranslate) return { status: 409, headers: {}, body: { error: fresh.preview.reason ?? "Retranslation unavailable", code: "retranslation_unavailable" } };
      // A durable compare-and-set prevents a second confirmation or an expired
      // idempotency lease from starting provider work with the same URL snapshot.
      // An unknown outcome remains blocked until an operator reconciles it.
      const claimed = await db.$transaction(async (tx) => {
        if (!(await canManageProjectForWrite(tx, actorId, projektId))) return { denied: true, count: 0 };
        const currentProject = await tx.project.findUnique({ where: { id: projektId }, select: { organizationId: true } });
        if (currentProject?.organizationId !== originatingOrganizationId) return { denied: true, count: 0 };
        return tx.translatedUrl.updateMany({
        where: {
          id, projectId: projektId,
          lastSeenAt: fresh.record.lastSeenAt,
          operationState: fresh.record.operationState,
          lastOperationAt: fresh.record.lastOperationAt,
        },
        data: { operationState: "provider_pending", lastResult: "provider_outcome_unknown", lastHttpStatus: null, origin: "dashboard", lastOperationAt: new Date(), lastError: "provider_outcome_unknown", operationToken: confirmation },
        });
      });
      if ("denied" in claimed) return { status: 404, headers: {}, body: { error: "Project not found" } };
      if (claimed.count !== 1) return { status: 409, headers: {}, body: { error: "URL changed before provider work", code: "stale_preview" } };
      const targetHost = fresh.project.domainMappings.find((mapping) => mapping.langCode === fresh.record.langTo)?.host ?? fresh.project.domain;
      const url = new URL(fresh.record.urlPath, getProjectUrl(targetHost)).toString();
      const fakeRequest = new NextRequest("http://localhost/api/translate", { method: "POST", body: JSON.stringify({
        l_from: fresh.project.originalLang, l_to: fresh.record.langTo,
        words: fresh.eligible.map((item) => ({ w: item.originalText, t: 0 })), request_url: url, bot: 0,
      }) });
      let providerDispatched = false;
      let response: NextResponse;
      try {
        response = await executeAuthenticatedTranslateRequest(fakeRequest, { id: `manager:${projektId}`, project: fresh.project }, undefined, {
          hashes: new Set(fresh.eligible.map((item) => item.originalHash)),
          versions: new Map(fresh.eligible.map((item) => [item.originalHash, item.updatedAt.toISOString()])),
          glossaryVersion: fresh.glossaryVersion,
          actorId,
          settingsVersion: fresh.project.settings?.updatedAt.toISOString() ?? null,
          providerConfiguration: urlProviderConfiguration(fresh.project.settings),
          onProviderDispatch: () => { providerDispatched = true; },
          receipt: { id: confirmation, projectId: projektId, urlId: id, actorId, urlPath: fresh.record.urlPath, langTo: fresh.record.langTo, totalEligibleSegments: fresh.preview.totalEligibleSegments, remainingSegments: fresh.preview.remainingSegments, nextAfterId: fresh.nextAfterId },
        });
      } catch (error) {
        if (!providerDispatched) await db.translatedUrl.updateMany({ where: { id, projectId: projektId, operationState: "provider_pending" }, data: { operationState: "failed", lastResult: "pre_provider_failed", lastError: "pre_provider_failed", lastOperationAt: new Date() } });
        throw error;
      }
      const responseBody = await response.json();
      const receipt = await db.urlOperationReceipt.findUnique({ where: { id: confirmation } });
      const outcome = managerProviderOutcome({ providerDispatched, receiptPersisted: receipt?.projectId === projektId && receipt.originatingOrganizationId === originatingOrganizationId && receipt.urlId === id && receipt.actorId === actorId && receipt.urlPath === fresh.record.urlPath && receipt.langTo === fresh.record.langTo, responseStatus: response.status });
      if (outcome === "completed") {
        await db.translatedUrl.updateMany({ where: { id, projectId: projektId }, data: { operationState: "completed", lastResult: "retranslated", lastHttpStatus: null, origin: "dashboard", lastOperationAt: new Date(), lastError: null } });
      } else if (outcome === "rejected_before_provider") {
        await db.translatedUrl.updateMany({ where: { id, projectId: projektId }, data: { operationState: "failed", lastResult: "retranslate_failed", lastHttpStatus: null, origin: "dashboard", lastOperationAt: new Date(), lastError: String(responseBody.code ?? "operation_failed").slice(0, 80) } });
      }
      return { status: outcome === "completed" ? 200 : outcome === "rejected_before_provider" ? response.status : 409, headers: {}, body: { id, action, affectedSegments: fresh.eligible.length, totalEligibleSegments: fresh.preview.totalEligibleSegments, remainingSegments: outcome === "completed" ? fresh.preview.remainingSegments : null, ...(outcome === "completed" ? { billedWords: receipt!.billedWords } : outcome === "rejected_before_provider" ? { billedWords: 0 } : { providerCostUnknown: true }), result: outcome === "completed" ? "completed" : outcome === "rejected_before_provider" ? "failed" : "unknown", nextAfterId: outcome === "completed" ? fresh.nextAfterId : null, ...(outcome === "completed" ? {} : { error: outcome === "rejected_before_provider" ? responseBody.code ?? "operation_failed" : "provider_outcome_unknown" }) } };
    },
  });
  // executeIdempotently may return a stored response without entering execute.
  // Recheck the current tenant before exposing an old receipt/replay response.
  if (!(await currentManagerInWorkspace(actorId, projektId, originatingOrganizationId))) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  if (result.kind === "conflict") return NextResponse.json({ error: "Idempotency key used for another request" }, { status: 409 });
  return NextResponse.json(result.response.body, { status: result.response.status });
}
