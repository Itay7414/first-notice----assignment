import { TRPCError } from "@trpc/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { db as Database } from "@/db";
import {
  claims,
  documents,
  payments,
  recoveries,
  reserves,
  type claimStatusEnum,
} from "@/db/schema";
import { getDepreciationRate } from "@/lib/depreciation-rates";
import { apportionLimit, calculateACV } from "@/lib/money";
import { isUploadThingConfigured } from "@/lib/uploadthing-config";
import { protectedProcedure, router } from "../trpc";

type ClaimStatus = (typeof claimStatusEnum.enumValues)[number];
type Claim = typeof claims.$inferSelect;

const getClaimInput = z.object({
  claimId: z.string().uuid(),
});

const createClaimInput = z.object({
  claimRef: z.string().min(1),
  claimantId: z.string().uuid(),
  policyId: z.string().uuid(),
  dateOfLoss: z.string().date(),
  currency: z.string().length(3).default("ILS"),
});

const claimTransitionInput = z.object({
  claimId: z.string().uuid(),
  // The version the client last saw, for optimistic concurrency: the write
  // is rejected if someone else has updated the claim in the meantime.
  version: z.number().int().positive(),
});

const simulateDocumentUploadInput = z.object({
  claimId: z.string().uuid(),
});

const recordTransactionInput = z.discriminatedUnion("type", [
  z.object({
    claimId: z.string().uuid(),
    type: z.literal("payment"),
    amountAgorot: z.number().int().positive(),
    // Required for payments: guards against double-submitting the same
    // payment (e.g. a retried request after a dropped connection).
    idempotencyKey: z.string().min(1),
  }),
  z.object({
    claimId: z.string().uuid(),
    type: z.literal("recovery"),
    amountAgorot: z.number().int().positive(),
  }),
]);

