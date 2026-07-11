import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { db as Database } from "@/db";
import { claims, documents, type claimStatusEnum } from "@/db/schema";
import { protectedProcedure, router } from "../trpc";

type ClaimStatus = (typeof claimStatusEnum.enumValues)[number];

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
  guard?: (claim: typeof claims.$inferSelect) => Promise<void>,
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

  if (guard) {
    await guard(claim);
  }

  const [updated] = await db
    .update(claims)
    .set({ status: to, version: claim.version + 1 })
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
        },
      });

      if (!claim) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Claim ${input.claimId} not found`,
        });
      }

      return claim;
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
      transitionClaim(ctx.db, input, "triage", "assessment", async (claim) => {
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
      }),
    ),
});
