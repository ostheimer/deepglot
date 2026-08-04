export type ActivityDigestPeriod = {
  /** Inclusive UTC boundary. */
  start: Date;
  /** Exclusive UTC boundary. */
  end: Date;
};

export type ActivityDigestProjectInput = {
  id: string;
  name: string;
  domain: string;
};

export type ActivityDigestTranslationGroup = {
  projectId: string;
  count: number;
  wordCount: number;
};

export type ActivityDigestBatchGroup = {
  projectId: string;
  provider: string;
  count: number;
  manualWords: number;
};

export type ActivityDigestMetrics = {
  newTranslations: number;
  newWords: number;
  manualTranslations: number;
  manualWords: number;
  translationRequests: number;
};

export type ActivityDigestProject = ActivityDigestProjectInput &
  ActivityDigestMetrics;

export type ActivityDigestSummary = {
  organizationName: string;
  period: ActivityDigestPeriod;
  totals: ActivityDigestMetrics;
  projects: ActivityDigestProject[];
};

const EMPTY_METRICS: ActivityDigestMetrics = {
  newTranslations: 0,
  newWords: 0,
  manualTranslations: 0,
  manualWords: 0,
  translationRequests: 0,
};

const NON_RUNTIME_BATCH_PROVIDERS = new Set(["manual", "import"]);

export function getPreviousActivityDigestPeriod(
  now = new Date()
): ActivityDigestPeriod {
  const currentWeekStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
  const mondayOffset = (currentWeekStart.getUTCDay() + 6) % 7;
  currentWeekStart.setUTCDate(currentWeekStart.getUTCDate() - mondayOffset);

  const start = new Date(currentWeekStart);
  start.setUTCDate(start.getUTCDate() - 7);

  return { start, end: currentWeekStart };
}

export function buildActivityDigestSummary({
  organizationName,
  period,
  projects,
  translationGroups,
  batchGroups,
}: {
  organizationName: string;
  period: ActivityDigestPeriod;
  projects: ActivityDigestProjectInput[];
  translationGroups: ActivityDigestTranslationGroup[];
  batchGroups: ActivityDigestBatchGroup[];
}): ActivityDigestSummary {
  const metricsByProject = new Map<string, ActivityDigestMetrics>();
  const metricsFor = (projectId: string) => {
    const existing = metricsByProject.get(projectId);
    if (existing) return existing;
    const metrics = { ...EMPTY_METRICS };
    metricsByProject.set(projectId, metrics);
    return metrics;
  };

  for (const group of translationGroups) {
    const metrics = metricsFor(group.projectId);
    metrics.newTranslations += Math.max(0, group.count);
    metrics.newWords += Math.max(0, group.wordCount);
  }

  for (const group of batchGroups) {
    const metrics = metricsFor(group.projectId);
    const provider = group.provider.trim().toLowerCase();

    if (provider === "manual") {
      metrics.manualTranslations += Math.max(0, group.count);
      metrics.manualWords += Math.max(0, group.manualWords);
    } else if (!NON_RUNTIME_BATCH_PROVIDERS.has(provider)) {
      metrics.translationRequests += Math.max(0, group.count);
    }
  }

  const digestProjects = projects
    .map((project) => ({
      ...project,
      ...(metricsByProject.get(project.id) ?? EMPTY_METRICS),
    }))
    .filter((project) =>
      Object.values({
        newTranslations: project.newTranslations,
        newWords: project.newWords,
        manualTranslations: project.manualTranslations,
        manualWords: project.manualWords,
        translationRequests: project.translationRequests,
      }).some((value) => value > 0)
    )
    .sort((left, right) => {
      const leftActivity =
        left.newTranslations +
        left.manualTranslations +
        left.translationRequests;
      const rightActivity =
        right.newTranslations +
        right.manualTranslations +
        right.translationRequests;
      return rightActivity - leftActivity || left.name.localeCompare(right.name);
    });

  const totals = digestProjects.reduce<ActivityDigestMetrics>(
    (sum, project) => ({
      newTranslations: sum.newTranslations + project.newTranslations,
      newWords: sum.newWords + project.newWords,
      manualTranslations:
        sum.manualTranslations + project.manualTranslations,
      manualWords: sum.manualWords + project.manualWords,
      translationRequests:
        sum.translationRequests + project.translationRequests,
    }),
    { ...EMPTY_METRICS }
  );

  return { organizationName, period, totals, projects: digestProjects };
}

export function hasActivityDigestActivity(summary: ActivityDigestSummary) {
  return (
    summary.totals.newTranslations > 0 ||
    summary.totals.manualTranslations > 0 ||
    summary.totals.translationRequests > 0
  );
}
