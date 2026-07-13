import { eq } from "drizzle-orm";
import { createUploadthing, type FileRouter } from "uploadthing/next";
import { UploadThingError } from "uploadthing/server";
import { z } from "zod";
import { db } from "@/db";
import { claims, documents } from "@/db/schema";
import { auth } from "@/lib/auth";

const f = createUploadthing();

export const ourFileRouter = {
  // Claim supporting documentation (FR-2 / FR-10): police reports, damage
  // photos, repair invoices/proof, etc. Required before a claim can move
  // from triage into assessment.
  claimDocumentUploader: f({
    image: { maxFileSize: "8MB", maxFileCount: 10 },
    pdf: { maxFileSize: "16MB", maxFileCount: 10 },
  })
    .input(z.object({ claimId: z.string().uuid() }))
    .middleware(async ({ req, input }) => {
      const session = await auth.api.getSession({ headers: req.headers });

      if (!session) {
        throw new UploadThingError("Unauthorized");
      }

      // FR-6: once a claim is settled (and, a fortiori, finalized), its
      // record is frozen — no further documents may be attached.
      const claim = await db.query.claims.findFirst({
        where: eq(claims.id, input.claimId),
      });

      if (!claim) {
        throw new UploadThingError("Claim not found");
      }

      if (claim.settledAt) {
        throw new UploadThingError("This claim has already been settled; its record is frozen.");
      }

      return { claimId: input.claimId, uploadedById: session.user.id };
    })
    .onUploadComplete(async ({ metadata, file }) => {
      const [document] = await db
        .insert(documents)
        .values({
          claimId: metadata.claimId,
          fileKey: file.key,
          fileName: file.name,
          fileUrl: file.ufsUrl,
          docType: "other",
          uploadedById: metadata.uploadedById,
        })
        .returning();

      return { documentId: document.id };
    }),
} satisfies FileRouter;

export type OurFileRouter = typeof ourFileRouter;
