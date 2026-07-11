"use client";

import { useRef } from "react";
import { Loader2, UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUploadThing } from "@/lib/uploadthing";

type DocumentUploaderProps = {
  claimId: string;
  onUploadComplete: () => void;
  onUploadError: (message: string) => void;
};

// A single, styled trigger for the "claimDocumentUploader" file route: a
// shadcn Button with a hidden native file input behind it, instead of
// UploadThing's default (unstyled) markup.
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

  function handleFilesSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    // Reset so selecting the same file again still fires onChange.
    event.target.value = "";
    if (files.length > 0) {
      startUpload(files, { claimId });
    }
  }

  return (
    <div>
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
      <p className="mt-1.5 text-xs text-muted-foreground">
        Accepts images or PDF files, up to 16MB each.
      </p>
    </div>
  );
}
