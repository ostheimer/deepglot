import type { Client } from "pg";

export const REQUIRED_PLAN_VALUES = [
  "FREE",
  "STARTER",
  "BUSINESS",
  "PRO",
  "ADVANCED",
  "EXTENDED",
  "ENTERPRISE",
] as const;

export type PlanSchemaSnapshot = {
  enumValues: readonly string[];
  professionalOrganizations: number;
  professionalSubscriptions: number;
};

export type PlanSchemaAssessment = {
  ready: boolean;
  missingPlanValues: string[];
  professionalOrganizations: number;
  professionalSubscriptions: number;
};

type PlanSchemaClient = Pick<Client, "query">;

export function assessPlanSchema(snapshot: PlanSchemaSnapshot): PlanSchemaAssessment {
  const enumValues = new Set(snapshot.enumValues);
  const missingPlanValues = REQUIRED_PLAN_VALUES.filter(
    (plan) => !enumValues.has(plan)
  );

  return {
    ready:
      missingPlanValues.length === 0 &&
      snapshot.professionalOrganizations === 0 &&
      snapshot.professionalSubscriptions === 0,
    missingPlanValues,
    professionalOrganizations: snapshot.professionalOrganizations,
    professionalSubscriptions: snapshot.professionalSubscriptions,
  };
}

export async function inspectPlanSchema(
  client: PlanSchemaClient
): Promise<PlanSchemaSnapshot> {
  const enumResult = await client.query<{ value: string }>(`
    SELECT enum_value.enumlabel AS value
    FROM pg_catalog.pg_type AS enum_type
    INNER JOIN pg_catalog.pg_enum AS enum_value
      ON enum_value.enumtypid = enum_type.oid
    INNER JOIN pg_catalog.pg_namespace AS enum_namespace
      ON enum_namespace.oid = enum_type.typnamespace
    WHERE enum_namespace.nspname = 'public'
      AND enum_type.typname = 'Plan'
    ORDER BY enum_value.enumsortorder
  `);

  const legacyRowsResult = await client.query<{
    professional_organizations: string;
    professional_subscriptions: string;
  }>(`
    SELECT
      (
        SELECT COUNT(*)::text
        FROM public."Organization"
        WHERE plan::text = 'PROFESSIONAL'
      ) AS professional_organizations,
      (
        SELECT COUNT(*)::text
        FROM public."Subscription"
        WHERE plan::text = 'PROFESSIONAL'
      ) AS professional_subscriptions
  `);

  const legacyRows = legacyRowsResult.rows[0];

  return {
    enumValues: enumResult.rows.map((row) => row.value),
    professionalOrganizations: parseRowCount(
      legacyRows?.professional_organizations,
      "Organization"
    ),
    professionalSubscriptions: parseRowCount(
      legacyRows?.professional_subscriptions,
      "Subscription"
    ),
  };
}

function parseRowCount(value: string | undefined, table: string) {
  const count = Number(value);

  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error(`Could not read the deprecated plan row count for ${table}.`);
  }

  return count;
}
