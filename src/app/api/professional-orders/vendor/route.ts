import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { deliverProfessionalOrder, startProfessionalOrder, vendorQuote } from "@/lib/professional-order-service";
import { hashVendorToken, ProfessionalOrderError, requireProfessionalOrdersEnabled, vendorTokenMatches } from "@/lib/professional-orders";

export const runtime = "nodejs";
const postSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start") }).strict(),
  z.object({ action: z.literal("quote"), amountMinor: z.number().int(), currency: z.string(), turnaroundDays: z.number().int(), expiresAt: z.string().datetime({ offset: true }), reference: z.string(), termsVersion: z.string() }).strict(),
  z.object({ action: z.literal("deliver"), items: z.array(z.object({ itemId: z.string().min(1), proposedText: z.string().min(1).max(100_000) }).strict()).min(1).max(100) }).strict(),
]);

async function authorize(request: NextRequest) {
  const authorization = request.headers.get("authorization") ?? "";
  if (!/^Bearer dgpo_[a-f0-9]{64}$/.test(authorization)) return null;
  const token = authorization.slice(7);
  const grant = await db.professionalTranslationVendorGrant.findUnique({
    where: { tokenHash: hashVendorToken(token) },
    select: { id: true, orderId: true, tokenHash: true, expiresAt: true, revokedAt: true },
  });
  if (!grant || grant.revokedAt || grant.expiresAt <= new Date() || !vendorTokenMatches(token, grant.tokenHash)) return null;
  return grant;
}

function fail(error: unknown) {
  if (error instanceof ProfessionalOrderError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.code === "CONFLICT" ? 409 : error.code === "DISABLED" ? 404 : 400 });
  console.error("[professional-orders] vendor operation failed");
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

export async function GET(request: NextRequest) {
  try {
    requireProfessionalOrdersEnabled();
    const grant = await authorize(request);
    if (!grant) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const order = await db.professionalTranslationOrder.findUnique({
      where: { id: grant.orderId },
      select: {
        id: true, status: true, sourceLanguage: true, targetLanguage: true, wordCount: true, scopeDigest: true,
        items: { select: { id: true, originalText: true, originalHash: true } },
      },
    });
    if (!order || !["QUOTE_REQUESTED", "QUOTED", "PAID", "IN_PROGRESS"].includes(order.status)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ order }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return fail(error); }
}

export async function POST(request: NextRequest) {
  try {
    requireProfessionalOrdersEnabled();
    const grant = await authorize(request);
    if (!grant) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const parsed = postSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Invalid vendor operation" }, { status: 400 });
    const action = parsed.data;
    const result = action.action === "start"
      ? await startProfessionalOrder({ orderId: grant.orderId, vendorGrantId: grant.id })
      : action.action === "quote"
      ? await vendorQuote({ orderId: grant.orderId, vendorGrantId: grant.id, amountMinor: action.amountMinor, currency: action.currency, turnaroundDays: action.turnaroundDays, expiresAt: new Date(action.expiresAt), reference: action.reference, termsVersion: action.termsVersion })
      : await deliverProfessionalOrder({ orderId: grant.orderId, vendorGrantId: grant.id, items: action.items });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return fail(error); }
}
