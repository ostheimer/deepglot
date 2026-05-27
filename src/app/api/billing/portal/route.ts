import { NextResponse } from "next/server";
import Stripe from "stripe";

import { auth } from "@/lib/auth";
import { getBillingPortalReturnUrl } from "@/lib/billing";
import { db } from "@/lib/db";
import { getCookieLocale } from "@/lib/request-locale";
import type { SiteLocale } from "@/lib/site-locale";
import { stripe } from "@/lib/stripe";
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

  const customerId = membership?.organization?.subscription?.stripeCustomerId;
  if (!customerId || customerId.startsWith("free_")) {
    return NextResponse.json(
      {
        error: t(
          locale,
          "Kein Stripe-Kunde gefunden",
          "No Stripe customer found"
        ),
      },
      { status: 400 }
    );
  }

  try {
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: getBillingPortalReturnUrl(),
    });
    return NextResponse.json({ url: portalSession.url });
  } catch (error) {
    // The route used to let Stripe errors propagate as raw 500s with empty
    // bodies. The client toast then said "billing portal unavailable" with no
    // hint at the underlying cause. Catch the error explicitly, log enough
    // detail for Vercel runtime logs, and surface a specific reason so the
    // operator can act (configure the portal, fix a stale customer id, etc.)
    // without guessing.
    if (error instanceof Stripe.errors.StripeError) {
      console.error(
        `[billing/portal] Stripe ${error.type} (code=${error.code ?? "none"}, ` +
          `statusCode=${error.statusCode ?? "none"}, requestId=${error.requestId ?? "none"}): ` +
          `${error.message}`,
        {
          userId: session.user.id,
          organizationId: membership?.organization?.id,
          customerId,
        }
      );

      // Stripe returns 404 with code `resource_missing` when the customer id
      // doesn't exist in the current mode. The most common cause is a stale
      // test-mode `cus_…` row that survived into a Live deployment, or a
      // customer that was deleted in the Stripe dashboard.
      if (error.code === "resource_missing") {
        return NextResponse.json(
          {
            error: t(
              locale,
              "Stripe-Kunde nicht gefunden. Bitte Support kontaktieren.",
              "Stripe customer not found. Please contact support."
            ),
            stripeCode: error.code,
          },
          { status: 404 }
        );
      }

      // No customer-portal configuration exists in the current Stripe mode.
      // Operator must configure it at
      // https://dashboard.stripe.com/settings/billing/portal.
      if (
        error.message
          .toLowerCase()
          .includes("customer portal") &&
        error.message.toLowerCase().includes("configur")
      ) {
        return NextResponse.json(
          {
            error: t(
              locale,
              "Stripe-Kundenportal ist nicht konfiguriert.",
              "Stripe customer portal is not configured."
            ),
            stripeCode: "portal_not_configured",
          },
          { status: 503 }
        );
      }

      return NextResponse.json(
        {
          error: t(
            locale,
            `Stripe-Fehler: ${error.message}`,
            `Stripe error: ${error.message}`
          ),
          stripeCode: error.code ?? null,
        },
        { status: error.statusCode ?? 500 }
      );
    }

    console.error(
      `[billing/portal] Unexpected error for user ${session.user.id}:`,
      error
    );
    return NextResponse.json(
      {
        error: t(
          locale,
          "Unerwarteter Fehler beim Öffnen des Abrechnungsportals.",
          "Unexpected error opening the billing portal."
        ),
      },
      { status: 500 }
    );
  }
}
