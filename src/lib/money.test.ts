import { describe, expect, it } from "vitest";
import { apportionLimit, calculateACV, formatAgorot } from "./money";

describe("calculateACV", () => {
  it("matches the assignment's worked example (electronics/furniture/appliance)", () => {
    // RCV=1,200,000, 30 months old, 20% annual depreciation.
    expect(calculateACV(1_200_000, 30, 2000)).toEqual({
      replacementCostAgorot: 1_200_000,
      depreciationAgorot: 600_000,
      acvAgorot: 600_000,
    });

    // RCV=900,000, 60 months old, 10% annual depreciation.
    expect(calculateACV(900_000, 60, 1000)).toEqual({
      replacementCostAgorot: 900_000,
      depreciationAgorot: 450_000,
      acvAgorot: 450_000,
    });

    // RCV=500,000, 18 months old, 15% annual depreciation.
    expect(calculateACV(500_000, 18, 1500)).toEqual({
      replacementCostAgorot: 500_000,
      depreciationAgorot: 112_500,
      acvAgorot: 387_500,
    });
  });

  it("caps depreciation at the replacement cost and floors ACV at 0", () => {
    // Depreciation would mathematically exceed RCV (very old, high bps item).
    expect(calculateACV(100_000, 240, 5000)).toEqual({
      replacementCostAgorot: 100_000,
      depreciationAgorot: 100_000,
      acvAgorot: 0,
    });
  });

  it("applies no depreciation to a brand-new item", () => {
    expect(calculateACV(50_000, 0, 2000)).toEqual({
      replacementCostAgorot: 50_000,
      depreciationAgorot: 0,
      acvAgorot: 50_000,
    });
  });

  describe("round-half-up boundary behavior", () => {
    // With RCV=100 and months=1, depreciation = round(bps / 1200).
    it("rounds an exact .5 remainder up, not down or to even", () => {
      // 500 / 1200 = 0.41(6) -> rounds down to 0.
      expect(calculateACV(100, 1, 500).depreciationAgorot).toBe(0);
      // 600 / 1200 = 0.5 exactly -> round-half-up rounds to 1.
      expect(calculateACV(100, 1, 600).depreciationAgorot).toBe(1);
      // 700 / 1200 = 0.58(3) -> rounds up to 1.
      expect(calculateACV(100, 1, 700).depreciationAgorot).toBe(1);
    });
  });

  describe("input validation", () => {
    it.each([
      ["replacementCostAgorot", () => calculateACV(-1, 12, 1000)],
      ["ageMonths", () => calculateACV(1000, -1, 1000)],
      ["annualDepBps", () => calculateACV(1000, 12, -1)],
      ["replacementCostAgorot (non-integer)", () => calculateACV(1000.5, 12, 1000)],
    ])("throws for invalid %s", (_name, run) => {
      expect(run).toThrow();
    });
  });
});

describe("formatAgorot", () => {
  it("formats whole and fractional amounts with thousands separators", () => {
    expect(formatAgorot(150_070)).toBe("1,500.70");
    expect(formatAgorot(0)).toBe("0.00");
    expect(formatAgorot(-500)).toBe("-5.00");
  });
});

