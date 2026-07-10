import { db } from "./index";
import { users, policies, claims, claimItems } from "./schema";

async function seed() {
  console.log("Seeding database...");

  const [supervisor, adjuster, claimant] = await db
    .insert(users)
    .values([
      {
        name: "Dana Cohen",
        email: "supervisor@firstnotice.test",
        role: "supervisor",
      },
      {
        name: "Avi Levi",
        email: "adjuster@firstnotice.test",
        role: "adjuster",
      },
      {
        name: "Noa Mizrahi",
        email: "claimant@firstnotice.test",
        role: "claimant",
      },
    ])
    .returning();

  console.log("Created users:", { supervisor, adjuster, claimant });

  // Limit chosen so the claim exceeds it (ACV total 1,437,500 > 1,200,000 limit).
  const [policy] = await db
    .insert(policies)
    .values({
      policyNumber: "POL-2026-0001",
      currency: "ILS",
      periodStart: "2026-01-01",
      periodEnd: "2026-12-31",
      deductibleAgorot: 50000,
      perOccurrenceLimitAgorot: 1200000,
      aggregateLimitAgorot: 5000000,
      deductibleOrder: "before_limit",
      limitMode: "per_occurrence",
    })
    .returning();

  console.log("Created policy:", policy);

  const [claim] = await db
    .insert(claims)
    .values({
      claimRef: "CLM-2026-0007",
      claimantId: claimant.id,
      policyId: policy.id,
      currency: "ILS",
      dateOfLoss: "2026-06-10",
      status: "intake",
      version: 1,
    })
    .returning();

  console.log("Created claim:", claim);

  const items = await db
    .insert(claimItems)
    .values([
      {
        claimId: claim.id,
        category: "electronics",
        ageMonths: 30,
        claimedAgorot: 1200000,
      },
      {
        claimId: claim.id,
        category: "furniture",
        ageMonths: 60,
        claimedAgorot: 900000,
      },
      {
        claimId: claim.id,
        category: "appliance",
        ageMonths: 18,
        claimedAgorot: 500000,
      },
    ])
    .returning();

  console.log("Created claim items:", items);

  console.log("Seed complete.");
}

seed()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exit(1);
  });
