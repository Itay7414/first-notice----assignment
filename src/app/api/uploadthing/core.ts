import { createUploadthing, type FileRouter } from "uploadthing/next";
import { UploadThingError } from "uploadthing/server";
import { z } from "zod";
import { db } from "@/db";
import { documents } from "@/db/schema";
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