describe("apportionLimit", () => {
  it("returns each item's full ACV when the total exactly matches the limit", () => {
    const items = [
      { id: "a", acv: 100n },
      { id: "b", acv: 200n },
    ];
    expect(apportionLimit(items, 300n)).toEqual([
      { id: "a", shareAgorot: 100n },
      { id: "b", shareAgorot: 200n },
    ]);
  });

  it("returns each item's full ACV when the total is under the limit", () => {
    const items = [
      { id: "a", acv: 100n },
      { id: "b", acv: 200n },
    ];
    expect(apportionLimit(items, 1_000n)).toEqual([
      { id: "a", shareAgorot: 100n },
      { id: "b", shareAgorot: 200n },
    ]);
  });

  it("divides cleanly (no remainder) when the limit is an exact fraction of the total", () => {
    // total=400, limit=200 -> exactly half of every item, no rounding needed.
    const items = [
      { id: "a", acv: 100n },
      { id: "b", acv: 300n },
    ];
    const result = apportionLimit(items, 200n);
    expect(result).toEqual([
      { id: "a", shareAgorot: 50n },
      { id: "b", shareAgorot: 150n },
    ]);
    expect(sumOf(result)).toBe(200n);
  });

  it("apportions the seed data's real over-limit scenario via the Largest-Remainder method", () => {
    // ACVs from the assignment's worked example: 600,000 / 450,000 / 387,500
    // (total 1,437,500), against the seeded policy's 1,200,000 limit.
    const items = [
      { id: "electronics", acv: 600_000n },
      { id: "furniture", acv: 450_000n },
      { id: "appliance", acv: 387_500n },
    ];
    const limit = 1_200_000n;

    const result = apportionLimit(items, limit);

    // Baseline floors are 500869 / 375652 / 323478 (sum 1,199,999), leaving a
    // single leftover agorot. Electronics has the largest remainder
    // (812,500 vs 375,000 and 250,000), so it receives the leftover unit.
    expect(result).toEqual([
      { id: "electronics", shareAgorot: 500_870n },
      { id: "furniture", shareAgorot: 375_652n },
      { id: "appliance", shareAgorot: 323_478n },
    ]);
    expect(sumOf(result)).toBe(limit);
  });

  it("breaks a single-unit tie deterministically by alphabetical id", () => {
    // All three items are identical, so all remainders tie exactly; exactly
    // one leftover agorot must go to the alphabetically-first id.
    const items = [
      { id: "item-c", acv: 100n },
      { id: "item-a", acv: 100n },
      { id: "item-b", acv: 100n },
    ];
    const result = apportionLimit(items, 250n);

    expect(byId(result)).toEqual({
      "item-a": 84n,
      "item-b": 83n,
      "item-c": 83n,
    });
    expect(sumOf(result)).toBe(250n);
  });

  it("breaks multi-unit ties deterministically, in alphabetical order, for every leftover unit", () => {
    // Four identical items, two leftover agorot -> the two
    // alphabetically-first ids each get one extra unit.
    const items = [
      { id: "z", acv: 100n },
      { id: "y", acv: 100n },
      { id: "x", acv: 100n },
      { id: "w", acv: 100n },
    ];
    const result = apportionLimit(items, 390n);

    expect(byId(result)).toEqual({ w: 98n, x: 98n, y: 97n, z: 97n });
    expect(sumOf(result)).toBe(390n);
  });

  it("prioritizes a strictly larger remainder over alphabetical order", () => {
    // "aaa" sorts before "zzz" alphabetically, but "zzz" has the larger
    // remainder (70 vs 30), so the single leftover unit must go to "zzz".
    // Alphabetical order is only a tie-breaker for *equal* remainders, never
    // a substitute for comparing them.
    const items = [
      { id: "aaa", acv: 70n },
      { id: "zzz", acv: 30n },
    ];
    // total=100, limit=99 -> 1 leftover unit.
    const result = apportionLimit(items, 99n);

    expect(byId(result)).toEqual({ aaa: 69n, zzz: 30n });
    expect(sumOf(result)).toBe(99n);
  });

  it("is independent of input ordering", () => {
    const items = [
      { id: "electronics", acv: 600_000n },
      { id: "furniture", acv: 450_000n },
      { id: "appliance", acv: 387_500n },
    ];
    const limit = 1_200_000n;

    const forward = byId(apportionLimit(items, limit));
    const reversed = byId(apportionLimit([...items].reverse(), limit));

    expect(reversed).toEqual(forward);
  });

  describe("input validation", () => {
    it("throws for a negative limit", () => {
      expect(() => apportionLimit([{ id: "a", acv: 100n }], -1n)).toThrow();
    });

    it("throws for a negative item ACV", () => {
      expect(() => apportionLimit([{ id: "a", acv: -1n }], 100n)).toThrow();
    });
  });
});

function sumOf(shares: { shareAgorot: bigint }[]): bigint {
  return shares.reduce((sum, s) => sum + s.shareAgorot, 0n);
}

function byId(shares: { id: string; shareAgorot: bigint }[]) {
  return Object.fromEntries(shares.map((s) => [s.id, s.shareAgorot]));
}
