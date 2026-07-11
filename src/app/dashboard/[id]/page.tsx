"use client";

import { useParams } from "next/navigation";
import { AccessDenied } from "@/components/access-denied";
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
import { calculateACV, formatAgorot } from "@/lib/money";
import { trpc } from "@/trpc/react";

export default function ClaimDetailsPage() {
  const { id } = useParams<{ id: string }>();

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

  const isUnauthorized = isError && error.data?.code === "UNAUTHORIZED";
  const isNotFound = isError && error.data?.code === "NOT_FOUND";

  if (isLoading) {
    return (
      <div className="mx-auto w-full max-w-5xl p-6">
        <p className="text-sm text-muted-foreground">Loading claim…</p>
      </div>
    );
  }

  if (isUnauthorized) {
    return (
      <div className="mx-auto w-full max-w-5xl p-6">
        <AccessDenied message="Access Denied: Please sign in to view this claim." />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="mx-auto w-full max-w-5xl p-6">
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

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
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
        <CardContent>
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
              </TableRow>
            </TableHeader>
            <TableBody>
              {claim.items.map((item) => {
                const { annualDepBps } = getDepreciationRate(item.category);
                const { depreciationAgorot, acvAgorot } = calculateACV(
                  item.claimedAgorot,
                  item.ageMonths,
                  annualDepBps,
                );

                return (
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
                      {formatAgorot(depreciationAgorot)}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatAgorot(acvAgorot)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
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
        <CardContent>
          <p className="text-sm text-muted-foreground">
            State-machine action buttons coming soon.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
