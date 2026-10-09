import type { TranslationExecutionOptions } from "@/lib/translation";

export type AiBudgetEnforcementState = "inactive" | "active";

/** A missing setting deliberately leaves the pre-activation translation path intact. */
export function aiBudgetEnforcementState(value?: string): AiBudgetEnforcementState {
  if (value === undefined || value === "off") return "inactive";
  if (value === "on") return "active";
  throw new Error("AI_BUDGET_ENFORCEMENT must be 'on' or 'off'.");
}

export function currentAiBudgetEnforcementState(): AiBudgetEnforcementState {
  return aiBudgetEnforcementState(process.env.AI_BUDGET_ENFORCEMENT);
}

/** Every provider attempt, including fallback and count-mismatch retries, shares this gate. */
export function selectAiBudgetSpendControl(
  state: AiBudgetEnforcementState,
  control: NonNullable<TranslationExecutionOptions["spendControl"]>,
): TranslationExecutionOptions["spendControl"] {
  return state === "active" ? control : undefined;
}
