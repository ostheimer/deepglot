/** Money is integer micros of the configured ISO currency, never floats. */
export const AI_PRICE_DENOMINATOR = BigInt(1_000_000);

export type AiPriceUnit = "TOKEN" | "CHARACTER" | "ZERO_COST";

export type ApprovedPrice = {
  unit: AiPriceUnit;
  inputMicrosPerMillion: bigint;
  outputMicrosPerMillion: bigint;
  maxInputUnits: number;
  maxOutputUnits: number;
  priceExpiresAt: Date;
};

export class AiBudgetError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "AiBudgetError";
  }
}

export function utcPeriodKey(date: Date): number {
  if (!Number.isFinite(date.getTime())) throw new AiBudgetError("budget_unavailable", "Invalid clock");
  return date.getUTCFullYear() * 100 + date.getUTCMonth() + 1;
}

export function ceilDiv(value: bigint, denominator: bigint): bigint {
  if (value < BigInt(0) || denominator <= BigInt(0)) throw new AiBudgetError("budget_unavailable", "Invalid price units");
  return (value + denominator - BigInt(1)) / denominator;
}

export function quotedMicros(price: ApprovedPrice, inputUnits: number, outputUnits: number, now: Date): bigint {
  if (price.priceExpiresAt.getTime() <= now.getTime()) {
    throw new AiBudgetError("price_stale", "The approved provider price ceiling has expired.");
  }
  if (!Number.isSafeInteger(inputUnits) || inputUnits < 0 || inputUnits > price.maxInputUnits ||
      !Number.isSafeInteger(outputUnits) || outputUnits < 0 || outputUnits > price.maxOutputUnits) {
    throw new AiBudgetError("estimate_unbounded", "The provider request exceeds the approved unit ceiling.");
  }
  if (price.inputMicrosPerMillion < BigInt(0) || price.outputMicrosPerMillion < BigInt(0)) {
    throw new AiBudgetError("price_unavailable", "The approved price ceiling is invalid.");
  }
  return ceilDiv(BigInt(inputUnits) * price.inputMicrosPerMillion +
    BigInt(outputUnits) * price.outputMicrosPerMillion, AI_PRICE_DENOMINATOR);
}

/** UTF-8 bytes bound token count without relying on a provider tokenizer. */
export function conservativeInputUnits(input: unknown, unit: AiPriceUnit): number {
  const encoded = JSON.stringify(input);
  if (unit === "ZERO_COST") return 0;
  if (unit === "CHARACTER") return Array.from(encoded).length;
  // Includes system prompt, JSON syntax and adapter fields; adapters must
  // reject bodies larger than this bound before their HTTP dispatch.
  return Buffer.byteLength(encoded, "utf8") + 4096;
}

export function spendWithinCap(currentMicros: bigint, proposedMicros: bigint, capMicros: bigint): boolean {
  return currentMicros >= BigInt(0) && proposedMicros >= BigInt(0) && capMicros >= BigInt(0) &&
    currentMicros <= capMicros && proposedMicros <= capMicros - currentMicros;
}
