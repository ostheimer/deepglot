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
import { isSiteLocale, withLocalePrefix } from "@/lib/site-locale";

type DigestRecipient = {
  userId: string;
  email: string;
  locale: string;
  organizationId: string;
  organizationName: string;
};

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

async function loadDigestSummaries(
  recipients: DigestRecipient[],
  period: { start: Date; end: Date }
) {
  const organizationIds = [
    ...new Set(recipients.map((recipient) => recipient.organizationId)),
  ];
  const projects = await db.project.findMany({
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

  const organizationNames = new Map(
    recipients.map((recipient) => [
      recipient.organizationId,
      recipient.organizationName,
    ])
  );
  const organizationByProject = new Map(
    projects.map((project) => [project.id, project.organizationId])
  );
  const summaries = new Map<string, ActivityDigestSummary>();

  for (const organizationId of organizationIds) {
    const organizationProjects = projects.filter(
      (project) => project.organizationId === organizationId
    );
    const organizationProjectIds = new Set(
      organizationProjects.map((project) => project.id)
    );
    const summary = buildActivityDigestSummary({
      organizationName: organizationNames.get(organizationId) ?? "Deepglot",
      period,
      projects: organizationProjects.map(({ id, name, domain }) => ({
        id,
        name,
        domain,
      })),
      translationGroups: translationGroups
        .filter(
          (group) =>
            organizationByProject.get(group.projectId) === organizationId &&
            organizationProjectIds.has(group.projectId)
        )
        .map((group) => ({
          projectId: group.projectId,
          count: group._count._all,
          wordCount: group._sum.wordCount ?? 0,
        })),
      batchGroups: batchGroups
        .filter(
          (group) =>
            organizationByProject.get(group.projectId) === organizationId &&
            organizationProjectIds.has(group.projectId)
        )
        .map((group) => ({
          projectId: group.projectId,
          provider: group.provider,
          count: group._count._all,
          manualWords: group._sum.manualWords ?? 0,
        })),
    });
    summaries.set(organizationId, summary);
  }

  return summaries;
}

/**
 * Sends one opt-in digest per user/workspace for the last complete UTC week.
 * Claims are inserted before sending to deduplicate concurrent invocations and
 * removed after provider failures so Vercel retries can try again safely.
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
      activityDigestLocale: true,
      user: { select: { email: true } },
      organization: { select: { id: true, name: true } },
    },
  });
  const recipients: DigestRecipient[] = memberships.map((membership) => ({
    userId: membership.userId,
    email: membership.user.email,
    locale: membership.activityDigestLocale,
    organizationId: membership.organization.id,
    organizationName: membership.organization.name,
  }));
  const result = { ...baseResult, eligible: recipients.length };

  if (recipients.length === 0) {
    return result;
  }

  const summaries = await loadDigestSummaries(recipients, period);
  const appBaseUrl = getAppBaseUrl();

  for (const recipient of recipients) {
    const summary = summaries.get(recipient.organizationId);
    if (!summary || !hasActivityDigestActivity(summary)) {
      result.withoutActivity += 1;
      continue;
    }

    const locale = isSiteLocale(recipient.locale) ? recipient.locale : "en";
    const dashboardUrl = new URL(
      withLocalePrefix("/projects", locale),
      appBaseUrl
    ).toString();
    const settingsUrl = new URL(
      withLocalePrefix("/settings", locale),
      appBaseUrl
    ).toString();

    let claimId: string;
    try {
      const claim = await db.activityDigestDelivery.create({
        data: {
          organizationId: recipient.organizationId,
          recipientUserId: recipient.userId,
          periodStart: period.start,
          periodEnd: period.end,
        },
        select: { id: true },
      });
      claimId = claim.id;
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        result.duplicates += 1;
        continue;
      }
      throw error;
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
        .deleteMany({ where: { id: claimId, sentAt: null } })
        .catch(() => {});
      result.failed += 1;
      console.error(
        "[activity-digest] failed to send weekly digest",
        error
      );
      continue;
    }

    // Once the provider accepted the email, the unique claim must remain even
    // if this observability update fails. Deleting it here would let a retry
    // send a duplicate message to the recipient.
    await db.activityDigestDelivery
      .update({
        where: { id: claimId },
        data: { sentAt: new Date() },
      })
      .catch((error) => {
        console.error(
          "[activity-digest] email sent but sentAt could not be recorded",
          error
        );
      });
    result.sent += 1;
  }

  return result;
}
