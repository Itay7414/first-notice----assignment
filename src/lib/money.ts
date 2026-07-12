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

export interface ApportionedShare {
  id: string;
  /** This item's share of the limit, in integer agorot. */
  shareAgorot: bigint;
}

/**
 * FR-3.2: Apportion a shared limit (e.g. a policy's per-occurrence limit)
 * across claim items in proportion to each item's ACV.
 *
 * If the items' combined ACV already fits within the limit, no apportionment
 * is needed — every item simply keeps its full ACV.
 *
 * Otherwise, the limit is short by definition, so it must be distributed
 * proportionally using the Largest-Remainder (Hamilton) method, entirely in
 * integer (BigInt) arithmetic so the result is exact and deterministic:
 *
 *   1. Give each item a baseline "floor" share: floor(limit * acv_i / total).
 *   2. The floors under-allocate by some number of leftover agorot
 *      (`limit - sum(floors)`), because of the truncation in step 1.
 *   3. Distribute those leftover agorot one at a time to the items with the
 *      largest remainder from step 1's division (largest fractional part
 *      first).
 *   4. Ties in remainder are broken deterministically by sorting the tied
 *      items alphabetically by id.
 *
 * The shares always sum to exactly `limitAgorot` — never a agorot more or
 * less — regardless of how items are ordered or how large the amounts are.
 */
export function apportionLimit(
  items: { id: string; acv: bigint }[],
  limitAgorot: bigint,
): ApportionedShare[] {
  if (limitAgorot < 0n) {
    throw new Error(`limitAgorot must be non-negative, got ${limitAgorot}`);
  }
  for (const item of items) {
    if (item.acv < 0n) {
      throw new Error(`Item "${item.id}" has a negative acv (${item.acv})`);
    }
  }

  const totalAcv = items.reduce((sum, item) => sum + item.acv, 0n);

  // Enough limit for everyone: no apportionment necessary.
  if (totalAcv <= limitAgorot) {
    return items.map((item) => ({ id: item.id, shareAgorot: item.acv }));
  }

  // totalAcv > limitAgorot >= 0, so totalAcv > 0n here: safe to divide by.
  const allocations = items.map((item) => {
    const scaled = limitAgorot * item.acv;
    return {
      id: item.id,
      floor: scaled / totalAcv,
      remainder: scaled % totalAcv,
    };
  });

  const sumOfFloors = allocations.reduce((sum, a) => sum + a.floor, 0n);
  // Guaranteed to be in [0, items.length) — see the Hamilton method's
  // "quota" property: it's impossible to be short by a full item's worth.
  let leftoverUnits = limitAgorot - sumOfFloors;

  const byRemainderDesc = [...allocations].sort((a, b) => {
    if (a.remainder !== b.remainder) {
      return a.remainder > b.remainder ? -1 : 1;
    }
    // Deterministic tie-breaker: alphabetical by id.
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const idsGettingExtraUnit = new Set<string>();
  for (const allocation of byRemainderDesc) {
    if (leftoverUnits <= 0n) break;
    idsGettingExtraUnit.add(allocation.id);
    leftoverUnits -= 1n;
  }

  return allocations.map((allocation) => ({
    id: allocation.id,
    shareAgorot:
      allocation.floor + (idsGettingExtraUnit.has(allocation.id) ? 1n : 0n),
  }));
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
