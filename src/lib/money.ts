/**
 * Money math utilities. All amounts are integer minor units (agorot).
 * Never use floating point for currency — every calculation here is done
 * with BigInt so results are exact and deterministic regardless of input
 * magnitude.
 */

export interface AcvResult {
  /** The item's replacement cost (claimedAgorot), unchanged. */
  replacementCostAgorot: number;
  /** Depreciation, capped at the replacement cost. */
  depreciationAgorot: number;
  /** Actual cash value: replacementCost - depreciation, floored at 0. */
  acvAgorot: number;
}

const BPS_DENOMINATOR = 10_000n;
const MONTHS_PER_YEAR = 12n;

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer, got ${value}`);
  }
}

/**
 * FR-3.1: ACV (actual cash value) depreciation for a single claim item.
 *
 *   depreciation = round(replacementCost * annualDepBps * ageMonths / (10000 * 12))
 *   ACV          = replacementCost - min(depreciation, replacementCost)
 *
 * - Uses round-half-up (matches the assignment's worked example).
 * - Depreciation is capped at the replacement cost.
 * - ACV is floored at 0 (guaranteed by the cap, enforced again defensively).
 */
export function calculateACV(
  replacementCostAgorot: number,
  ageMonths: number,
  annualDepBps: number,
): AcvResult {
  assertNonNegativeInteger(replacementCostAgorot, "replacementCostAgorot");
  assertNonNegativeInteger(ageMonths, "ageMonths");
  assertNonNegativeInteger(annualDepBps, "annualDepBps");

  const replacementCost = BigInt(replacementCostAgorot);
  const bps = BigInt(annualDepBps);
  const months = BigInt(ageMonths);
  const denominator = BPS_DENOMINATOR * MONTHS_PER_YEAR; // 120,000

  const numerator = replacementCost * bps * months;

  // Round-half-up integer division. Exact because `denominator` is always
  // even, so denominator/2 is never truncated.
  const rawDepreciation = (numerator + denominator / 2n) / denominator;

  const depreciation =
    rawDepreciation > replacementCost ? replacementCost : rawDepreciation;

  const rawAcv = replacementCost - depreciation;
  const acv = rawAcv < 0n ? 0n : rawAcv;

  return {
    replacementCostAgorot,
    depreciationAgorot: Number(depreciation),
    acvAgorot: Number(acv),
  };
}

/** Formats an integer agorot amount as a currency string, e.g. 150070 -> "1,500.70". */
export function formatAgorot(amountAgorot: number): string {
  if (!Number.isInteger(amountAgorot)) {
    throw new Error(`amountAgorot must be an integer, got ${amountAgorot}`);
  }
  const sign = amountAgorot < 0 ? "-" : "";
  const absolute = Math.abs(amountAgorot);
  const whole = Math.trunc(absolute / 100);
  const cents = absolute % 100;
  return `${sign}${whole.toLocaleString("en-US")}.${cents.toString().padStart(2, "0")}`;
}
