import { eq } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";
import { db } from "./index";
import { accounts, claimItems, claims, policies, users } from "./schema";

// Shared test password for every seeded account (this is synthetic seed
// data only — see the assignment's note against real credentials).
const SEED_PASSWORD = "Password123!";

type NewUser = typeof users.$inferInsert;

async function upsertUser(input: NewUser) {
  const existing = await db.query.users.findFirst({
    where: eq(users.email, input.email),
  });
  if (existing) return existing;

  const [created] = await db.insert(users).values(input).returning();
  return created;
}

async function ensureCredentialAccount(userId: string) {
  const existing = await db.query.accounts.findFirst({
    where: eq(accounts.userId, userId),
  });
  if (existing) return existing;

  const [created] = await db
    .insert(accounts)
    .values({
      id: crypto.randomUUID(),
      userId,
      // For the credential provider, accountId is conventionally the userId.
      accountId: userId,
      providerId: "credential",
      password: await hashPassword(SEED_PASSWORD),
    })
    .returning();
  return created;
}

async function seed() {
  console.log("Seeding database...");

  const supervisor = await upsertUser({
    name: "Dana Cohen",
    email: "supervisor@firstnotice.test",
    role: "supervisor",
  });
  const adjuster = await upsertUser({
    name: "Avi Levi",
    email: "adjuster@firstnotice.test",
    role: "adjuster",
  });
  const claimant = await upsertUser({
    name: "Noa Mizrahi",
    email: "claimant@firstnotice.test",
    role: "claimant",
  });

  console.log("Users:", { supervisor, adjuster, claimant });

  await Promise.all(
    [supervisor, adjuster, claimant].map((user) =>
      ensureCredentialAccount(user.id),
    ),
  );

  console.log(
    `Credential accounts ready. Every seeded user's password is "${SEED_PASSWORD}".`,
  );

  let policy = await db.query.policies.findFirst({
    where: eq(policies.policyNumber, "POL-2026-0001"),
  });

  if (!policy) {
    // Limit chosen so the claim exceeds it (ACV total 1,437,500 > 1,200,000 limit).
    [policy] = await db
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
  }

  console.log("Policy:", policy);

  let claim = await db.query.claims.findFirst({
    where: eq(claims.claimRef, "CLM-2026-0007"),
  });
  let isNewClaim = false;

  if (!claim) {
    isNewClaim = true;
    [claim] = await db
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
  }

  console.log("Claim:", claim);

  if (isNewClaim) {
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
  } else {
    console.log("Claim items already exist, skipping.");
  }

  console.log("Seed complete.");
}

seed()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exit(1);
  });
