import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { authorizeBillingCommand, resolveBillingWorkspaceId } from "@/lib/billing-workspace";
import { db } from "@/lib/db";
import { appendWorkspaceAuditEvent } from "@/lib/audit-events";

import { getCookieLocale } from "@/lib/request-locale";
import { stripe } from "@/lib/stripe";
import type { SiteLocale } from "@/lib/site-locale";
import { uiText } from "@/lib/static-copy";

function t(locale: SiteLocale, deText: string, enText: string) {
  return uiText(locale, enText, deText);
}

export async function POST(request: Request) {
  const locale = await getCookieLocale();
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(
      { error: t(locale, "Nicht autorisiert", "Not authorized") },
      { status: 401 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const requestedId = typeof body?.workspaceId === "string" ? body.workspaceId : null;
  const workspaceId = await resolveBillingWorkspaceId(session.user.id, requestedId, true);
  if (!workspaceId) return NextResponse.json({ error: t(locale, "Workspace wählen", "Choose a workspace") }, { status: 409 });
  const command = await authorizeBillingCommand({ actorUserId: session.user.id,
    workspaceId, action: "CANCEL" });
  if (!command) return NextResponse.json({ error: t(locale, "Workspace wählen", "Choose a workspace") }, { status: 409 });
  const sub = command.organization.subscription;
  if (!sub?.stripeSubscriptionId) {
    return NextResponse.json(
      { error: t(locale, "Kein aktives Abonnement", "No active subscription") },
      { status: 400 }
    );
  }

  // Cancel at period end (not immediately). Do not mark the row CANCELED here —
  // Stripe keeps billing until period end and `customer.subscription.updated`
  // still reports `active`. Premature CANCELED would cap word usage at FREE
  // via getEffectiveWordsLimit() and allow duplicate Checkout while sub_…
  // remains live.
  await stripe.subscriptions.update(sub.stripeSubscriptionId, {
    cancel_at_period_end: true,
  });
  await appendWorkspaceAuditEvent(db, {
    organizationId: workspaceId, actorUserId: session.user.id,
    action: "billing.cancellation_requested", category: "billing",
  });

  return NextResponse.json({ success: true });
}
