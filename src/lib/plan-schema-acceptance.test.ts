import assert from "node:assert/strict";
import test from "node:test";

import { assessPlanSchema } from "@/lib/plan-schema-acceptance";

test("rejects the pre-plan-rework enum from the shared development database", () => {
  assert.deepEqual(
    assessPlanSchema({
      enumValues: ["FREE", "STARTER", "PROFESSIONAL", "ENTERPRISE"],
      professionalOrganizations: 0,
      professionalSubscriptions: 0,
    }),
    {
      ready: false,
      missingPlanValues: ["BUSINESS", "PRO", "ADVANCED", "EXTENDED"],
      professionalOrganizations: 0,
      professionalSubscriptions: 0,
    }
  );
});

test("requires legacy PROFESSIONAL rows to be normalized before schema acceptance", () => {
  assert.deepEqual(
    assessPlanSchema({
      enumValues: [
        "FREE",
        "STARTER",
        "BUSINESS",
        "PRO",
        "ADVANCED",
        "EXTENDED",
        "ENTERPRISE",
        "PROFESSIONAL",
      ],
      professionalOrganizations: 2,
      professionalSubscriptions: 1,
    }),
    {
      ready: false,
      missingPlanValues: [],
      professionalOrganizations: 2,
      professionalSubscriptions: 1,
    }
  );
});

test("accepts all canonical plan values when no rows use the deprecated alias", () => {
  assert.deepEqual(
    assessPlanSchema({
      enumValues: [
        "FREE",
        "STARTER",
        "BUSINESS",
        "PRO",
        "ADVANCED",
        "EXTENDED",
        "ENTERPRISE",
        "PROFESSIONAL",
      ],
      professionalOrganizations: 0,
      professionalSubscriptions: 0,
    }),
    {
      ready: true,
      missingPlanValues: [],
      professionalOrganizations: 0,
      professionalSubscriptions: 0,
    }
  );
});
