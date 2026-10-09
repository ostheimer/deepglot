import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { validateApiKey } from "@/lib/api-keys";
import { db } from "@/lib/db";
import { translationContextPath } from "@/lib/translation-context";
import { PLUGIN_RATE_LIMIT_SCOPE, consumeRateLimit, getRateLimitConfig } from "@/lib/rate-limit";

export const runtime = "nodejs";

const schema = z.object({
  url: z.string().url().max(4096),
  language: z.string().min(2).max(10),
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
  const { url, language, state, result, httpStatus } = parsed.data;
  const mappings = await db.projectDomainMapping.findMany({ where: { projectId: key.projectId, langCode: language.toLowerCase() }, select: { host: true } });
  const path = translationContextPath(url, key.project.domain, mappings.map((item) => item.host));
  const active = key.project.languages.some((item) => item.langCode.toLowerCase() === language.toLowerCase() && item.isActive);
  if (!path || !active) return NextResponse.json({ error: "URL or language does not belong to project" }, { status: 422 });
  const origin = new URL(url).origin;
  await db.translatedUrl.createMany({ data: [{ projectId: key.projectId, urlPath: path, langTo: language.toLowerCase(), lastSeenAt: new Date() }], skipDuplicates: true });
  const saved = await db.translatedUrl.updateMany({
    where: { projectId: key.projectId, urlPath: path, langTo: language.toLowerCase(), OR: [{ operationState: null }, { operationState: { not: "provider_pending" } }] },
    data: { operationState: `sync_${state}`, lastResult: result, lastHttpStatus: httpStatus, origin, lastOperationAt: new Date(), lastError: state === "completed" ? null : result },
  });
  if (saved.count !== 1) return NextResponse.json({ error: "Provider outcome must be reconciled first", code: "provider_outcome_unknown" }, { status: 409 });
  return NextResponse.json({ ok: true });
}
