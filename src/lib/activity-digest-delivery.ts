import { Prisma } from "@prisma/client";

import {
  buildActivityDigestSummary,
  getPreviousActivityDigestPeriod,
  hasActivityDigestActivity,
  type ActivityDigestSummary,
} from "@/lib/activity-digest";
import { getAppBaseUrl } from "@/lib/billing";
import { db } from "@/lib/db";
import { canSendEmail, sendActivityDigestEmail } from "@/lib/email";
import { canAccessProject } from "@/lib/project-access-policy";
import { isSiteLocale, withLocalePrefix } from "@/lib/site-locale";

type DigestRecipient = {
  userId: string;
  email: string;
  locale: string;
  organizationId: string;
  organizationName: string;
  organizationRole: "OWNER" | "ADMIN" | "MEMBER";
  projectIds: string[];
};

type DigestProject = {
  id: string;
  name: string;
  domain: string;
  organizationId: string;
};

type ActivityDigestClaimInput = {
  organizationId: string;
  recipientUserId: string;
  periodStart: Date;
  periodEnd: Date;
};

type ActivityDigestClaim = {
  id: string;
  claimedAt: Date;
};

type ActivityDigestClaimOperations = {
  create: (
    input: ActivityDigestClaimInput,
    claimedAt: Date,
  ) => Promise<ActivityDigestClaim>;
  reclaim: (
    input: ActivityDigestClaimInput & {
      staleBefore: Date;
      claimedAt: Date;
    },
  ) => Promise<ActivityDigestClaim | null>;
};

type RecipientOutcome = "sent" | "duplicate" | "withoutActivity" | "failed";

export const ACTIVITY_DIGEST_CLAIM_TTL_MS = 15 * 60 * 1000;
export const ACTIVITY_DIGEST_SEND_CONCURRENCY = 4;

export type ActivityDigestRunResult = {
  configured: boolean;
  periodStart: string;
  periodEnd: string;
  eligible: number;
  sent: number;
  duplicates: number;
  withoutActivity: number;
  failed: number;
};

function isUniqueConstraintError(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

export function projectIdsForDigestRecipient(
  recipient: Pick<
    DigestRecipient,
    "organizationId" | "organizationRole" | "projectIds"
  >,
  projects: Array<Pick<DigestProject, "id" | "organizationId">>,
) {
  const organizationProjects = projects.filter(
    (project) => project.organizationId === recipient.organizationId,
  );

  const explicitProjectIds = new Set(recipient.projectIds);
  return organizationProjects
    .filter((project) =>
      canAccessProject({
        organizationRole: recipient.organizationRole,
        projectRole: explicitProjectIds.has(project.id) ? "TRANSLATOR" : null,
      }),
    )
    .map((project) => project.id);
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  maxConcurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1) {
    throw new RangeError("maxConcurrency must be a positive integer");
  }

  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index]!, index);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(maxConcurrency, items.length) }, () =>
      worker(),
    ),
  );
  return results;
}

const activityDigestClaimOperations: ActivityDigestClaimOperations = {
  create: (input, claimedAt) =>
    db.activityDigestDelivery.create({
      data: { ...input, claimedAt },
      select: { id: true, claimedAt: true },
    }),
  reclaim: async ({ staleBefore, claimedAt, ...input }) => {
    const [claim] = await db.activityDigestDelivery.updateManyAndReturn({
      where: {
        organizationId: input.organizationId,
        recipientUserId: input.recipientUserId,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        sentAt: null,
        claimedAt: { lt: staleBefore },
      },
      data: { claimedAt },
      select: { id: true, claimedAt: true },
    });
    return claim ?? null;
  },
};

export async function acquireActivityDigestClaim(
  input: ActivityDigestClaimInput,
  claimedAt = new Date(),
  operations: ActivityDigestClaimOperations = activityDigestClaimOperations,
) {
  try {
    return await operations.create(input, claimedAt);
  } catch (error) {
    if (!isUniqueConstraintError(error)) {
      throw error;
    }
  }

  return operations.reclaim({
    ...input,
    claimedAt,
    staleBefore: new Date(claimedAt.getTime() - ACTIVITY_DIGEST_CLAIM_TTL_MS),
  });
}

function digestRecipientKey(
  recipient: Pick<DigestRecipient, "organizationId" | "userId">,
) {
  return `${recipient.organizationId}:${recipient.userId}`;
}

