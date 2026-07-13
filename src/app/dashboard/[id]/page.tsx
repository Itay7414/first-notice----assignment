"use client";

import { useState, type FormEvent } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useSession } from "@/lib/auth-client";
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

type TransactionType = "payment" | "recovery";

function RecordTransactionForm({
  isPending,
  isSupervisor,
  onSubmit,
}: {
  isPending: boolean;
  isSupervisor: boolean;
  onSubmit: (input: {
    type: TransactionType;
    amountAgorot: number;
    idempotencyKey?: string;
  }) => void;
}) {
  const [type, setType] = useState<TransactionType>("payment");
  const [amount, setAmount] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState("");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const amountAgorot = Math.round(Number(amount) * 100);
    if (!Number.isInteger(amountAgorot) || amountAgorot <= 0) return;

    onSubmit({
      type,
      amountAgorot,
      idempotencyKey: type === "payment" ? idempotencyKey : undefined,
    });
    setAmount("");
    setIdempotencyKey("");
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 rounded-md border p-4"
    >
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          variant={type === "payment" ? "default" : "outline"}
          onClick={() => setType("payment")}
        >
          Payment
        </Button>
        <Button
          type="button"
          size="sm"
          variant={type === "recovery" ? "default" : "outline"}
          onClick={() => setType("recovery")}
        >
          Recovery
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tx-amount">Amount (ILS)</Label>
          <Input
            id="tx-amount"
            type="number"
            min="0.01"
            step="0.01"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
          />
        </div>

        {type === "payment" && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tx-idempotency-key">Idempotency Key</Label>
            <Input
              id="tx-idempotency-key"
              type="text"
              required
              value={idempotencyKey}
              onChange={(e) => setIdempotencyKey(e.target.value)}
              placeholder="e.g. bank-ref-12345"
            />
          </div>
        )}
      </div>

      {type === "payment" && !isSupervisor && (
        <p className="text-xs text-muted-foreground">
          Payments that exceed the remaining reserve require supervisor
          approval.
        </p>
      )}

      <Button type="submit" size="sm" disabled={isPending} className="self-start">
        {isPending
          ? "Recording…"
          : `Record ${type === "payment" ? "Payment" : "Recovery"}`}
      </Button>
    </form>
  );
}

export default function ClaimDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const utils = trpc.useUtils();
  const { data: session } = useSession();
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

  const settleClaim = trpc.claim.settleClaim.useMutation({
    onSuccess: () => {
      setActionError(null);
      utils.claim.getClaim.invalidate({ claimId: id });
      utils.claim.getClaims.invalidate();
    },
    onError: (err) => {
      setActionError(err.message);
    },
  });

  const [transactionError, setTransactionError] = useState<string | null>(
    null,
  );
  const recordTransaction = trpc.claim.recordTransaction.useMutation({
    onSuccess: () => {
      setTransactionError(null);
      utils.claim.getClaim.invalidate({ claimId: id });
    },
    onError: (err) => {
      setTransactionError(err.message);
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

  // FR-7: the append-only financial ledger — payments, recoveries, and the
  // running reserve balance after each — merged into a single, newest-first
  // audit trail.
  const auditEntries = [
    ...claim.payments.map((payment) => ({
      id: payment.id,
      type: "payment" as const,
      amountAgorot: payment.amountAgorot,
      createdAt: payment.createdAt,
      recordedByName: payment.recordedBy.name,
      idempotencyKey: payment.idempotencyKey as string | null,
    })),
    ...claim.recoveries.map((recovery) => ({
      id: recovery.id,
      type: "recovery" as const,
      amountAgorot: recovery.amountAgorot,
      createdAt: recovery.createdAt,
      recordedByName: recovery.recordedBy.name,
      idempotencyKey: null as string | null,
    })),
    ...claim.reserves.map((reserve) => ({
      id: reserve.id,
      type: "reserve" as const,
      amountAgorot: reserve.amountAgorot,
      createdAt: reserve.createdAt,
      recordedByName: reserve.recordedBy.name,
      idempotencyKey: null as string | null,
    })),
  ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

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
          <CardTitle>Reserve Metrics</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">Total Paid</dt>
              <dd className="text-sm font-medium">
                {formatAgorot(claim.reserveMetrics.paidToDateAgorot)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">
                Total Recoveries
              </dt>
              <dd className="text-sm font-medium">
                {formatAgorot(claim.reserveMetrics.totalRecoveriesAgorot)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Net Incurred</dt>
              <dd className="text-sm font-medium">
                {formatAgorot(claim.reserveMetrics.netIncurredAgorot)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">
                Remaining Reserve
              </dt>
              <dd
                className={cn(
                  "text-sm font-medium",
                  claim.reserveMetrics.remainingReserveAgorot < 0 &&
                    "text-destructive",
                )}
              >
                {formatAgorot(claim.reserveMetrics.remainingReserveAgorot)}
              </dd>
            </div>
          </dl>

          {(session?.user.role === "adjuster" ||
            session?.user.role === "supervisor") &&
            !claim.settledAt && (
              <>
                {transactionError && (
                  <p className="text-sm text-destructive">
                    {transactionError}
                  </p>
                )}
                <RecordTransactionForm
                  isPending={recordTransaction.isPending}
                  isSupervisor={session?.user.role === "supervisor"}
                  onSubmit={(input) =>
                    input.type === "payment"
                      ? recordTransaction.mutate({
                          claimId: claim.id,
                          type: "payment",
                          amountAgorot: input.amountAgorot,
                          idempotencyKey: input.idempotencyKey ?? "",
                        })
                      : recordTransaction.mutate({
                          claimId: claim.id,
                          type: "recovery",
                          amountAgorot: input.amountAgorot,
                        })
                  }
                />
              </>
            )}
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
        <CardContent className="flex flex-col gap-3">
          {auditEntries.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No financial transactions recorded yet.
            </p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Recorded By</TableHead>
                    <TableHead>Idempotency Key</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {auditEntries.map((entry) => (
                    <TableRow key={`${entry.type}-${entry.id}`}>
                      <TableCell>
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                            entry.type === "payment" &&
                              "bg-destructive/10 text-destructive",
                            entry.type === "recovery" &&
                              "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
                            entry.type === "reserve" &&
                              "bg-muted text-muted-foreground",
                          )}
                        >
                          {entry.type === "payment"
                            ? "Payment"
                            : entry.type === "recovery"
                              ? "Recovery"
                              : "Reserve Balance"}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatAgorot(entry.amountAgorot)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {entry.createdAt.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-sm">
                        {entry.recordedByName}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {entry.idempotencyKey ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <p className="text-xs text-muted-foreground">
                This ledger is append-only (FR-7): payments and recoveries
                are individual movements; each &quot;Reserve Balance&quot;
                row is the resulting remaining reserve immediately after the
                transaction beside it — never edited or removed, only added
                to.
              </p>
            </>
          )}
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

          {claim.status === "investigating" && (
            <Button
              size="sm"
              disabled={settleClaim.isPending}
              onClick={() =>
                settleClaim.mutate({
                  claimId: claim.id,
                  version: claim.version,
                })
              }
            >
              {settleClaim.isPending ? "Settling…" : "Settle Claim"}
            </Button>
          )}

          {![
            "intake",
            "triage",
            "assessment",
            "investigating",
          ].includes(claim.status) &&
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
