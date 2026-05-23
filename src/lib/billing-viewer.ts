import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  normalizeBillingPlanKey,
  type BillingPlanKey,
} from "@/lib/billing-plans";

export type ViewerBillingContext = {
  loggedIn: boolean;
  /** The viewer's current plan, or null when logged out / no organization. */
  plan: BillingPlanKey | null;
};

/**
 * Resolves whether the page viewer is logged in and which billing plan their
 * organization is on. Used by the public pricing grid to switch the CTA
 * between sign-up, Checkout and the billing portal.
 */
export async function getViewerBillingContext(): Promise<ViewerBillingContext> {
  const session = await auth();
  if (!session?.user?.id) {
    return { loggedIn: false, plan: null };
  }

  const membership = await db.organizationMember.findFirst({
    where: { userId: session.user.id },
    select: { organization: { select: { plan: true } } },
  });

  if (!membership?.organization) {
    return { loggedIn: true, plan: null };
  }

  return {
    loggedIn: true,
    plan: normalizeBillingPlanKey(membership.organization.plan),
  };
}
