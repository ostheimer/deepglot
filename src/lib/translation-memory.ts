export type TranslationMemoryHit = {
  originalHash: string;
  translatedText: string;
  updatedAt: Date;
};

export type TranslationMemoryStore = {
  translation: {
    findMany(args: {
      where: {
        project: { organizationId: string };
        projectId: { not: string };
        originalHash: { in: string[] };
        langFrom: string;
        langTo: string;
        workflowStatus: "APPROVED";
      };
      select: {
        originalHash: true;
        translatedText: true;
        updatedAt: true;
      };
      orderBy: { updatedAt: "desc" };
    }): Promise<TranslationMemoryHit[]>;
  };
};

export function planSupportsTranslationMemory(
  plan: string | null | undefined
) {
  const canonical = resolveBillingPlanKey(plan);
  return (
    BILLING_PLAN_KEYS.indexOf(canonical) >= BILLING_PLAN_KEYS.indexOf("PRO")
  );
}

export async function findOrganizationTranslationMemory(
  store: TranslationMemoryStore,
  input: {
    organizationId: string;
    targetProjectId: string;
    originalHashes: string[];
    langFrom: string;
    langTo: string;
  }
) {
  if (input.originalHashes.length === 0) {
    return new Map<string, TranslationMemoryHit>();
  }

  const rows = await store.translation.findMany({
    where: {
      project: { organizationId: input.organizationId },
      projectId: { not: input.targetProjectId },
      originalHash: { in: [...new Set(input.originalHashes)] },
      langFrom: input.langFrom,
      langTo: input.langTo,
      workflowStatus: "APPROVED",
    },
    select: {
      originalHash: true,
      translatedText: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: "desc" },
  });

  const hits = new Map<string, TranslationMemoryHit>();
  for (const row of rows) {
    if (!hits.has(row.originalHash)) {
      hits.set(row.originalHash, row);
    }
  }

  return hits;
}
import {
  BILLING_PLAN_KEYS,
  resolveBillingPlanKey,
} from "@/lib/billing-plans";
