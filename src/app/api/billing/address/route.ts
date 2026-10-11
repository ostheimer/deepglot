import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { authorizeBillingCommand, resolveBillingWorkspaceId } from "@/lib/billing-workspace";
import { db } from "@/lib/db";
import { appendWorkspaceAuditEvent } from "@/lib/audit-events";

import { getCookieLocale } from "@/lib/request-locale";
import { stripe } from "@/lib/stripe";
import { isRealStripeCustomerId } from "@/lib/billing";
import { z } from "zod";
import type { SiteLocale } from "@/lib/site-locale";
import { uiText } from "@/lib/static-copy";

function t(locale: SiteLocale, deText: string, enText: string) {
  return uiText(locale, enText, deText);
}

const schema = z.object({
  workspaceId: z.string().min(1).optional(),
  billingName: z.string().max(200).optional(),
  address: z.string().max(200).optional(),
  city: z.string().max(100).optional(),
  zip: z.string().max(20).optional(),
  country: z.string().length(2).optional(),
  vatNumber: z.string().max(50).optional(),
});

export async function POST(request: Request) {
  const locale = await getCookieLocale();
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(
      { error: t(locale, "Nicht autorisiert", "Not authorized") },
      { status: 401 }
    );
  }

  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: t(locale, "Ungültige Eingabe", "Invalid input") },
      { status: 400 }
    );
  }

  const { billingName, address, city, zip, country, vatNumber } = parsed.data;

  const workspaceId = await resolveBillingWorkspaceId(session.user.id, parsed.data.workspaceId ?? null, true);
  if (!workspaceId) return NextResponse.json({ error: t(locale, "Workspace wählen", "Choose a workspace") }, { status: 409 });
  const command = await authorizeBillingCommand({ actorUserId: session.user.id,
    workspaceId, action: "ADDRESS" });
  if (!command) return NextResponse.json({ error: t(locale, "Workspace wählen", "Choose a workspace") }, { status: 409 });
  const customerId = command.targetRef;
  if (!isRealStripeCustomerId(customerId)) {
    return NextResponse.json({ success: true }); // no Stripe customer yet, silently succeed
  }

  await stripe.customers.update(customerId, {
    name: billingName,
    address: {
      line1: address ?? "",
      city: city ?? "",
      postal_code: zip ?? "",
      country: country ?? "AT",
    },
    ...(vatNumber && { tax_id_data: undefined }), // VAT handled separately via tax IDs
  });
  await appendWorkspaceAuditEvent(db, {
    organizationId: workspaceId, actorUserId: session.user.id,
    action: "billing.address_updated", category: "billing",
  });

  return NextResponse.json({ success: true });
}
