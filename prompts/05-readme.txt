We finished setting up the core architecture including tRPC, Better Auth, and the initial DB schema. Now, please generate a professional README.md for this 'FirstNotice' claims app.
Include:
Project Description: A short summary of what this app does (Claims Intake, Reserves, Settlement for an insurance context).
Tech Stack: List Next.js, tRPC, Drizzle, Better Auth, Neon Postgres, UploadThing, Tailwind, shadcn/ui.
Getting Started:
Steps to clone, install dependencies (npm install).
Env vars setup: Create .env from .env.example and add the DATABASE_URL (Neon) and any Better Auth secrets.
DB setup: npx drizzle-kit push to migrate, then npm run db:seed to seed data.
Development: npm run dev to start.
Scripts: Mention db:seed and db:studio (if you added it) for convenience.
Folder structure: Briefly explain src/db, src/server, src/trpc.
Keep it clean, professional, and use clear markdown.