import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getCookieLocale } from "@/lib/request-locale";
import { stripe } from "@/lib/stripe";
import type { SiteLocale } from "@/lib/site-locale";
import { uiText } from "@/lib/static-copy";

function t(locale: SiteLocale, deText: string, enText: string) {
  return uiText(locale, enText, deText);
}

export async function POST() {
  const locale = await getCookieLocale();
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(
      { error: t(locale, "Nicht autorisiert", "Not authorized") },
      { status: 401 }
    );
  }

  const membership = await db.organizationMember.findFirst({
    where: { userId: session.user.id },
    include: { organization: { include: { subscription: true } } },
  });

  const sub = membership?.organization?.subscription;
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

  return NextResponse.json({ success: true });
}