async function loadDigestSummaries(
  recipients: DigestRecipient[],
  period: { start: Date; end: Date },
) {
  const organizationIds = [
    ...new Set(recipients.map((recipient) => recipient.organizationId)),
  ];
  const projects: DigestProject[] = await db.project.findMany({
    where: { organizationId: { in: organizationIds } },
    select: { id: true, name: true, domain: true, organizationId: true },
  });
  const projectIds = projects.map((project) => project.id);

  if (projectIds.length === 0) {
    return new Map<string, ActivityDigestSummary>();
  }

  const [translationGroups, batchGroups] = await Promise.all([
    db.translation.groupBy({
      by: ["projectId"],
      where: {
        projectId: { in: projectIds },
        createdAt: { gte: period.start, lt: period.end },
      },
      _count: { _all: true },
      _sum: { wordCount: true },
    }),
    db.translationBatchLog.groupBy({
      by: ["projectId", "provider"],
      where: {
        projectId: { in: projectIds },
        createdAt: { gte: period.start, lt: period.end },
      },
      _count: { _all: true },
      _sum: { manualWords: true },
    }),
  ]);

  const summaries = new Map<string, ActivityDigestSummary>();

  for (const recipient of recipients) {
    const recipientProjectIds = new Set(
      projectIdsForDigestRecipient(recipient, projects),
    );
    const recipientProjects = projects.filter((project) =>
      recipientProjectIds.has(project.id),
    );
    const summary = buildActivityDigestSummary({
      organizationName: recipient.organizationName,
      period,
      projects: recipientProjects.map(({ id, name, domain }) => ({
        id,
        name,
        domain,
      })),
      translationGroups: translationGroups
        .filter((group) => recipientProjectIds.has(group.projectId))
        .map((group) => ({
          projectId: group.projectId,
          count: group._count._all,
          wordCount: group._sum.wordCount ?? 0,
        })),
      batchGroups: batchGroups
        .filter((group) => recipientProjectIds.has(group.projectId))
        .map((group) => ({
          projectId: group.projectId,
          provider: group.provider,
          count: group._count._all,
          manualWords: group._sum.manualWords ?? 0,
        })),
    });
    summaries.set(digestRecipientKey(recipient), summary);
  }

  return summaries;
}

/**
 * Sends one opt-in digest per user/workspace for the last complete UTC week.
 * Claims are inserted before sending to deduplicate concurrent invocations.
 * Provider failures release the owned lease; stale unsent leases are reclaimed
 * after the TTL so a crashed invocation cannot suppress a digest forever.
 */
export async function processWeeklyActivityDigests({
  now = new Date(),
}: {
  now?: Date;
} = {}): Promise<ActivityDigestRunResult> {
  const period = getPreviousActivityDigestPeriod(now);
  const baseResult: ActivityDigestRunResult = {
    configured: canSendEmail(),
    periodStart: period.start.toISOString(),
    periodEnd: period.end.toISOString(),
    eligible: 0,
    sent: 0,
    duplicates: 0,
    withoutActivity: 0,
    failed: 0,
  };

  if (!baseResult.configured) {
    return baseResult;
  }

  const memberships = await db.organizationMember.findMany({
    where: { activityDigestEnabled: true },
    select: {
      userId: true,
      role: true,
      activityDigestLocale: true,
      user: {
        select: {
          email: true,
          projectMemberships: { select: { projectId: true } },
        },
      },
      organization: { select: { id: true, name: true } },
    },
  });
  const recipients: DigestRecipient[] = memberships.map((membership) => ({
    userId: membership.userId,
    email: membership.user.email,
    locale: membership.activityDigestLocale,
    organizationId: membership.organization.id,
    organizationName: membership.organization.name,
    organizationRole: membership.role,
    projectIds: membership.user.projectMemberships.map(
      (projectMembership) => projectMembership.projectId,
    ),
  }));
  const result = { ...baseResult, eligible: recipients.length };

  if (recipients.length === 0) {
    return result;
  }

  const summaries = await loadDigestSummaries(recipients, period);
  const appBaseUrl = getAppBaseUrl();

  const outcomes = await mapWithConcurrency(
    recipients,
    ACTIVITY_DIGEST_SEND_CONCURRENCY,
    async (recipient): Promise<RecipientOutcome> => {
      const summary = summaries.get(digestRecipientKey(recipient));
      if (!summary || !hasActivityDigestActivity(summary)) {
        return "withoutActivity";
      }

      const locale = isSiteLocale(recipient.locale) ? recipient.locale : "en";
      const dashboardUrl = new URL(
        withLocalePrefix("/projects", locale),
        appBaseUrl,
      ).toString();
      const settingsUrl = new URL(
        withLocalePrefix("/settings", locale),
        appBaseUrl,
      ).toString();

      const claim = await acquireActivityDigestClaim({
        organizationId: recipient.organizationId,
        recipientUserId: recipient.userId,
        periodStart: period.start,
        periodEnd: period.end,
      });
      if (!claim) {
        return "duplicate";
      }

      try {
        const delivery = await sendActivityDigestEmail({
          to: recipient.email,
          locale,
          summary,
          dashboardUrl,
          settingsUrl,
          signal: AbortSignal.timeout(10_000),
        });

        if (!delivery.sent) {
          throw new Error("Activity digest email is not configured.");
        }
      } catch (error) {
        await db.activityDigestDelivery
          .deleteMany({
            where: { id: claim.id, claimedAt: claim.claimedAt, sentAt: null },
          })
          .catch(() => {});
        console.error("[activity-digest] failed to send weekly digest", error);
        return "failed";
      }

      // Once the provider accepted the email, the unique claim must remain even
      // if this observability update fails. Deleting it here would let a retry
      // send a duplicate message to the recipient.
      await db.activityDigestDelivery
        .updateMany({
          where: { id: claim.id, claimedAt: claim.claimedAt, sentAt: null },
          data: { sentAt: new Date() },
        })
        .catch((error) => {
          console.error(
            "[activity-digest] email sent but sentAt could not be recorded",
            error,
          );
        });
      return "sent";
    },
  );

  for (const outcome of outcomes) {
    if (outcome === "sent") result.sent += 1;
    else if (outcome === "duplicate") result.duplicates += 1;
    else if (outcome === "withoutActivity") result.withoutActivity += 1;
    else result.failed += 1;
  }

  return result;
}
