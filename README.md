# FirstNotice

FirstNotice is a full-stack claims management system for a first-notice-of-loss (FNOL) property insurance workflow. It models the entire lifecycle of a claim — from intake through investigation, financial settlement, and a final, unmodifiable official letter — with every rule enforced **server-side**, not merely suggested by the UI.

This isn't a CRUD demo. It's an implementation of a real insurance business process, where money math must be exact, state transitions must be race-safe, and every financial movement must be permanently auditable.

> Every claim moves through: `intake → triage → assessment → investigating → settled → finalized`, gated by document requirements, optimistic-concurrency version checks, and role-based authorization at each edge.

---

## 1. Project Overview & Tech Stack

| Layer | Technology | Why |
| --- | --- | --- |
| **Framework** | [Next.js 16](https://nextjs.org) (App Router) | Server Components for data-heavy claim pages, route handlers for tRPC/auth/uploads. |
| **API layer** | [tRPC v11](https://trpc.io) | End-to-end type safety from server procedure to client hook — one procedure per legal state-machine edge, no REST guesswork. |
| **Validation** | [Zod v4](https://zod.dev) | Every mutation input is parsed and rejected before it touches the database. |
| **ORM** | [Drizzle ORM](https://orm.drizzle.team) | Typed schema, relational queries, and raw SQL escape hatches (`SELECT ... FOR UPDATE`) when the query builder isn't enough. |
| **Database** | [Neon Serverless Postgres](https://neon.tech) | Connected via `drizzle-orm/neon-serverless` over a **WebSocket `Pool`** (not `neon-http`) — this is a deliberate choice: `neon-http` cannot run interactive transactions, and the reserve invariant (FR-5) requires read-then-write atomicity that only a real `db.transaction()` provides. |
| **Auth** | [Better Auth](https://www.better-auth.com) | Drizzle-adapter-backed sessions, with `role` (`claimant` / `adjuster` / `supervisor`) as a custom `additionalField` on the user model, enforced in every `protectedProcedure`. |
| **File uploads** | [UploadThing](https://uploadthing.com) | Real cloud storage for claim documents, with a built-in local dev fallback (see below) so the app is fully testable without cloud credentials. |
| **Styling / UI** | [Tailwind CSS v4](https://tailwindcss.com) + [shadcn/ui](https://ui.shadcn.com) | Accessible, composable primitives (`Card`, `Table`, `Button`, `Input`) styled consistently across the dashboard. |
| **Testing** | [Vitest](https://vitest.dev) | Unit coverage for the money math that underpins every financial decision in the app. |

### Multi-tenant / role-based routing

Every tRPC procedure runs through a shared context that resolves the caller's Better Auth session; unauthenticated requests are rejected with `UNAUTHORIZED` before any handler logic runs. On top of that, `getClaims` demonstrates row-level, role-scoped tenancy directly in the query:

```10:17:src/server/routers/claim.ts
  getClaims: protectedProcedure.query(async ({ ctx }) => {
    const { user } = ctx.session;

    const rows =
      user.role === "claimant"
        ? await ctx.db.query.claims.findMany({
            where: eq(claims.claimantId, user.id),
```

- **Claimants** only ever see *their own* claims — the `WHERE claimant_id = :userId` filter is applied server-side, so there's no way to enumerate other claimants' data by guessing IDs.
- **Adjusters** and **supervisors** see the full claim book, and are the only roles permitted to record financial transactions or move a claim through the state machine.
- **Supervisors** additionally hold a bypass privilege for over-reserve payments (see FR-5 below).

---

## 2. Key Functional Requirements Handled

### 🔒 State Machine Transitions (optimistic concurrency)

Every legal transition (`triageClaim`, `assessClaim`, `investigateClaim`, `settleClaim`, `finalizeClaim`) is implemented through one shared helper, `transitionClaim`, so the concurrency and validation logic can't drift between edges:

```65:112:src/server/routers/claim.ts
async function transitionClaim(
  db: typeof Database,
  input: { claimId: string; version: number },
  from: ClaimStatus,
  to: ClaimStatus,
  options?: {
    guard?: (claim: Claim) => Promise<void>;
    extraFields?: Partial<typeof claims.$inferInsert>;
  },
) {
  // ... load claim, verify `claim.status === from`, run an optional guard ...

  const [updated] = await db
    .update(claims)
    .set({ status: to, version: claim.version + 1, ...options?.extraFields })
    .where(and(eq(claims.id, input.claimId), eq(claims.version, input.version)))
    .returning();

  if (!updated) {
    throw new TRPCError({ code: "CONFLICT", message: /* ... */ });
  }
```

- The client always sends back the `version` it last read. The `UPDATE ... WHERE id = ? AND version = ?` clause guarantees the write only succeeds if nobody else has mutated the claim since — a classic **optimistic lock**. If two adjusters race to transition the same claim, the loser gets a clean `CONFLICT` (409-equivalent) instead of silently clobbering the winner's change.
- Per-edge **guards** compose on top of the same helper: `assessClaim` requires at least one attached document (FR-2); `settleClaim`/`finalizeClaim` defensively re-check `settledAt`/`finalizedAt` so a transition can never be replayed even if the status check alone were somehow bypassed (FR-6, belt-and-suspenders).
- `extraFields` lets a transition stamp additional immutable facts atomically with the status change — e.g. `settledAt` and `finalizedAt` are set in the exact same `UPDATE` as the status flip, so there's never a window where a claim is `"settled"` but `settledAt` is still null.

### 💰 Financial Core Logic (zero floating-point math)

All monetary values are stored and computed as **integer agorot** (1 ILS = 100 agorot) — never as `float`/`Number` division. `src/lib/money.ts` uses `BigInt` throughout so results are exact and reproducible regardless of magnitude:

```36:67:src/lib/money.ts
export function calculateACV(
  replacementCostAgorot: number,
  ageMonths: number,
  annualDepBps: number,
): AcvResult {
  // depreciation = round(replacementCost * annualDepBps * ageMonths / (10000 * 12))
  // ACV          = replacementCost - min(depreciation, replacementCost)
  const numerator = replacementCost * bps * months;
  const rawDepreciation = (numerator + denominator / 2n) / denominator; // round-half-up
  const depreciation = rawDepreciation > replacementCost ? replacementCost : rawDepreciation;
  const acv = /* floored at 0 */;
```

- Depreciation is computed in basis points (`annualDepBps`) per category (see `src/lib/depreciation-rates.ts`), pro-rated by item age in months, and **capped** so depreciation can never exceed replacement cost (ACV is floored at 0).
- Rounding is **round-half-up**, matching the worked example in the assignment spec — chosen deliberately over banker's rounding for predictability, and made exact by ensuring the divisor is always even.
- `formatAgorot` renders these integers back to a human currency string only at the presentation layer — the math itself never touches a float.

### ⚖️ Apportionment Algorithm — Hamilton / Largest-Remainder Method (FR-3.2)

When a claim's total ACV across items exceeds the policy's per-occurrence limit, the shortfall has to be distributed *fairly* and *exactly* — no item should be shorted or overpaid by a rounding artifact, and the sum of every item's share must equal the limit to the last agorot:

```98:153:src/lib/money.ts
export function apportionLimit(
  items: { id: string; acv: bigint }[],
  limitAgorot: bigint,
): ApportionedShare[] {
  // 1. Baseline "floor" share per item: floor(limit * acv_i / totalAcv).
  // 2. Floors under-allocate by some leftover agorot due to truncation.
  // 3. Distribute those leftover units, one at a time, to the items with
  //    the largest fractional remainder (Hamilton's method).
  // 4. Ties broken deterministically by sorting tied items alphabetically
  //    by id — never by array order or insertion order.
```

- If total ACV already fits under the limit, every item simply keeps its full ACV — no apportionment needed.
- Otherwise, every division is done in `BigInt`, so there is no float drift no matter how large the claim.
- **Deterministic tie-breaking** is the detail that matters most for an audit: two items with an identical fractional remainder are ordered by their UUID string, not by array position, so the same inputs *always* produce the same output — critical for a system that has to defend its math to a claimant or regulator later.
- This exact function powers the "Final Payout" column in the Official Settlement Summary Letter (see FR-8 below), so the number a claimant sees on their letter is provably the same number the backend used to actually authorize payment.

### 🏦 Reserve Management & Append-Only Ledger (FR-5 / FR-7)

The reserve invariant — **`paid_to_date − recoveries + remaining_reserve == net_incurred`** — is enforced on every single financial mutation, inside a real database transaction:

```404:472:src/server/routers/claim.ts
return ctx.db.transaction(async (tx) => {
  // Lock the claim row for the duration of the transaction so two
  // concurrent transactions against the same claim can't both read
  // the same "remaining reserve" and both approve against it.
  await tx.execute(
    sql`select id from ${claims} where ${claims.id} = ${input.claimId} for update`,
  );

  const claim = await tx.query.claims.findFirst({ /* ... */ });
  // ... re-check the invariant against current ledger state ...
  if (
    input.type === "payment" &&
    input.amountAgorot > before.remainingReserveAgorot &&
    ctx.session.user.role !== "supervisor"
  ) {
    throw new TRPCError({ code: "FORBIDDEN", /* ... */ });
  }
```

- **`SELECT ... FOR UPDATE`** row-locks the claim for the duration of the transaction, so two concurrent payment requests against the same claim can never both read a stale "remaining reserve" and both get approved against money that's already gone.
- **Supervisor override**: a payment that would exceed the remaining reserve is rejected with `FORBIDDEN` for everyone *except* a `supervisor`, matching a real insurance authority-limit workflow.
- **Append-only, by construction**: `payments`, `recoveries`, and `reserves` are only ever `INSERT`ed into — there is no `UPDATE`/`DELETE` path anywhere in the router for these tables. Every reserve change (even the *first* one, materializing net incurred) is its own new row, so the full balance history is reconstructable at any point in time, not just the current snapshot.
- **Idempotency**: payments carry a required `idempotencyKey`, enforced by a unique constraint on `(claim_id, idempotency_key)`. A retried request (e.g. after a dropped connection) is caught and turned into a clean `CONFLICT` instead of double-charging the reserve.
- **`recordedById` on every row** (payments, recoveries, reserves) plus a **live Audit Trail UI** on the claim page — a unified, chronological table merging all three ledgers with transaction type, amount, timestamp, the recording user's name, and the idempotency key where applicable — makes the append-only ledger fully visible and verifiable, not just enforced invisibly in the database.

### 📎 Mock Upload Dev Fallback

Document upload (FR-2's gate on `assessClaim`) depends on UploadThing, a real cloud service — but requiring a live token would make local evaluation brittle. Instead, the app detects a missing/placeholder token and swaps in a same-shape mock path automatically:

```253:309:src/server/routers/claim.ts
getUploadConfig: protectedProcedure.query(() => ({
  useMockUpload: !isUploadThingConfigured(),
})),

simulateDocumentUpload: protectedProcedure
  .input(simulateDocumentUploadInput)
  .mutation(async ({ ctx, input }) => {
    if (isUploadThingConfigured()) {
      throw new TRPCError({ code: "BAD_REQUEST", /* refuse to bypass real uploads */ });
    }
    // ... insert a `documents` row identical in shape to a real upload ...
  }),
```

- `isUploadThingConfigured()` (`src/lib/uploadthing-config.ts`) checks `UPLOADTHING_TOKEN` for both absence and common placeholder values.
- `DocumentUploader` (`src/components/document-uploader.tsx`) queries `getUploadConfig` and conditionally renders a **"Simulate File Upload (Dev)"** button in place of the real UploadThing widget — so `assessClaim`'s document guard, and the entire triage → assessment → investigating flow, can be fully exercised locally with zero external dependencies.
- The mock path is self-disabling: `simulateDocumentUpload` refuses to run at all once a real token *is* configured, so it can never be used to sneak past genuine document review in a real deployment. It's also blocked once a claim is `settled`/`finalized`, consistent with FR-6.

### 📜 Claim Finalization & Official Summary Letter (FR-6 / FR-8)

The claim lifecycle ends in two deliberate, one-way steps — `settleClaim` and `finalizeClaim` — each guarded so it can only ever fire once:

```367:387:src/server/routers/claim.ts
// settled -> finalized. FR-6/FR-8: the terminal, one-way edge — once
// finalized, the claim record is frozen forever (no further state
// transitions or financial transactions; every other mutation's status
// guard already rejects a "finalized" claim, since none of them expect
// "finalized" as their `from` state).
finalizeClaim: protectedProcedure
  .input(claimTransitionInput)
  .mutation(async ({ ctx, input }) =>
    transitionClaim(ctx.db, input, "settled", "finalized", {
      guard: async (claim) => {
        if (claim.finalizedAt) {
          throw new TRPCError({ code: "BAD_REQUEST", /* ... */ });
        }
      },
      extraFields: { finalizedAt: new Date() },
    }),
  ),
```

- **Freezing is layered, not single-point**: once a claim is `settled`, `recordTransaction` and `simulateDocumentUpload`/the real UploadThing `middleware` all independently refuse to run against it — so finalization isn't the *only* thing standing between a claim and further mutation, it's the last of several redundant checks.
- Once `finalized`, the dashboard claim page hides every mutating control (payment/recovery form, document uploader, all transition buttons) and instead renders a dedicated, **Official Settlement Summary Letter** card:
  - Formatted as a formal, serif-typeset business letter, personalized with the claimant's name.
  - States the final **Net Incurred**, **Total Paid**, and **Remaining Reserve**.
  - Itemizes every claim item's **Category, Claimed RCV, Depreciation, ACV**, and **Final Payout** — the Final Payout column is the literal output of `apportionLimit`, so the letter is not a separate "pretty" calculation; it's a rendering of the exact same deterministic apportionment the backend used.
  - Includes a **Print Letter** action (`window.print()`) with `print:hidden` applied to every other card on the page, so printing produces a clean, letter-only document.

---

## 3. How to Set Up and Run

### Prerequisites

- **Node.js 20+**
- A [Neon](https://neon.tech) Postgres database (free tier is enough) — you'll need its connection string
- *(Optional)* An [UploadThing](https://uploadthing.com) account/token — **not required**; the app fully falls back to the mock uploader described above if this is omitted

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

| Variable | Required | Description |
| --- | --- | --- |
| `DATABASE_URL` | ✅ | Neon Postgres connection string. |
| `BETTER_AUTH_SECRET` | ✅ | Random secret used to sign sessions (e.g. `openssl rand -base64 32`). |
| `BETTER_AUTH_URL` | ✅ | Base URL of the app — `http://localhost:3000` in development. |
| `UPLOADTHING_TOKEN` | ❌ | Leave blank/placeholder to automatically use the local mock upload fallback. |

### 3. Set up the database

```bash
npm run db:migrate
npm run db:seed
```

- `db:migrate` applies the committed, reviewable migrations in `drizzle/` (generated ahead of time with `npm run db:generate` whenever `src/db/schema.ts` changes).
- `db:seed` populates a policy, one user per role (`claimant`, `adjuster`, `supervisor`), and a worked-example claim (`CLM-2026-0007`) with items already priced for depreciation/apportionment testing.

### 4. Run the app

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and sign in as any seeded user to walk a claim through the full lifecycle — intake through the finalized letter.

### 5. Run the automated test suite

```bash
npm test
```

This runs the **19 Vitest business-logic tests** covering `calculateACV` and `apportionLimit` in `src/lib/money.test.ts` — including round-half-up edge cases, depreciation capping, under-limit pass-through, largest-remainder distribution, and deterministic tie-breaking by id. Use `npm run test:watch` while iterating.

---

## Project Structure

```
src/
  app/
    api/auth/[...all]/route.ts     # Better Auth route handler
    api/trpc/[trpc]/route.ts       # tRPC route handler (fetch adapter)
    api/uploadthing/               # UploadThing FileRouter + route handler
    dashboard/page.tsx             # Claim list (role-scoped)
    dashboard/[id]/page.tsx        # Claim detail: state machine, ledger, letter
    login/page.tsx                 # Better Auth sign-in
  components/
    document-uploader.tsx          # Real UploadThing widget + dev mock fallback
    site-header.tsx, access-denied.tsx
    ui/                            # shadcn/ui primitives (Card, Table, Button, ...)
  db/
    schema.ts                      # Drizzle schema: domain tables + Better Auth tables
    index.ts                       # Drizzle client over a Neon WebSocket Pool
    seed.ts                        # Seed script (users, policy, worked-example claim)
  lib/
    auth.ts / auth-client.ts       # Better Auth server + client instances
    money.ts / money.test.ts       # ACV depreciation + Hamilton apportionment (+ tests)
    depreciation-rates.ts          # Per-category depreciation configuration
    uploadthing.ts / uploadthing-config.ts   # UploadThing client + mock-mode detection
  server/
    trpc.ts                       # tRPC init, session context, protectedProcedure
    routers/claim.ts              # Every claim procedure: state machine, ledger, letters
  trpc/react.tsx                  # Client-side tRPC + React Query provider
drizzle/                          # Generated SQL migrations (source of truth for schema history)
```

## Auth Notes

Every tRPC procedure requires an authenticated Better Auth session — unauthenticated calls are rejected server-side with `UNAUTHORIZED`. Roles (`claimant`, `adjuster`, `supervisor`) live on the `users` table as a Better Auth `additionalField` and drive both data visibility (claimants only see their own claims) and mutation authorization (only adjusters/supervisors can transition claims or record financial transactions; only supervisors can approve over-reserve payments).
