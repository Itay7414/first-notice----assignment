/**
 * Per-category depreciation configuration (FR-3.2). `annualDepBps` feeds
 * `calculateACV`; `recoverable` distinguishes depreciation that is withheld
 * until a repair-proof is uploaded from depreciation that is never released.
 */
export const DEPRECIATION_RATES = {
  electronics: { annualDepBps: 2000, recoverable: true },
  furniture: { annualDepBps: 1000, recoverable: false },
  appliance: { annualDepBps: 1500, recoverable: true },
} as const;

export type DepreciationCategory = keyof typeof DEPRECIATION_RATES;

/** Falls back to a conservative 0% (no depreciation) for unknown categories. */
export function getDepreciationRate(category: string) {
  return (
    DEPRECIATION_RATES[category as DepreciationCategory] ?? {
      annualDepBps: 0,
      recoverable: false,
    }
  );
}
