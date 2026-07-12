"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { AccessDenied } from "@/components/access-denied";
import { DocumentUploader } from "@/components/document-uploader";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getDepreciationRate } from "@/lib/depreciation-rates";
import { apportionLimit, calculateACV, formatAgorot } from "@/lib/money";
import { cn } from "@/lib/utils";
import { trpc } from "@/trpc/react";

function BackToDashboardLink() {
  return (
    <Link
      href="/dashboard"
      className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "-ml-2 gap-1.5")}
    >
      <ArrowLeft className="size-4" />
      Back to Dashboard
    </Link>
  );
}

export default function ClaimDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const utils = trpc.useUtils();
  const [actionError, setActionError] = useState<string | null>(null);

  const {
    data: claim,
    isLoading,
    isError,
    error,
  } = trpc.claim.getClaim.useQuery(
    { claimId: id },
    {
      retry: (failureCount, err) =>
        err.data?.code !== "UNAUTHORIZED" && failureCount < 3,
    },
  );

  const triageClaim = trpc.claim.triageClaim.useMutation({
    onSuccess: () => {
      setActionError(null);
      // Refetch so the UI (status, version, and anything derived from them)
      // reflects the server's new state instantly.
      utils.claim.getClaim.invalidate({ claimId: id });
      utils.claim.getClaims.invalidate();
    },
    onError: (err) => {
      setActionError(err.message);
    },
  });

  const assessClaim = trpc.claim.assessClaim.useMutation({
    onSuccess: () => {
      setActionError(null);
      utils.claim.getClaim.invalidate({ claimId: id });
      utils.claim.getClaims.invalidate();
    },
    onError: (err) => {
      setActionError(err.message);
    },
  });

  const investigateClaim = trpc.claim.investigateClaim.useMutation({
    onSuccess: () => {
      setActionError(null);
      utils.claim.getClaim.invalidate({ claimId: id });
      utils.claim.getClaims.invalidate();
    },
    onError: (err) => {
      setActionError(err.message);
    },
  });

  const isUnauthorized = isError && error.data?.code === "UNAUTHORIZED";
  const isNotFound = isError && error.data?.code === "NOT_FOUND";

  if (isLoading) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-6">
        <BackToDashboardLink />
        <p className="text-sm text-muted-foreground">Loading claim…</p>
      </div>
    );
  }

  if (isUnauthorized) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-6">
        <BackToDashboardLink />
        <AccessDenied message="Access Denied: Please sign in to view this claim." />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-6">
        <BackToDashboardLink />
        <p className="text-sm text-destructive">
          {isNotFound
            ? `Claim ${id} not found.`
            : `Failed to load claim: ${error.message}`}
        </p>
      </div>
    );
  }

  if (!claim) {
    return null;
  }

  // FR-3.1: per-item ACV, computed once so it can feed both the table and
  // the FR-3.2 apportionment below.
  const itemsWithAcv = claim.items.map((item) => {
    const { annualDepBps } = getDepreciationRate(item.category);
    const { depreciationAgorot, acvAgorot } = calculateACV(
      item.claimedAgorot,
      item.ageMonths,
      annualDepBps,
    );
    return { ...item, depreciationAgorot, acvAgorot };
  });

  const totalAcvAgorot = itemsWithAcv.reduce(
    (sum, item) => sum + item.acvAgorot,
    0,
  );
  const perOccurrenceLimitAgorot = claim.policy.perOccurrenceLimitAgorot;
  const isOverLimit = totalAcvAgorot > perOccurrenceLimitAgorot;

  // FR-3.2: only meaningful (and only shown) once the combined ACV actually
  // exceeds the policy's per-occurrence limit.
  const apportionedShareByItemId = isOverLimit
    ? new Map(
        apportionLimit(
          itemsWithAcv.map((item) => ({
            id: item.id,
            acv: BigInt(item.acvAgorot),
          })),
          BigInt(perOccurrenceLimitAgorot),
        ).map((share) => [share.id, Number(share.shareAgorot)]),
      )
    : null;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
      <BackToDashboardLink />

      <Card>
        <CardHeader>
          <CardTitle>Claim {claim.claimRef}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">
                Current Status
              </dt>
              <dd className="text-sm font-medium capitalize">
                {claim.status}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Currency</dt>
              <dd className="text-sm font-medium">{claim.currency}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Date of Loss</dt>
              <dd className="text-sm font-medium">{claim.dateOfLoss}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Version</dt>
              <dd className="text-sm font-medium">{claim.version}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Claim Items</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {isOverLimit && (
            <p className="text-sm text-amber-600 dark:text-amber-500">
              Total ACV ({formatAgorot(totalAcvAgorot)}) exceeds the policy&apos;s
              per-occurrence limit ({formatAgorot(perOccurrenceLimitAgorot)}
              ). The limit has been apportioned across items below (FR-3.2).
            </p>
          )}

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item ID</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Age (Months)</TableHead>
                <TableHead className="text-right">
                  Claimed Amount (RCV)
                </TableHead>
                <TableHead className="text-right">Depreciation</TableHead>
                <TableHead className="text-right">ACV</TableHead>
                {isOverLimit && (
                  <TableHead className="text-right">
                    Apportioned Share
                  </TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {itemsWithAcv.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-mono text-xs">
                    {item.id}
                  </TableCell>
                  <TableCell className="capitalize">
                    {item.category}
                  </TableCell>
                  <TableCell className="text-right">
                    {item.ageMonths}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatAgorot(item.claimedAgorot)}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatAgorot(item.depreciationAgorot)}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {formatAgorot(item.acvAgorot)}
                  </TableCell>
                  {isOverLimit && (
                    <TableCell className="text-right font-medium">
                      {formatAgorot(
                        apportionedShareByItemId?.get(item.id) ?? 0,
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Documents</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {claim.documents.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No documents attached yet.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {claim.documents.map((document) => (
                <li
                  key={document.id}
                  className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
                >
                  <a
                    href={document.fileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="truncate underline hover:no-underline"
                  >
                    {document.fileName}
                  </a>
                  <span className="ml-3 shrink-0 text-xs text-muted-foreground capitalize">
                    {document.docType}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <DocumentUploader
            claimId={claim.id}
            onUploadComplete={() => {
              setActionError(null);
              utils.claim.getClaim.invalidate({ claimId: id });
            }}
            onUploadError={(message) => {
              setActionError(message);
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Audit Trail</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Audit trail coming soon.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Actions</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {actionError && (
            <p className="text-sm text-destructive">{actionError}</p>
          )}

          {claim.status === "intake" && (
            <Button
              size="sm"
              disabled={triageClaim.isPending}
              onClick={() =>
                triageClaim.mutate({
                  claimId: claim.id,
                  version: claim.version,
                })
              }
            >
              {triageClaim.isPending ? "Triaging…" : "Triage Claim"}
            </Button>
          )}

          {claim.status === "triage" && (
            <Button
              size="sm"
              disabled={assessClaim.isPending}
              onClick={() =>
                assessClaim.mutate({
                  claimId: claim.id,
                  version: claim.version,
                })
              }
            >
              {assessClaim.isPending ? "Starting…" : "Begin Assessment"}
            </Button>
          )}

          {claim.status === "assessment" && (
            <Button
              size="sm"
              disabled={investigateClaim.isPending}
              onClick={() =>
                investigateClaim.mutate({
                  claimId: claim.id,
                  version: claim.version,
                })
              }
            >
              {investigateClaim.isPending
                ? "Starting…"
                : "Begin Investigation"}
            </Button>
          )}

          {!["intake", "triage", "assessment"].includes(claim.status) &&
            !actionError && (
              <p className="text-sm text-muted-foreground">
                No actions available from status &quot;{claim.status}&quot;
                yet.
              </p>
            )}
        </CardContent>
      </Card>
    </div>
  );
}
