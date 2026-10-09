import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { mayReceiveOptionalNotification, notificationPeriodStart, type OptionalNotificationCategory, type OptionalNotificationFrequency } from "@/lib/notification-preferences";

export const NOTIFICATION_CLAIM_TTL_MS = 15 * 60 * 1000;
export const NOTIFICATION_SEND_PENDING = new Date(0);

type DispatchInput = {
  userId: string;
  organizationId: string;
  category: OptionalNotificationCategory;
  frequency: Exclude<OptionalNotificationFrequency, "OFF">;
  /** Start of the original UTC weekly/monthly period, including late retries. */
  periodStart: Date;
  /** Every project represented in a PROJECT_ACTIVITY aggregate. */
  projectIds?: string[];
  send: () => Promise<void>;
};

export type DispatchResult = "sent" | "duplicate" | "ineligible" | "notAccepted" | "unknown";

/** Only a producer with positive evidence of non-acceptance may permit retry. */
export class NotificationNotAcceptedError extends Error {}

type ClaimKey = { userId: string; organizationId: string; category: OptionalNotificationCategory; periodStart: Date };
type Claim = { id: string; claimedAt: Date };
type ClaimOperations = {
  create: (key: ClaimKey, now: Date) => Promise<Claim>;
  reclaim: (key: ClaimKey, now: Date, staleBefore: Date) => Promise<Claim | null>;
};

export async function acquireNotificationClaim(key: ClaimKey, now: Date, operations: ClaimOperations): Promise<Claim | null> {
  try { return await operations.create(key, now); }
  catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    return operations.reclaim(key, now, new Date(now.getTime() - NOTIFICATION_CLAIM_TTL_MS));
  }
}

/**
 * Dispatches one aggregated category digest per user/workspace/period. Producers
 * must aggregate all events before calling this function. Individual events do
 * not claim separate keys. No producer is installed for future categories yet.
 */
export async function dispatchOptionalNotification(input: DispatchInput): Promise<DispatchResult> {
  if (notificationPeriodStart(input.frequency, input.periodStart).getTime() !== input.periodStart.getTime()) {
    throw new Error("periodStart must be the start of its UTC period");
  }

  const isEligible = async () => {
    const member = await db.organizationMember.findUnique({
      where: { userId_organizationId: { userId: input.userId, organizationId: input.organizationId } },
      select: { role: true },
    });
    const preference = await db.notificationPreference.findUnique({
      where: { userId_organizationId_category: { userId: input.userId, organizationId: input.organizationId, category: input.category } },
      select: { frequency: true },
    });
    let hasProjectAccess = false;
    if (input.category === "PROJECT_ACTIVITY") {
      const ids = input.projectIds ?? [];
      if (ids.length === 0 || new Set(ids).size !== ids.length) return false;
      const projects = await db.project.findMany({
        where: { id: { in: ids }, organizationId: input.organizationId },
        select: { id: true },
      });
      if (projects.length !== ids.length) return false;
      if (member?.role === "MEMBER") {
        const accessCount = await db.projectMember.count({ where: { userId: input.userId, projectId: { in: ids } } });
        hasProjectAccess = accessCount === ids.length;
      } else {
        hasProjectAccess = true;
      }
    }
    if (input.category === "PROJECT_ACTIVITY" && !hasProjectAccess) return false;
    return preference?.frequency === input.frequency && mayReceiveOptionalNotification({
      category: input.category,
      frequency: preference.frequency,
      role: member?.role ?? null,
      hasProjectAccess,
    });
  };

  if (!(await isEligible())) return "ineligible";
  const now = new Date();
  const key = { userId: input.userId, organizationId: input.organizationId, category: input.category, periodStart: input.periodStart };
  const claim = await acquireNotificationClaim(key, now, {
    create: (value, claimedAt) => db.notificationDelivery.create({ data: { ...value, claimedAt }, select: { id: true, claimedAt: true } }),
    reclaim: async (value, claimedAt, staleBefore) => {
      const reclaimed = await db.notificationDelivery.updateMany({
        where: { ...value, sentAt: null, claimedAt: { lt: staleBefore } },
        data: { claimedAt },
      });
      if (reclaimed.count !== 1) return null;
      const current = await db.notificationDelivery.findUnique({
        where: { userId_organizationId_category_periodStart: value },
        select: { id: true, claimedAt: true },
      });
      return current?.claimedAt.getTime() === claimedAt.getTime() ? current : null;
    },
  });
  if (!claim) return "duplicate";

  if (!(await isEligible())) {
    await db.notificationDelivery.deleteMany({ where: { id: claim.id, claimedAt: claim.claimedAt, sentAt: null } });
    return "ineligible";
  }
  const locked = await db.notificationDelivery.updateMany({
    where: { id: claim.id, claimedAt: claim.claimedAt, sentAt: null },
    data: { sentAt: NOTIFICATION_SEND_PENDING },
  });
  if (locked.count !== 1) return "duplicate";
  if (!(await isEligible())) {
    await db.notificationDelivery.deleteMany({ where: { id: claim.id, sentAt: NOTIFICATION_SEND_PENDING } });
    return "ineligible";
  }
  try {
    await input.send();
  } catch (error) {
    if (error instanceof NotificationNotAcceptedError) {
      await db.notificationDelivery.deleteMany({ where: { id: claim.id, sentAt: NOTIFICATION_SEND_PENDING } });
      return "notAccepted";
    }
    // A timeout or lost response may have happened after provider acceptance.
    // Keep the sentinel until provider evidence reconciles the status.
    return "unknown";
  }
  // A failed sentAt write must retain the sentinel so a later retry cannot
  // silently send an already accepted message again.
  await db.notificationDelivery.updateMany({
    where: { id: claim.id, sentAt: NOTIFICATION_SEND_PENDING },
    data: { sentAt: new Date() },
  });
  return "sent";
}
