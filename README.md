# FirstNotice

FirstNotice is a claims management app for a first-notice-of-loss (FNOL) insurance workflow. It covers the core lifecycle of a property claim end-to-end:

- **Intake** — claimants (or adjusters, on their behalf) file a claim against a policy.
- **Triage & investigation** — adjusters move a claim through an explicit, guarded state machine (`intake → triage → investigating → approved/denied → paid → closed`, plus `reopened`/`withdrawn` edges).
- **Reserves & settlement** — reserve history, payments (idempotent), and subrogation recoveries are tracked on append-only ledgers, all money stored as integer agorot (no floats).
- **Documents** — supporting files (police reports, damage photos, invoices, proof of repair) are attached per claim.

Every state transition and money movement is enforced server-side, not just in the UI.

## Tech Stack

| Layer | Technology |
| --- | --- |
| Framework | [Next.js](https://nextjs.org) (App Router) |
| API layer | [tRPC](https://trpc.io) — one procedure per legal state-machine edge |
| Validation | [Zod](https://zod.dev) — shared schemas across client and server |
| ORM | [Drizzle ORM](https://orm.drizzle.team) |
| Database | [Neon Postgres](https://neon.tech) |
| Auth | [Better Auth](https://www.better-auth.com) (Drizzle adapter, server-enforced) |
| File uploads | [UploadThing](https://uploadthing.com) |
| Styling | [Tailwind CSS](https://tailwindcss.com) + [shadcn/ui](https://ui.shadcn.com) |

## Getting Started

### 1. Clone and install

```bash
git clone https://github.com/Itay7414/first-notice----assignment.git
cd first-notice----assignment
npm install
```

### 2. Configure environment variables

Copy the example file and fill in your own values:

```bash
cp .env.example .env
```

| Variable | Description |
| --- | --- |
| `DATABASE_URL` | Your [Neon](https://neon.tech) Postgres connection string. |
| `BETTER_AUTH_SECRET` | A random secret used to sign sessions (e.g. `openssl rand -base64 32`). |
| `BETTER_AUTH_URL` | The base URL of the app, e.g. `http://localhost:3000` in development. |

### 3. Set up the database

Apply the committed migrations, then seed sample data (users, a policy, and a worked-example claim):

```bash
npm run db:migrate
npm run db:seed
```

> Migrations are generated ahead of time with `npm run db:generate` and checked into `drizzle/`. Prefer this over `drizzle-kit push` so schema changes stay reviewable and reproducible across environments.

### 4. Run the app

```bash
npm run dev
```

The app will be available at [http://localhost:3000](http://localhost:3000).

## Scripts

| Script | Description |
| --- | --- |
| `npm run dev` | Start the Next.js dev server. |
| `npm run build` | Create a production build. |
| `npm run start` | Run the production build. |
| `npm run lint` | Run ESLint. |
| `npm run db:generate` | Generate a new Drizzle migration from schema changes. |
| `npm run db:migrate` | Apply pending migrations to `DATABASE_URL`. |
| `npm run db:seed` | Seed the database with sample users, a policy, and a worked-example claim. |
| `npm run db:studio` | Launch [Drizzle Studio](https://orm.drizzle.team/drizzle-studio/overview) to browse/edit data. |

## Folder Structure

```
app/                     # Next.js App Router pages and route handlers
  api/auth/[...all]/     # Better Auth route handler
  api/trpc/[trpc]/       # tRPC route handler (fetch adapter)
src/
  db/
    schema.ts            # Drizzle schema: domain tables + Better Auth tables
    index.ts             # Drizzle client, initialized against Neon
    seed.ts              # Seed script (users, policy, worked-example claim)
  lib/
    auth.ts              # Better Auth server instance (Drizzle adapter)
  server/
    trpc.ts              # tRPC init, context (session), auth middleware
    routers/
      _app.ts            # Root router, merges all sub-routers
      claim.ts            # Claim procedures (getClaim, createClaim, triageClaim, ...)
  trpc/
    react.tsx            # Client-side tRPC + React Query provider for client components
drizzle/                 # Generated SQL migrations (source of truth for schema history)
```

## Auth Notes

Every tRPC procedure requires an authenticated Better Auth session — unauthenticated calls are rejected server-side with `UNAUTHORIZED`. Roles (`claimant`, `adjuster`, `supervisor`) are stored on the `users` table and seeded per role; see `npm run db:seed`.
