import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { validateApiKey } from "@/lib/api-keys";
import { db } from "@/lib/db";
import { translationContextPath } from "@/lib/translation-context";
import { PLUGIN_RATE_LIMIT_SCOPE, consumeRateLimit, getRateLimitConfig } from "@/lib/rate-limit";
import { normalizeTargetLocale } from "@/lib/project-language-lifecycle";
import { lockProjectRuntimeConfiguration } from "@/lib/project-runtime-configuration-lock";

export const runtime = "nodejs";

const schema = z.object({
  url: z.string().url().max(4096),
  language: z.string().min(2).max(32),
  state: z.enum(["retry", "failed", "completed"]),
  result: z.string().regex(/^[a-z0-9_]{1,80}$/),
  httpStatus: z.number().int().min(100).max(599).nullable(),
}).strict();

export async function POST(request: NextRequest) {
  const bearer = request.headers.get("authorization");
  const rawKey = bearer?.startsWith("Bearer ") ? bearer.slice(7) : null;
  if (!rawKey) return NextResponse.json({ error: "API key required" }, { status: 401 });
  const key = await validateApiKey(rawKey);
  if (!key) return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
  const rate = await consumeRateLimit({ scope: PLUGIN_RATE_LIMIT_SCOPE, subject: key.id, limit: getRateLimitConfig().pluginPerMinute });
  if (!rate.allowed) return NextResponse.json({ error: "Rate limited" }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid sync result" }, { status: 400 });
  const { url, state, result, httpStatus } = parsed.data;
  const language = normalizeTargetLocale(parsed.data.language);
  if (!language) return NextResponse.json({ error: "Invalid target locale" }, { status: 400 });
  const outcome = await db.$transaction(async (tx) => {
    if (!(await lockProjectRuntimeConfiguration(tx, key.projectId))) return "invalid_key" as const;
    const currentKey = await tx.apiKey.findFirst({ where: { id: key.id, projectId: key.projectId, isActive: true, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, select: { id: true } });
    if (!currentKey) return "invalid_key" as const;
    const project = await tx.project.findUnique({ where: { id: key.projectId }, select: { domain: true, languages: { where: { langCode: language, isActive: true }, select: { id: true } }, domainMappings: { where: { langCode: language }, select: { host: true } } } });
    if (!project) return "invalid_key" as const;
    const path = translationContextPath(url, project.domain, project.domainMappings.map((item) => item.host));
    if (!path || project.languages.length === 0) return "invalid_url" as const;
    const origin = new URL(url).origin;
    await tx.translatedUrl.createMany({ data: [{ projectId: key.projectId, urlPath: path, langTo: language, lastSeenAt: new Date() }], skipDuplicates: true });
    const saved = await tx.translatedUrl.updateMany({
      where: { projectId: key.projectId, urlPath: path, langTo: language, OR: [{ operationState: null }, { operationState: { not: "provider_pending" } }] },
      data: { operationState: `sync_${state}`, lastResult: result, lastHttpStatus: httpStatus, origin, lastOperationAt: new Date(), lastError: state === "completed" ? null : result },
    });
    return saved.count === 1 ? "saved" as const : "provider_pending" as const;
  });
  if (outcome === "invalid_key") return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
  if (outcome === "invalid_url") return NextResponse.json({ error: "URL or language does not belong to project" }, { status: 422 });
  if (outcome === "provider_pending") return NextResponse.json({ error: "Provider outcome must be reconciled first", code: "provider_outcome_unknown" }, { status: 409 });
  return NextResponse.json({ ok: true });
}
