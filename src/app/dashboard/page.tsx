"use client";

import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { trpc } from "@/trpc/react";

export default function DashboardPage() {
  const { data: claims, isLoading, isError, error } =
    trpc.claim.getClaims.useQuery();

  return (
    <div className="mx-auto w-full max-w-5xl p-6">
      <Card>
        <CardHeader>
          <CardTitle>Claims</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading && (
            <p className="text-sm text-muted-foreground">Loading claims…</p>
          )}

          {isError && (
            <p className="text-sm text-destructive">
              Failed to load claims: {error.message}
            </p>
          )}

          {!isLoading && !isError && claims?.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No claims to show.
            </p>
          )}

          {!isLoading && !isError && claims && claims.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Claim Ref</TableHead>
                  <TableHead>Date of Loss</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {claims.map((claim) => (
                  <TableRow key={claim.id}>
                    <TableCell className="font-medium">
                      {claim.claimRef}
                    </TableCell>
                    <TableCell>{claim.dateOfLoss}</TableCell>
                    <TableCell className="capitalize">
                      {claim.status}
                    </TableCell>
                    <TableCell className="text-right">
                      <Link
                        href={`/dashboard/${claim.id}`}
                        className={cn(
                          buttonVariants({ variant: "outline", size: "sm" }),
                        )}
                      >
                        View
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