// Shared implementation for every claim state-machine edge: look up the
// claim, verify it's in the expected starting status, run an optional guard
// (e.g. "must have documents attached"), then apply the write conditioned on
// the caller's known version so concurrent writers can't silently clobber
// each other (optimistic concurrency).
async function transitionClaim(
  db: typeof Database,
  input: { claimId: string; version: number },
  from: ClaimStatus,
  to: ClaimStatus,
  options?: {
    guard?: (claim: Claim) => Promise<void>;
    extraFields?: Partial<typeof claims.$inferInsert>;
  },
) {
  const claim = await db.query.claims.findFirst({
    where: eq(claims.id, input.claimId),
  });

  if (!claim) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `Claim ${input.claimId} not found`,
    });
  }

  if (claim.status !== from) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Cannot transition claim to "${to}": current status is "${claim.status}", expected "${from}"`,
    });
  }

  if (options?.guard) {
    await options.guard(claim);
  }

  const [updated] = await db
    .update(claims)
    .set({ status: to, version: claim.version + 1, ...options?.extraFields })
    .where(and(eq(claims.id, input.claimId), eq(claims.version, input.version)))
    .returning();

  if (!updated) {
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "This claim was updated by someone else in the meantime. Please refresh and try again.",
    });
  }

  return updated;
}

// FR-3.2 preview: the claim's total financial exposure, capped at the
// policy's per-occurrence limit. Used as the reserve's "net incurred" the
// first time a financial transaction is recorded against a claim.
function previewNetIncurredAgorot(
  items: { id: string; category: string; ageMonths: number; claimedAgorot: number }[],
  perOccurrenceLimitAgorot: number,
): number {
  const itemsAcv = items.map((item) => {
    const { annualDepBps } = getDepreciationRate(item.category);
    const { acvAgorot } = calculateACV(
      item.claimedAgorot,
      item.ageMonths,
      annualDepBps,
    );
    return { id: item.id, acv: BigInt(acvAgorot) };
  });

  const totalAcv = itemsAcv.reduce((sum, item) => sum + item.acv, 0n);
  const limit = BigInt(perOccurrenceLimitAgorot);

  if (totalAcv <= limit) {
    return Number(totalAcv);
  }

  // Apportioned shares always sum to exactly `limit`.
  const shares = apportionLimit(itemsAcv, limit);
  return Number(shares.reduce((sum, share) => sum + share.shareAgorot, 0n));
}

// FR-5 reserve metrics for a claim that's already been loaded with its
// items, policy, reserves, payments, and recoveries.
function computeReserveMetrics(claim: {
  items: { id: string; category: string; ageMonths: number; claimedAgorot: number }[];
  policy: { perOccurrenceLimitAgorot: number };
  reserves: { amountAgorot: number; createdAt: Date }[];
  payments: { amountAgorot: number }[];
  recoveries: { amountAgorot: number }[];
}) {
  const sortedReserves = [...claim.reserves].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  );

  // The *first* reserve entry fixes "net incurred" for the life of the
  // claim (at that point paid=0 and recoveries=0, so the invariant below
  // reduces to remaining_reserve = net_incurred). If no reserve has been
  // set yet, preview what it *would* be so the UI has something to show
  // before any money has moved.
  const netIncurredAgorot =
    sortedReserves.length > 0
      ? sortedReserves[0].amountAgorot
      : previewNetIncurredAgorot(
          claim.items,
          claim.policy.perOccurrenceLimitAgorot,
        );

  const paidToDateAgorot = claim.payments.reduce(
    (sum, p) => sum + p.amountAgorot,
    0,
  );
  const totalRecoveriesAgorot = claim.recoveries.reduce(
    (sum, r) => sum + r.amountAgorot,
    0,
  );

  const remainingReserveAgorot =
    sortedReserves.length > 0
      ? sortedReserves[sortedReserves.length - 1].amountAgorot
      : netIncurredAgorot;

  return {
    netIncurredAgorot,
    paidToDateAgorot,
    totalRecoveriesAgorot,
    remainingReserveAgorot,
  };
}

export const claimRouter = router({
  // Claimants only ever see their own claims; every other role (adjuster,
  // supervisor) sees the full claim list.
  getClaims: protectedProcedure.query(async ({ ctx }) => {
    const { user } = ctx.session;

    const rows =
      user.role === "claimant"
        ? await ctx.db.query.claims.findMany({
            where: eq(claims.claimantId, user.id),
            orderBy: desc(claims.dateOfLoss),
          })
        : await ctx.db.query.claims.findMany({
            orderBy: desc(claims.dateOfLoss),
          });

    return rows;
  }),

  getClaim: protectedProcedure
    .input(getClaimInput)
    .query(async ({ ctx, input }) => {
      const claim = await ctx.db.query.claims.findFirst({
        where: eq(claims.id, input.claimId),
        with: {
          items: true,
          documents: { orderBy: (doc, { desc }) => desc(doc.createdAt) },
          policy: true,
          reserves: { with: { recordedBy: true } },
          payments: { with: { recordedBy: true } },
          recoveries: { with: { recordedBy: true } },
        },
      });

      if (!claim) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Claim ${input.claimId} not found`,
        });
      }

      return { ...claim, reserveMetrics: computeReserveMetrics(claim) };
    }),

  createClaim: protectedProcedure
    .input(createClaimInput)
    .mutation(async ({ ctx, input }) => {
      const [claim] = await ctx.db
        .insert(claims)
        .values({
          claimRef: input.claimRef,
          claimantId: input.claimantId,
          policyId: input.policyId,
          dateOfLoss: input.dateOfLoss,
          currency: input.currency,
        })
        .returning();

      return claim;
    }),

  // Tells the client whether to show the "Simulate File Upload (Dev)"
  // fallback: true whenever UPLOADTHING_TOKEN is missing/a placeholder, so
  // local evaluation can still exercise the FR-2 guard below and the
  // triage -> assessment transition without a real cloud token.
  getUploadConfig: protectedProcedure.query(() => ({
    useMockUpload: !isUploadThingConfigured(),
  })),

  // Dev-only stand-in for the real UploadThing flow in `onUploadComplete`
  // (src/app/api/uploadthing/core.ts): inserts the same shape of `documents`
  // row a real upload would produce, without needing cloud credentials.
  // Refuses to run once a real token is configured, so it can't be used to
  // bypass genuine document review in a real deployment.
  simulateDocumentUpload: protectedProcedure
    .input(simulateDocumentUploadInput)
    .mutation(async ({ ctx, input }) => {
      if (isUploadThingConfigured()) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "UploadThing is configured for this environment; use the real upload flow instead of the dev mock.",
        });
      }

      const claim = await ctx.db.query.claims.findFirst({
        where: eq(claims.id, input.claimId),
      });

      if (!claim) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Claim ${input.claimId} not found`,
        });
      }

      const [document] = await ctx.db
        .insert(documents)
        .values({
          claimId: input.claimId,
          fileKey: `mock-${crypto.randomUUID()}`,
          fileName: "mock_document.pdf",
          fileUrl: "https://example.com/mock_document.pdf",
          docType: "other",
          uploadedById: ctx.session.user.id,
        })
        .returning();

      return document;
    }),

  // The first legal state-machine edge: intake -> triage.
  triageClaim: protectedProcedure
    .input(claimTransitionInput)
    .mutation(async ({ ctx, input }) =>
      transitionClaim(ctx.db, input, "intake", "triage"),
    ),

  // triage -> assessment, gated on FR-2: at least one document must already
  // be attached to the claim before assessment can begin.
  assessClaim: protectedProcedure
    .input(claimTransitionInput)
    .mutation(async ({ ctx, input }) =>
      transitionClaim(ctx.db, input, "triage", "assessment", {
        guard: async (claim) => {
          const attachedDocument = await ctx.db.query.documents.findFirst({
            where: eq(documents.claimId, claim.id),
          });

          if (!attachedDocument) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                "Cannot transition to assessment without uploading required claim documentation.",
            });
          }
        },
      }),
    ),

  // assessment -> investigating.
  investigateClaim: protectedProcedure
    .input(claimTransitionInput)
    .mutation(async ({ ctx, input }) =>
      transitionClaim(ctx.db, input, "assessment", "investigating"),
    ),

  // investigating -> settled. FR-6: settlement can only ever happen once
  // per claim, enforced both by the status guard (can't re-enter
  // "investigating" -> "settled" once already settled) and, defensively, by
  // checking `settledAt` directly.
  settleClaim: protectedProcedure
    .input(claimTransitionInput)
    .mutation(async ({ ctx, input }) =>
      transitionClaim(ctx.db, input, "investigating", "settled", {
        guard: async (claim) => {
          if (claim.settledAt) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "This claim has already been settled (FR-6).",
            });
          }
        },
        extraFields: { settledAt: new Date() },
      }),
    ),

  // FR-5 / FR-7: record a payment or subrogation recovery against a claim's
  // reserve. Only ever INSERTs (into `payments`/`recoveries`, and a new
  // `reserves` row reflecting the updated balance) — historical ledger rows
  // are never UPDATEd or DELETEd.
  recordTransaction: protectedProcedure
    .input(recordTransactionInput)
    .mutation(async ({ ctx, input }) => {
      if (ctx.session.user.role === "claimant") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "Only adjusters and supervisors can record financial transactions.",
        });
      }

      return ctx.db.transaction(async (tx) => {
        // Lock the claim row for the duration of the transaction so two
        // concurrent transactions against the same claim can't both read
        // the same "remaining reserve" and both approve against it.
        await tx.execute(
          sql`select id from ${claims} where ${claims.id} = ${input.claimId} for update`,
        );

        const claim = await tx.query.claims.findFirst({
          where: eq(claims.id, input.claimId),
          with: { items: true, policy: true, reserves: true, payments: true, recoveries: true },
        });

        if (!claim) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `Claim ${input.claimId} not found`,
          });
        }

        if (claim.settledAt) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "This claim has already been settled; its financial ledger is closed.",
          });
        }

        const before = computeReserveMetrics(claim);

        // RESERVE INVARIANT (FR-5), checked against the ledger's current
        // state before applying this transaction.
        const invariantBefore =
          before.paidToDateAgorot -
          before.totalRecoveriesAgorot +
          before.remainingReserveAgorot;
        if (invariantBefore !== before.netIncurredAgorot) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message:
              "Reserve invariant violated before recording this transaction: " +
              `${before.paidToDateAgorot} - ${before.totalRecoveriesAgorot} + ${before.remainingReserveAgorot} != ${before.netIncurredAgorot}.`,
          });
        }

        if (
          input.type === "payment" &&
          input.amountAgorot > before.remainingReserveAgorot &&
          ctx.session.user.role !== "supervisor"
        ) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message:
              `Payment of ${input.amountAgorot} agorot exceeds the remaining reserve of ` +
              `${before.remainingReserveAgorot} agorot; only a supervisor can approve an over-reserve payment.`,
          });
        }

        // If this is the very first financial transaction for this claim,
        // materialize the initial reserve (== net incurred, paid=0,
        // recoveries=0) so future reads and the invariant have a fixed
        // anchor instead of re-previewing it every time.
        if (claim.reserves.length === 0) {
          await tx.insert(reserves).values({
            claimId: claim.id,
            amountAgorot: before.netIncurredAgorot,
            recordedById: ctx.session.user.id,
          });
        }

        if (input.type === "payment") {
          try {
            await tx.insert(payments).values({
              claimId: claim.id,
              amountAgorot: input.amountAgorot,
              idempotencyKey: input.idempotencyKey,
              recordedById: ctx.session.user.id,
            });
          } catch (error) {
            // Postgres unique_violation on (claimId, idempotencyKey): this
            // is a retried request, not a new payment — fail clearly rather
            // than surfacing a raw DB error. The driver may nest the
            // Postgres error code under `.cause` depending on the driver.
            const pgCode =
              error && typeof error === "object" && "code" in error
                ? (error as { code?: unknown }).code
                : error &&
                    typeof error === "object" &&
                    "cause" in error &&
                    error.cause &&
                    typeof error.cause === "object" &&
                    "code" in error.cause
                  ? (error.cause as { code?: unknown }).code
                  : undefined;

            if (pgCode === "23505") {
              throw new TRPCError({
                code: "CONFLICT",
                message: `A payment with idempotency key "${input.idempotencyKey}" has already been recorded for this claim.`,
              });
            }
            throw error;
          }
        } else {
          await tx.insert(recoveries).values({
            claimId: claim.id,
            amountAgorot: input.amountAgorot,
            recordedById: ctx.session.user.id,
          });
        }

        const newRemainingReserveAgorot =
          input.type === "payment"
            ? before.remainingReserveAgorot - input.amountAgorot
            : before.remainingReserveAgorot + input.amountAgorot;

        // Append the new balance as its own history row — an INSERT, never
        // an UPDATE to a prior row (FR-7).
        await tx.insert(reserves).values({
          claimId: claim.id,
          amountAgorot: newRemainingReserveAgorot,
          recordedById: ctx.session.user.id,
        });

        const newPaidToDateAgorot =
          before.paidToDateAgorot +
          (input.type === "payment" ? input.amountAgorot : 0);
        const newTotalRecoveriesAgorot =
          before.totalRecoveriesAgorot +
          (input.type === "recovery" ? input.amountAgorot : 0);

        // Re-assert the invariant holds after applying the transaction.
        const invariantAfter =
          newPaidToDateAgorot -
          newTotalRecoveriesAgorot +
          newRemainingReserveAgorot;
        if (invariantAfter !== before.netIncurredAgorot) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Reserve invariant violated after recording this transaction.",
          });
        }

        return {
          netIncurredAgorot: before.netIncurredAgorot,
          paidToDateAgorot: newPaidToDateAgorot,
          totalRecoveriesAgorot: newTotalRecoveriesAgorot,
          remainingReserveAgorot: newRemainingReserveAgorot,
        };
      });
    }),
});
