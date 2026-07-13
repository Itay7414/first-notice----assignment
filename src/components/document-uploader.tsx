"use client";

import { useRef } from "react";
import { FlaskConical, Loader2, UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUploadThing } from "@/lib/uploadthing";
import { trpc } from "@/trpc/react";

type DocumentUploaderProps = {
  claimId: string;
  onUploadComplete: () => void;
  onUploadError: (message: string) => void;
};

// A single, styled trigger for the "claimDocumentUploader" file route: a
// shadcn Button with a hidden native file input behind it, instead of
// UploadThing's default (unstyled) markup. Also offers a dev-only mock
// upload fallback (FR-2) when no real UPLOADTHING_TOKEN is configured, so
// local evaluation doesn't need cloud credentials to attach a document.
export function DocumentUploader({
  claimId,
  onUploadComplete,
  onUploadError,
}: DocumentUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const { startUpload, isUploading } = useUploadThing("claimDocumentUploader", {
    onClientUploadComplete: onUploadComplete,
    onUploadError: (error) => onUploadError(error.message),
  });

  const { data: uploadConfig } = trpc.claim.getUploadConfig.useQuery();
  const simulateUpload = trpc.claim.simulateDocumentUpload.useMutation({
    onSuccess: onUploadComplete,
    onError: (err) => onUploadError(err.message),
  });

  function handleFilesSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    // Reset so selecting the same file again still fires onChange.
    event.target.value = "";
    if (files.length > 0) {
      startUpload(files, { claimId });
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept="image/*,application/pdf"
          multiple
          className="hidden"
          disabled={isUploading}
          onChange={handleFilesSelected}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isUploading}
          onClick={() => inputRef.current?.click()}
          className="gap-2"
        >
          {isUploading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <UploadCloud className="size-4" />
          )}
          {isUploading ? "Uploading…" : "Upload Documentation"}
        </Button>

        {uploadConfig?.useMockUpload && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={simulateUpload.isPending}
            onClick={() => simulateUpload.mutate({ claimId })}
            className="gap-2"
          >
            {simulateUpload.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <FlaskConical className="size-4" />
            )}
            {simulateUpload.isPending
              ? "Simulating…"
              : "Simulate File Upload (Dev)"}
          </Button>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Accepts images or PDF files, up to 16MB each.
        {uploadConfig?.useMockUpload &&
          " No UploadThing token is configured — use \u201cSimulate File Upload (Dev)\u201d to attach a mock document locally."}
      </p>
    </div>
  );
}
