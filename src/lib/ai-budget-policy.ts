import { z } from "zod";

const decimalMicros = z.string().regex(/^(0|[1-9][0-9]{0,14})$/);
const supportedCurrencies = new Set(Intl.supportedValuesOf("currency"));
const modelApproval = z.object({
  provider: z.enum(["openai", "gemini", "openrouter", "ollama", "openai-compatible", "deepl", "mock"]),
  model: z.string().trim().min(1).max(160),
  unit: z.enum(["TOKEN", "CHARACTER", "ZERO_COST"]),
  inputMicrosPerMillion: decimalMicros,
  outputMicrosPerMillion: decimalMicros,
  maxInputUnits: z.number().int().min(1).max(10_000_000),
  maxOutputUnits: z.number().int().min(0).max(100_000),
  outputCapVerified: z.boolean().default(false),
  priceExpiresAt: z.iso.datetime({ offset: true }),
}).superRefine((value, ctx) => {
  if (value.provider === "deepl" && (value.unit !== "CHARACTER" || value.maxOutputUnits !== 0)) {
    ctx.addIssue({ code: "custom", message: "DeepL must use source characters and zero output units." });
  }
  if (value.provider !== "deepl" && value.provider !== "mock" && value.unit !== "TOKEN" && value.unit !== "ZERO_COST") {
    ctx.addIssue({ code: "custom", message: "Language models must use token units." });
  }
  if (value.unit === "ZERO_COST" && (value.inputMicrosPerMillion !== "0" || value.outputMicrosPerMillion !== "0")) {
    ctx.addIssue({ code: "custom", message: "Zero-cost approval requires zero rates." });
  }
  if (value.unit === "ZERO_COST" && value.provider !== "mock" && value.provider !== "ollama") {
    ctx.addIssue({ code: "custom", message: "Externally billed providers require a positive approved ceiling." });
  }
  if (value.unit !== "ZERO_COST" && value.inputMicrosPerMillion === "0" && value.outputMicrosPerMillion === "0") {
    ctx.addIssue({ code: "custom", message: "Billable provider ceilings cannot both be zero." });
  }
  if (value.provider === "mock" && value.unit !== "ZERO_COST") {
    ctx.addIssue({ code: "custom", message: "Mock must use the zero-cost unit." });
  }
});

export const aiBudgetPolicyInput = z.object({
  scope: z.enum(["organization", "project"]),
  currency: z.string().regex(/^[A-Z]{3}$/).refine((value) => supportedCurrencies.has(value),
    "Unsupported ISO currency"),
  capMicros: decimalMicros,
  perCallCapMicros: decimalMicros,
  warningPercent: z.number().int().min(1).max(99),
  period: z.literal("MONTHLY_UTC"),
  models: z.array(modelApproval).min(1).max(30),
}).superRefine((value, ctx) => {
  if (BigInt(value.perCallCapMicros) > BigInt(value.capMicros)) {
    ctx.addIssue({ code: "custom", message: "Per-call cap must not exceed period cap." });
  }
  const keys = value.models.map((item) => `${item.provider}\0${item.model}`);
  if (new Set(keys).size !== keys.length) {
    ctx.addIssue({ code: "custom", message: "Provider/model approval must be unique." });
  }
  const now = Date.now();
  for (const [index, model] of value.models.entries()) {
    const expires = new Date(model.priceExpiresAt).getTime();
    if (expires <= now || expires > now + 90 * 24 * 60 * 60 * 1000) {
      ctx.addIssue({ code: "custom", path: ["models", index, "priceExpiresAt"], message: "Price approval must expire within 90 days." });
    }
  }
});

export type AiBudgetPolicyInput = z.infer<typeof aiBudgetPolicyInput>;
