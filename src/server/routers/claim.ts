import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { claims } from "@/db/schema";
import { protectedProcedure, router } from "../trpc";

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

const triageClaimInput = z.object({
  claimId: z.string().uuid(),
  // The version the client last saw, for optimistic concurrency: the write
  // is rejected if someone else has updated the claim in the meantime.
  version: z.number().int().positive(),
});

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
        with: { items: true },
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
    .input(triageClaimInput)
    .mutation(async ({ ctx, input }) => {
      const claim = await ctx.db.query.claims.findFirst({
        where: eq(claims.id, input.claimId),
      });

      if (!claim) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Claim ${input.claimId} not found`,
        });
      }

      if (claim.status !== "intake") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot triage claim: current status is "${claim.status}", expected "intake"`,
        });
      }

      // Optimistic concurrency: only apply the write if the row's version
      // still matches what the client last read. If another request won
      // the race in between, this affects 0 rows.
      const [updated] = await ctx.db
        .update(claims)
        .set({ status: "triage", version: claim.version + 1 })
        .where(
          and(eq(claims.id, input.claimId), eq(claims.version, input.version)),
        )
        .returning();

      if (!updated) {
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "This claim was updated by someone else in the meantime. Please refresh and try again.",
        });
      }

      return updated;
    }),
});
