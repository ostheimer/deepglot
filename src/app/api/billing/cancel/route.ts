import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getCookieLocale } from "@/lib/request-locale";
import { stripe } from "@/lib/stripe";

function t(locale: "en" | "de", deText: string, enText: string) {
  return locale === "de" ? deText : enText;
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

  // Cancel at period end (not immediately)
  await stripe.subscriptions.update(sub.stripeSubscriptionId, {
    cancel_at_period_end: true,
  });

  await db.subscription.update({
    where: { id: sub.id },
    data: { status: "CANCELED" },
  });

  return NextResponse.json({ success: true });
}
